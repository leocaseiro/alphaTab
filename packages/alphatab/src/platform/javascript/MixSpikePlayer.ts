// SPIKE (#2397) — THROWAWAY. A player combining the backing track (media clock) with the
// worker synthesizer, used to compare synchronization strategies:
//  - free:   synth follows the sync points, only re-synced on play/seek (baseline)
//  - seek:   approach 1, compare positions on media time updates, seek synth if drift > 50ms
//  - nudge:  approach 2, worklet timestamps + small speed corrections, re-sync on large drift
//  - decode: approach 3, MP3 decoded and mixed inside the synth worker (synth is the clock)
import {
    EventEmitter,
    EventEmitterOfT,
    type IEventEmitter,
    type IEventEmitterOfT
} from '@coderline/alphatab/EventEmitter';
import { Logger } from '@coderline/alphatab/Logger';
import type { LogLevel } from '@coderline/alphatab/LogLevel';
import type { MidiEventType } from '@coderline/alphatab/midi/MidiEvent';
import type { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import type { Score } from '@coderline/alphatab/model/Score';
import type { AlphaSynthAudioWorkletOutput } from '@coderline/alphatab/platform/javascript/AlphaSynthAudioWorkletOutput';
import type { AudioElementBackingTrackSynthOutput } from '@coderline/alphatab/platform/javascript/AudioElementBackingTrackSynthOutput';
import type { AlphaSynthWebWorkerApi } from '@coderline/alphatab/platform/worker/AlphaSynthWebWorkerApi';
import type { BackingTrackPlayer } from '@coderline/alphatab/synth/BackingTrackPlayer';
import type { BackingTrackSyncPoint, IAlphaSynth } from '@coderline/alphatab/synth/IAlphaSynth';
import type { ISynthOutput } from '@coderline/alphatab/synth/ISynthOutput';
import type { MidiEventsPlayedEventArgs } from '@coderline/alphatab/synth/MidiEventsPlayedEventArgs';
import type { PlaybackRange } from '@coderline/alphatab/synth/PlaybackRange';
import type { PlaybackRangeChangedEventArgs } from '@coderline/alphatab/synth/PlaybackRangeChangedEventArgs';
import { PlayerState } from '@coderline/alphatab/synth/PlayerState';
import type { PlayerStateChangedEventArgs } from '@coderline/alphatab/synth/PlayerStateChangedEventArgs';
import type { PositionChangedEventArgs } from '@coderline/alphatab/synth/PositionChangedEventArgs';

/**
 * @internal
 */
export type MixSpikeMode = 'free' | 'seek' | 'nudge' | 'nudgecal' | 'decode';

/**
 * @internal
 */
export interface MixSpikeDriftEntry {
    t: number;
    drift: number;
    correction: number;
    action: string;
}

/**
 * @internal
 */
export class MixSpikeStats {
    public resyncs: number = 0;
    public resyncTimes: number[] = [];
    public driftLog: MixSpikeDriftEntry[] = [];
    public decodeMs: number = 0;
    public pcmBytes: number = 0;
    public resyncLead: number = 0;
    public mediaLatencyByRate: Record<string, number> = {};
    public calibrationMs: Record<string, number> = {};
}

/**
 * @internal
 */
export class MixSpikePlayer implements IAlphaSynth {
    public readonly media: BackingTrackPlayer;
    public readonly synth: AlphaSynthWebWorkerApi;
    public readonly mode: MixSpikeMode;
    public readonly stats: MixSpikeStats = new MixSpikeStats();

    /** measurement only: in decode mode put the backing track into the left, the synth into the right channel */
    public split: boolean = false;
    public seekThreshold: number = 50;
    public nudgeMaxCorrection: number = 0.01;
    public nudgeGainMillis: number = 3000;
    public nudgeResyncThreshold: number = 120;
    public settleResyncThreshold: number = 15;
    public settleDuration: number = 1500;

    private _syncPoints: BackingTrackSyncPoint[] = [];
    private _settleUntil: number = 0;
    private _ignoreUntil: number = 0;
    private _driftEma: number | null = null;
    private _correction: number = 1;
    private _resyncLead: number = 10;
    private _awaitingFirstDriftAfterResync: boolean = false;
    private _synthMediaPosition: number = -1;
    private _synthMediaPositionAt: number = 0;
    private _onSynthWorklet: ((node: AudioNode) => void)[] = [];
    // 2b: measured latency of the time-stretched <audio> output vs its currentTime, per playback rate
    private _mediaLatency: Map<number, number> = new Map<number, number>();
    private _probeUrl: string | null = null;
    private _probeTimes: number[] = [];
    private _probeModule: Promise<void> | null = null;

    public constructor(media: BackingTrackPlayer, synth: AlphaSynthWebWorkerApi, mode: MixSpikeMode) {
        this.media = media;
        this.synth = synth;
        this.mode = mode;

        this.ready = new EventEmitter(() => this.isReady);
        this.readyForPlayback = new EventEmitter(() => this.isReadyForPlayback);

        const clock: IAlphaSynth = mode === 'decode' ? synth : media;
        clock.positionChanged.on(e => {
            (this.positionChanged as EventEmitterOfT<PositionChangedEventArgs>).trigger(e);
        });
        clock.stateChanged.on(e => (this.stateChanged as EventEmitterOfT<PlayerStateChangedEventArgs>).trigger(e));
        clock.finished.on(() => (this.finished as EventEmitter).trigger());
        media.midiLoaded.on(e => (this.midiLoaded as EventEmitterOfT<PositionChangedEventArgs>).trigger(e));
        media.midiLoadFailed.on(e => (this.midiLoadFailed as EventEmitterOfT<Error>).trigger(e));
        media.playbackRangeChanged.on(e =>
            (this.playbackRangeChanged as EventEmitterOfT<PlaybackRangeChangedEventArgs>).trigger(e)
        );
        synth.midiEventsPlayed.on(e => (this.midiEventsPlayed as EventEmitterOfT<MidiEventsPlayedEventArgs>).trigger(e));
        synth.soundFontLoaded.on(() => (this.soundFontLoaded as EventEmitter).trigger());
        synth.soundFontLoadFailed.on(e => (this.soundFontLoadFailed as EventEmitterOfT<Error>).trigger(e));
        media.ready.on(() => this._checkReady());
        synth.ready.on(() => this._checkReady());
        media.readyForPlayback.on(() => this._checkReadyForPlayback());
        synth.readyForPlayback.on(() => this._checkReadyForPlayback());

        const out = this.synthOutput;
        out.spikeOnWorkletCreated = node => {
            for (const cb of this._onSynthWorklet) {
                cb(node);
            }
        };
        if (mode !== 'decode') {
            this.mediaOutput.spikeRouteThrough(out.spikeContext, out.spikeMaster);
        }
        if (mode === 'nudge' || mode === 'nudgecal') {
            out.spikeOnTimestamp = (frame, mediaTime) => this._onTimestamp(frame, mediaTime);
        }
        if (mode === 'seek') {
            synth.spikeOnMediaPosition = t => {
                this._synthMediaPosition = t;
                this._synthMediaPositionAt = performance.now();
            };
            media.positionChanged.on(() => this._seekCheck());
        }
    }

    // ---- measurement helpers ----
    public get synthOutput(): AlphaSynthAudioWorkletOutput {
        return this.synth.output as AlphaSynthAudioWorkletOutput;
    }
    public get mediaOutput(): AudioElementBackingTrackSynthOutput {
        return this.media.output as AudioElementBackingTrackSynthOutput;
    }
    public get audioContext(): AudioContext {
        return this.synthOutput.spikeContext;
    }
    public get masterGain(): GainNode {
        return this.synthOutput.spikeMaster;
    }
    public onSynthWorkletCreated(cb: (node: AudioNode) => void) {
        this._onSynthWorklet.push(cb);
    }

    private _mediaTimeNow(): number {
        return this.mediaOutput.audioElement.currentTime * 1000;
    }

    /** 2b: how far (in media ms) the audible <audio> output is ahead of its currentTime */
    private _latencyInMedia(): number {
        if (this.mode !== 'nudgecal') {
            return 0;
        }
        const speed = this.media.playbackSpeed;
        return (this._mediaLatency.get(speed) ?? 0) * speed;
    }

    private _mediaDuration(): number {
        return this.mediaOutput.backingTrackDuration;
    }

    private _toMedia(alphaTabTime: number): number {
        return (this.media as any).sequencer.mainTimePositionToBackingTrack(alphaTabTime, this._mediaDuration());
    }

    private _sendFollowConfig() {
        this.synth.spikeFollow(true, this._mediaDuration(), this._syncPoints);
    }

    private _resyncTo(mediaTime: number, lead: number = 0, learn: boolean = true) {
        const speed = this.media.playbackSpeed;
        this.synth.spikeResync(mediaTime + lead * speed);
        this.stats.resyncs++;
        this.stats.resyncTimes.push(performance.now());
        this._driftEma = null;
        this._ignoreUntil = performance.now() + 200;
        this._awaitingFirstDriftAfterResync = learn;
    }

    // approach 1: compare positions on each media time update
    private _seekCheck() {
        if (this.media.state !== PlayerState.Playing || this._synthMediaPosition < 0) {
            return;
        }
        const el = this.mediaOutput.audioElement;
        if (el.paused || el.seeking) {
            return;
        }
        const now = performance.now();
        const speed = this.media.playbackSpeed;
        const synthNow = this._synthMediaPosition + (now - this._synthMediaPositionAt) * speed;
        const drift = synthNow - this._mediaTimeNow();
        let action = '';
        if (now >= this._ignoreUntil && Math.abs(drift) > this.seekThreshold) {
            action = 'seek';
            this._resyncTo(this._mediaTimeNow());
        }
        this.stats.driftLog.push({ t: now, drift, correction: 1, action });
    }

    // approach 2: worklet time stamps + nudging
    private _onTimestamp(frame: number, synthMediaTime: number) {
        if (this.media.state !== PlayerState.Playing) {
            return;
        }
        const el = this.mediaOutput.audioElement;
        if (el.paused || el.seeking) {
            return;
        }
        const now = performance.now();
        if (now < this._ignoreUntil) {
            return;
        }
        const ctx = this.audioContext;
        const speed = this.media.playbackSpeed;
        const latency = this.mode === 'nudgecal' ? (this._mediaLatency.get(speed) ?? 0) : 0;
        const mediaAtFrame =
            el.currentTime * 1000 - (ctx.currentTime - frame / ctx.sampleRate) * 1000 * speed + latency * speed;
        const drift = synthMediaTime - mediaAtFrame;
        const settling = now < this._settleUntil;
        let action = '';

        if (this._awaitingFirstDriftAfterResync) {
            // learn the pipeline latency: the synth started `drift` ms off after the last re-sync
            this._awaitingFirstDriftAfterResync = false;
            this._resyncLead = Math.max(0, Math.min(100, this._resyncLead - drift / speed));
            this.stats.resyncLead = this._resyncLead;
        }

        if (Math.abs(drift) > (settling ? this.settleResyncThreshold : this.nudgeResyncThreshold)) {
            action = 'resync';
            this._resyncTo(this._mediaTimeNow() + latency * speed, this._resyncLead);
        } else {
            this._driftEma = this._driftEma === null ? drift : this._driftEma + (drift - this._driftEma) * 0.3;
            const max = this.nudgeMaxCorrection;
            const correction = 1 - Math.max(-max, Math.min(max, this._driftEma / this.nudgeGainMillis));
            if (Math.abs(correction - this._correction) > 0.0002) {
                this._correction = correction;
                this.synth.spikeCorrection(correction);
                action = 'nudge';
            }
        }
        this.stats.driftLog.push({ t: now, drift, correction: this._correction, action });
    }

    /**
     * 2b: measures how much earlier the time-stretched audio of an <audio> element is heard
     * compared to what its currentTime reports, by playing a silent probe (beeps every 250ms)
     * through the same AudioContext into a tap.
     */
    public async spikeCalibrate(rates: number[]): Promise<void> {
        for (const rate of rates) {
            if (!this._mediaLatency.has(rate)) {
                const t0 = performance.now();
                const latency = await this._measureLatency(rate);
                this._mediaLatency.set(rate, latency);
                this.stats.mediaLatencyByRate[String(rate)] = Math.round(latency * 10) / 10;
                this.stats.calibrationMs[String(rate)] = Math.round(performance.now() - t0);
            }
        }
    }

    private _ensureProbe(ctx: AudioContext): Promise<void> {
        if (!this._probeModule) {
            const sr = 48000;
            const seconds = 4;
            const pcm = new Int16Array(sr * seconds);
            this._probeTimes = [];
            for (let t = 0.25; t < seconds - 0.2; t += 0.25) {
                this._probeTimes.push(t);
                const start = Math.round(t * sr);
                for (let k = 0; k < 144; k++) {
                    pcm[start + k] = Math.round(Math.sin((2 * Math.PI * 2000 * k) / sr) * 0.6 * 32767);
                }
            }
            const buf = new ArrayBuffer(44 + pcm.length * 2);
            const v = new DataView(buf);
            const w = (o: number, str: string) => {
                for (let i = 0; i < str.length; i++) {
                    v.setUint8(o + i, str.charCodeAt(i));
                }
            };
            w(0, 'RIFF');
            v.setUint32(4, 36 + pcm.length * 2, true);
            w(8, 'WAVE');
            w(12, 'fmt ');
            v.setUint32(16, 16, true);
            v.setUint16(20, 1, true);
            v.setUint16(22, 1, true);
            v.setUint32(24, sr, true);
            v.setUint32(28, sr * 2, true);
            v.setUint16(32, 2, true);
            v.setUint16(34, 16, true);
            w(36, 'data');
            v.setUint32(40, pcm.length * 2, true);
            new Int16Array(buf, 44).set(pcm);
            this._probeUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
            const code = `class SpikeProbeTap extends AudioWorkletProcessor {
                constructor() { super(); this.cool = 0; }
                process(inputs) {
                    const ch = inputs[0] && inputs[0][0];
                    if (ch) {
                        for (let i = 0; i < ch.length; i++) {
                            if (this.cool <= 0 && Math.abs(ch[i]) > 0.25) { this.port.postMessage(currentFrame + i); this.cool = 2400; }
                            this.cool--;
                        }
                    }
                    return true;
                }
            }
            registerProcessor('spike-probe-tap', SpikeProbeTap);`;
            this._probeModule = ctx.audioWorklet.addModule(
                URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
            );
        }
        return this._probeModule;
    }

    private async _measureLatency(rate: number): Promise<number> {
        const ctx = this.audioContext;
        await this._ensureProbe(ctx);
        const el = new Audio(this._probeUrl!);
        el.preload = 'auto';
        el.playbackRate = rate;
        await new Promise(r => el.addEventListener('canplaythrough', r, { once: true }));
        const src = ctx.createMediaElementSource(el);
        const tap = new AudioWorkletNode(ctx, 'spike-probe-tap');
        src.connect(tap);
        tap.connect(ctx.destination); // tap writes no output -> silent
        const onsets: number[] = [];
        tap.port.onmessage = e => onsets.push((e.data as number) / ctx.sampleRate);
        const polls: { media: number; ctx: number }[] = [];
        await el.play();
        const lastProbe = this._probeTimes[this._probeTimes.length - 1];
        while (el.currentTime < lastProbe + 0.1 && !el.ended) {
            polls.push({ media: el.currentTime, ctx: ctx.currentTime });
            await new Promise(r => setTimeout(r, 4));
        }
        el.pause();
        src.disconnect();
        tap.disconnect();
        const offsets: number[] = [];
        for (const onset of onsets) {
            for (let i = 1; i < polls.length; i++) {
                const a = polls[i - 1];
                const b = polls[i];
                if (a.ctx <= onset && b.ctx > onset) {
                    const mediaAt = a.media + ((onset - a.ctx) / (b.ctx - a.ctx)) * (b.media - a.media);
                    let best = this._probeTimes[0];
                    for (const t of this._probeTimes) {
                        if (Math.abs(t - mediaAt) < Math.abs(best - mediaAt)) {
                            best = t;
                        }
                    }
                    // real ms between hearing beep `best` and currentTime reaching it
                    offsets.push(((best - mediaAt) / rate) * 1000);
                    break;
                }
            }
        }
        offsets.shift(); // skip the start transient
        offsets.sort((x, y) => x - y);
        return offsets.length ? offsets[Math.floor(offsets.length / 2)] : 0;
    }

    private async _decodeAndSend(score: Score) {
        const raw = score.backingTrack?.rawAudioFile;
        if (!raw) {
            return;
        }
        const ctx = this.audioContext;
        const t0 = performance.now();
        const buffer = await ctx.decodeAudioData(raw.slice().buffer as ArrayBuffer);
        this.stats.decodeMs = performance.now() - t0;
        const left = buffer.getChannelData(0).slice();
        const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : null;
        this.stats.pcmBytes = left.byteLength + (right?.byteLength ?? 0);
        this.synth.spikePcm(left, right, buffer.sampleRate, this.split);
    }

    private _checkReady() {
        if (this.isReady) {
            (this.ready as EventEmitter).trigger();
        }
    }

    private _checkReadyForPlayback() {
        if (this.isReadyForPlayback) {
            (this.readyForPlayback as EventEmitter).trigger();
        }
    }

    // ---- IAlphaSynth ----
    public get output(): ISynthOutput {
        return this.media.output;
    }
    public get isReady(): boolean {
        return this.media.isReady && this.synth.isReady;
    }
    public get isReadyForPlayback(): boolean {
        return this.media.isReadyForPlayback && this.synth.isReadyForPlayback;
    }
    public get state(): PlayerState {
        return this.mode === 'decode' ? this.synth.state : this.media.state;
    }
    public get logLevel(): LogLevel {
        return Logger.logLevel;
    }
    public set logLevel(value: LogLevel) {
        this.media.logLevel = value;
        this.synth.logLevel = value;
    }
    public get masterVolume(): number {
        return this.synth.masterVolume;
    }
    public set masterVolume(value: number) {
        this.media.masterVolume = value;
        this.synth.masterVolume = value;
    }
    public get metronomeVolume(): number {
        return this.synth.metronomeVolume;
    }
    public set metronomeVolume(value: number) {
        this.synth.metronomeVolume = value;
    }
    public get playbackSpeed(): number {
        return this.media.playbackSpeed;
    }
    public set playbackSpeed(value: number) {
        const wasPlaying = this.state === PlayerState.Playing;
        this.media.playbackSpeed = value;
        this.synth.playbackSpeed = value;
        if (wasPlaying && this.mode !== 'decode') {
            this._settleUntil = performance.now() + this.settleDuration;
            this._resyncTo(
                this._mediaTimeNow() + this._latencyInMedia(),
                this.mode === 'nudge' || this.mode === 'nudgecal' ? this._resyncLead : 0
            );
        }
    }
    public get tickPosition(): number {
        return this.mode === 'decode' ? this.synth.tickPosition : this.media.tickPosition;
    }
    public set tickPosition(value: number) {
        this.media.tickPosition = value;
        this._afterSeek();
    }
    public get timePosition(): number {
        return this.mode === 'decode' ? this.synth.timePosition : this.media.timePosition;
    }
    public set timePosition(value: number) {
        this.media.timePosition = value;
        this._afterSeek();
    }
    private _afterSeek() {
        this._settleUntil = performance.now() + this.settleDuration;
        const mediaTime = this._toMedia(this.media.timePosition) + this._latencyInMedia();
        this._resyncTo(mediaTime, this.mode === 'nudge' || this.mode === 'nudgecal' ? this._resyncLead : 0);
    }
    public get playbackRange(): PlaybackRange | null {
        return this.media.playbackRange;
    }
    public set playbackRange(value: PlaybackRange | null) {
        this.media.playbackRange = value;
        this.synth.playbackRange = value;
    }
    public get isLooping(): boolean {
        return this.media.isLooping;
    }
    public set isLooping(value: boolean) {
        this.media.isLooping = value;
        this.synth.isLooping = value;
    }
    public get countInVolume(): number {
        return 0;
    }
    public set countInVolume(_value: number) {
        // not part of the spike
    }
    public get midiEventsPlayedFilter(): MidiEventType[] {
        return this.synth.midiEventsPlayedFilter;
    }
    public set midiEventsPlayedFilter(value: MidiEventType[]) {
        this.synth.midiEventsPlayedFilter = value;
    }
    public get loadedMidiInfo(): PositionChangedEventArgs | undefined {
        return this.media.loadedMidiInfo;
    }
    public get currentPosition(): PositionChangedEventArgs {
        return this.mode === 'decode' ? this.synth.currentPosition : this.media.currentPosition;
    }

    public destroy(): void {
        this.media.destroy();
        this.synth.destroy();
    }

    public play(): boolean {
        this._sendFollowConfig();
        const mediaTime = this._mediaTimeNow() + this._latencyInMedia();
        this._settleUntil = performance.now() + this.settleDuration;
        this._resyncTo(mediaTime, 0, false);
        this.stats.resyncs--; // the start is not counted as a re-sync
        if (this.mode === 'decode') {
            return this.synth.play();
        }
        this.synth.play();
        return this.media.play();
    }

    public pause(): void {
        this.media.pause();
        this.synth.pause();
    }

    public playPause(): void {
        if (this.state === PlayerState.Playing) {
            this.pause();
        } else {
            this.play();
        }
    }

    public stop(): void {
        this.media.stop();
        this.synth.stop();
    }

    public playOneTimeMidiFile(midi: MidiFile): void {
        this.synth.playOneTimeMidiFile(midi);
    }
    public loadSoundFont(data: Uint8Array, append: boolean): void {
        this.synth.loadSoundFont(data, append);
    }
    public resetSoundFonts(): void {
        this.synth.resetSoundFonts();
    }
    public loadMidiFile(midi: MidiFile): void {
        this.media.loadMidiFile(midi);
        this.synth.loadMidiFile(midi);
    }
    public loadBackingTrack(score: Score): void {
        this.media.loadBackingTrack(score);
        if (this.mode === 'decode') {
            this._decodeAndSend(score);
        }
    }
    public updateSyncPoints(syncPoints: BackingTrackSyncPoint[]): void {
        this._syncPoints = syncPoints;
        this.media.updateSyncPoints(syncPoints);
        this._sendFollowConfig();
    }
    public applyTranspositionPitches(transpositionPitches: Map<number, number>): void {
        this.synth.applyTranspositionPitches(transpositionPitches);
    }
    public setChannelTranspositionPitch(channel: number, semitones: number): void {
        this.synth.setChannelTranspositionPitch(channel, semitones);
    }
    public setChannelMute(channel: number, mute: boolean): void {
        this.synth.setChannelMute(channel, mute);
    }
    public resetChannelStates(): void {
        this.synth.resetChannelStates();
    }
    public setChannelSolo(channel: number, solo: boolean): void {
        this.synth.setChannelSolo(channel, solo);
    }
    public setChannelVolume(channel: number, volume: number): void {
        this.synth.setChannelVolume(channel, volume);
    }

    public readonly ready: IEventEmitter;
    public readonly readyForPlayback: IEventEmitter;
    public readonly finished: IEventEmitter = new EventEmitter();
    public readonly soundFontLoaded: IEventEmitter = new EventEmitter();
    public readonly soundFontLoadFailed: IEventEmitterOfT<Error> = new EventEmitterOfT<Error>();
    public readonly midiLoaded: IEventEmitterOfT<PositionChangedEventArgs> =
        new EventEmitterOfT<PositionChangedEventArgs>();
    public readonly midiLoadFailed: IEventEmitterOfT<Error> = new EventEmitterOfT<Error>();
    public readonly stateChanged: IEventEmitterOfT<PlayerStateChangedEventArgs> =
        new EventEmitterOfT<PlayerStateChangedEventArgs>();
    public readonly positionChanged: IEventEmitterOfT<PositionChangedEventArgs> =
        new EventEmitterOfT<PositionChangedEventArgs>();
    public readonly midiEventsPlayed: IEventEmitterOfT<MidiEventsPlayedEventArgs> =
        new EventEmitterOfT<MidiEventsPlayedEventArgs>();
    public readonly playbackRangeChanged: IEventEmitterOfT<PlaybackRangeChangedEventArgs> =
        new EventEmitterOfT<PlaybackRangeChangedEventArgs>();
}
