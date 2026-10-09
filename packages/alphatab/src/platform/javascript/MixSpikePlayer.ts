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
    public startLead: number = 0;
    public calibrationMs: Record<string, number> = {};
    /** lap-1 F-10 spike: learned ms from media play() to the target entering the graph, per speed */
    public mediaStartLatency: Record<string, number> = {};
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
    public nudgeMaxCorrection: number = 0.02;
    public nudgeGainMillis: number = 3000;
    /** nudge gain while settling (lap-1 F-8 option A: a faster nudge instead of a re-sync) */
    public settleNudgeGainMillis: number = 3000;
    public nudgeResyncThreshold: number = 120;
    public settleResyncThreshold: number = 4;
    public settleDuration: number = 1500;

    /**
     * spike 2026-10-08 (lap-1 F-3): start the synth at the target, never past it. A positive
     * time-stretch latency is caught up after the first beat by a faster nudge; one start lead per speed.
     */
    public startAtTarget: boolean = false;
    public catchUpMaxCorrection: number = 0.08;
    /**
     * lap-2 F-9 spike: what a speed change during playback does. 'always' = re-sync (as built);
     * 'ifDrift' = settle only, the drift rules re-sync if the agreed drift exceeds the settle threshold.
     */
    public speedChangeRule: 'always' | 'ifDrift' = 'always';
    /**
     * lap-2 F-9 spike: values for a speed with none learned / probed yet (start lead, media-start latency,
     * media latency). 'zero' = as built; 'line' = straight line between the nearest known speeds,
     * outside them the nearest value.
     */
    public unlearnedGuess: 'zero' | 'line' = 'zero';
    /** lap-2 F-9 spike: learn the compensated start's lead per speed (the spec's rule) instead of one value */
    public compensatedLeadPerSpeed: boolean = false;
    private _compLeadBySpeed: Map<number, number> = new Map<number, number>();
    private _learnCompLead(speed: number, offsetMs: number) {
        const cur = this._lineGuess(this._compLeadBySpeed, speed, 0);
        this._compLeadBySpeed.set(speed, Math.max(-50, Math.min(150, cur - offsetMs / speed)));
    }
    public catchUpGainMillis: number = 300;
    private _startLeadBySpeed: Map<number, number> = new Map<number, number>();
    private _catchUpUntil: number = 0;
    private _startGap: number = 0;

    /** spike 2026-10-08 (lap-1 F-4): who owns the loop wrap */
    public loopOwner: 'none' | 'combined' | 'media' = 'none';
    /** loop range in media ms (combined owner) */
    public loopRange: { start: number; end: number } | null = null;
    public loopWraps: number[] = [];
    /** media ms to start before the loop start above 1x (Chrome drops the first ms of time-stretched audio) */
    public loopPreRoll: number = 0;
    /**
     * lap-1 F-10 spike: count-in hand-off. The synth renders `countInMediaMs` of media time before the
     * target (metronome clicks with the tracks muted: a count-in at the song's tempo) and then the song, as
     * one stream. The worklet stamps give the context frame where the synth reaches the target; the media's
     * play() is issued a learned media-start latency (per speed) before that frame.
     */
    public countInMediaMs: number = 0;
    /** first guess (ms) of the media-start latency before anything is learned */
    public countInStartGuess: number = 0;
    /** media ms the media starts before the target below 1x (test whether the stretch start transient matters) */
    public countInPreRollBelow1: number = 0;
    public countInLog: { speed: number; lateMs: number; agreed: number; learned: number }[] = [];
    private _mediaStartLatencyBySpeed: Map<number, number> = new Map<number, number>();
    private _countIn: { target: number; speed: number; pre: number; frameT: number | null; playAt: number } | null =
        null;
    private _countInTimer: ReturnType<typeof setTimeout> | null = null;
    private _awaitingFirstDriftAfterCountIn: boolean = false;
    /**
     * lap-1 F-18 spike: playBeat / playNote (one-time MIDI) during mixed playback.
     * synthOnly = as built (routed to the synth only); pauseBoth = pause media + synth, play the one-time
     * MIDI on the synth's own clock, stay paused; pauseBothResume = the same, then Play again when it ends.
     */
    public oneTimeMidiMode: 'synthOnly' | 'pauseBoth' | 'pauseBothResume' = 'synthOnly';
    public oneTimeLog: { at: number; wasPlaying: boolean; durationMs: number; resumeAt: number | null }[] = [];
    private _oneTimeResumeTimer: ReturnType<typeof setTimeout> | null = null;
    private _loopTimer: ReturnType<typeof setTimeout> | null = null;
    private _playbackRange: PlaybackRange | null = null;
    private _isLooping: boolean = false;
    private _seekedHooked: boolean = false;

    private _syncPoints: BackingTrackSyncPoint[] = [];
    private _settleUntil: number = 0;
    private _ignoreUntil: number = 0;
    private _driftEma: number | null = null;
    private _correction: number = 1;
    private _resyncLead: number = 10;
    // learned difference between the synth's and the media's start after play() (ms, real time)
    private _startLead: number = 0;
    private _awaitingFirstDriftAfterStart: boolean = false;
    public warmStart: boolean = true;
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
        const ctx = out.spikeContext;
        this.mediaGain = ctx.createGain();
        this.mediaGain.connect(out.spikeMaster);
        this.synthGain = ctx.createGain();
        this.synthGain.connect(out.spikeMaster);
        out.spikeOnWorkletCreated = node => {
            // the synth reaches the speakers through its own gain (mix balance)
            node.disconnect();
            node.connect(this.synthGain);
            for (const cb of this._onSynthWorklet) {
                cb(node);
            }
        };
        if (mode !== 'decode') {
            this.mediaOutput.spikeRouteThrough(ctx, this.mediaGain);
        }
        if (mode === 'nudge' || mode === 'nudgecal') {
            out.spikeOnTimestamp = (frame, mediaTime) => {
                this._countInStamp(frame, mediaTime);
                this._onTimestamp(frame, mediaTime);
            };
        }
        synth.spikeOnMediaPosition = t => {
            this._synthMediaPosition = t;
            this._synthMediaPositionAt = performance.now();
        };
        if (mode === 'seek') {
            media.positionChanged.on(() => this._seekCheck());
        }
    }

    /** mix balance: gain of the backing track (routed <audio>) */
    public readonly mediaGain: GainNode;
    /** mix balance: gain of the synthesizer output */
    public readonly synthGain: GainNode;

    /** mix balance for listening; in decode mode the MP3 is scaled inside the worker */
    public setMix(mediaVolume: number, synthVolume: number) {
        this.mediaGain.gain.value = mediaVolume;
        this.synthGain.gain.value = synthVolume;
        if (this.mode === 'decode') {
            // decode mode: the MP3 is inside the synth stream, so compensate the synth gain
            this.synth.spikePcmGain(synthVolume > 0 ? mediaVolume / synthVolume : 0);
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
        if (this.mode === 'decode' && this._synthMediaPosition >= 0) {
            // the synth is the clock in decode mode, the <audio> element never plays
            return this._synthMediaPosition;
        }
        return this.mediaOutput.audioElement.currentTime * 1000;
    }

    private _lineGuess(map: Map<number, number>, speed: number, fallback: number): number {
        const known = map.get(speed);
        if (known !== undefined) {
            return known;
        }
        if (this.unlearnedGuess !== 'line' || map.size === 0) {
            return fallback;
        }
        const keys = [...map.keys()].sort((a, b) => a - b);
        if (speed <= keys[0]) {
            return map.get(keys[0])!;
        }
        if (speed >= keys[keys.length - 1]) {
            return map.get(keys[keys.length - 1])!;
        }
        let i = 0;
        while (keys[i + 1] < speed) {
            i++;
        }
        const a = keys[i];
        const b = keys[i + 1];
        return map.get(a)! + ((speed - a) / (b - a)) * (map.get(b)! - map.get(a)!);
    }

    /** 2b: how far (in media ms) the audible <audio> output is ahead of its currentTime */
    private _latencyInMedia(): number {
        if (this.mode !== 'nudgecal') {
            return 0;
        }
        const speed = this.media.playbackSpeed;
        return this._lineGuess(this._mediaLatency, speed, 0) * speed;
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

    private _driftWindow: number[] = [];

    private _resyncTo(mediaTime: number, lead: number = 0, learn: boolean = true) {
        const speed = this.media.playbackSpeed;
        this._driftWindow = [];
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
        const latency = this.mode === 'nudgecal' ? this._lineGuess(this._mediaLatency, speed, 0) : 0;
        const mediaAtFrame =
            el.currentTime * 1000 - (ctx.currentTime - frame / ctx.sampleRate) * 1000 * speed + latency * speed;
        const drift = synthMediaTime - mediaAtFrame;
        const settling = now < this._settleUntil;
        let action = '';

        // The media clock can jump by tens of ms right after play/seek. Never act on a single reading:
        // only on two consecutive readings that agree within 3 ms (their mean is used).
        const window = this._driftWindow;
        window.push(drift);
        if (window.length > 3) {
            window.shift();
        }
        const agreed =
            window.length >= 2 && Math.abs(window[window.length - 1] - window[window.length - 2]) < 3
                ? (window[window.length - 1] + window[window.length - 2]) / 2
                : null;

        if (this._awaitingFirstDriftAfterCountIn && agreed !== null) {
            // count-in: the media started `agreed / speed` ms late (synth ahead) -> issue play() that much earlier
            this._awaitingFirstDriftAfterCountIn = false;
            const cur = this._lineGuess(this._mediaStartLatencyBySpeed, speed, this.countInStartGuess);
            const next = Math.max(-50, Math.min(250, cur + agreed / speed));
            this._mediaStartLatencyBySpeed.set(speed, next);
            this.stats.mediaStartLatency[String(speed)] = Math.round(next * 10) / 10;
            const last = this.countInLog[this.countInLog.length - 1];
            if (last) {
                last.agreed = Math.round(agreed * 10) / 10;
                last.learned = Math.round(next * 10) / 10;
            }
        }
        if (this._awaitingFirstDriftAfterStart && window.length >= 3) {
            // learn how much later the synth starts than the media after play() (median of 3 readings)
            this._awaitingFirstDriftAfterStart = false;
            const median = [...window].sort((a, b) => a - b)[1];
            if (this.startAtTarget) {
                // the synth is intentionally behind by the start gap: learn only the rest, per speed
                const cur = this._lineGuess(this._startLeadBySpeed, speed, 0);
                const next = Math.max(-50, Math.min(150, cur - (median + this._startGap) / speed));
                this._startLeadBySpeed.set(speed, next);
                this.stats.startLead = Math.round(next * 10) / 10;
            } else {
                this._startLead = Math.max(-50, Math.min(150, this._startLead - median / speed));
                if (this.compensatedLeadPerSpeed) {
                    this._learnCompLead(speed, median);
                }
                this.stats.startLead = Math.round(this._startLead * 10) / 10;
            }
        }
        if (this._awaitingFirstDriftAfterResync && agreed !== null) {
            // learn the pipeline latency: the synth started `drift` ms off after the last re-sync
            this._awaitingFirstDriftAfterResync = false;
            this._resyncLead = Math.max(0, Math.min(100, this._resyncLead - agreed / speed));
            this.stats.resyncLead = this._resyncLead;
        }

        // at 1x Chrome's media clock is clean (±1 ms); time-stretched speeds jitter by up to ±15 ms
        const settleThreshold = speed === 1 ? this.settleResyncThreshold : 15;
        // start at target: while catching up the synth is intentionally behind by up to the start gap
        const catchingUp = this.startAtTarget && now < this._catchUpUntil;
        const threshold = settling ? settleThreshold + (catchingUp ? this._startGap : 0) : this.nudgeResyncThreshold;
        if (catchingUp && agreed !== null && Math.abs(agreed) < 2) {
            this._catchUpUntil = 0;
        }
        if (agreed !== null && Math.abs(agreed) > threshold) {
            action = 'resync';
            if (this._awaitingFirstDriftAfterStart) {
                // the start itself was off by `agreed`: learn it before the re-sync clears the window
                this._awaitingFirstDriftAfterStart = false;
                this._startLead = Math.max(-50, Math.min(150, this._startLead - agreed / speed));
                if (this.compensatedLeadPerSpeed && !this.startAtTarget) {
                    this._learnCompLead(speed, agreed);
                }
                this.stats.startLead = Math.round(this._startLead * 10) / 10;
            }
            this._resyncTo(this._mediaTimeNow() + latency * speed, this._resyncLead);
        } else if (agreed === null && settling) {
            action = 'wait';
        } else if (this.startAtTarget && this._awaitingFirstDriftAfterStart) {
            action = 'wait';
        } else {
            this._driftEma = this._driftEma === null ? drift : this._driftEma + (drift - this._driftEma) * 0.3;
            const max = catchingUp ? this.catchUpMaxCorrection : this.nudgeMaxCorrection;
            const gain = catchingUp
                ? this.catchUpGainMillis
                : settling && speed === 1
                  ? this.settleNudgeGainMillis
                  : this.nudgeGainMillis;
            const correction = 1 - Math.max(-max, Math.min(max, this._driftEma / gain));
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
            if (this.warmStart) {
                // build the synth's audio pipeline before the first play
                this.synthOutput.spikeKeepAlive = true;
                this.synthOutput.spikeWarmUp();
            }
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
            if (this.speedChangeRule === 'ifDrift') {
                // lap-2 F-9 spike: no forced re-sync; fresh readings decide (nudge, or re-sync above the threshold)
                this._driftWindow = [];
                this._driftEma = null;
                return;
            }
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
        this._synthMediaPosition = -1;
        this._settleUntil = performance.now() + this.settleDuration;
        const mediaTime = this._toMedia(this.media.timePosition) + this._latencyInMedia();
        this._resyncTo(mediaTime, this.mode === 'nudge' || this.mode === 'nudgecal' ? this._resyncLead : 0);
    }
    public get playbackRange(): PlaybackRange | null {
        return this._playbackRange;
    }
    public set playbackRange(value: PlaybackRange | null) {
        // lap-1 F-4: 'none' = both loop (as built), 'media' = media only, 'combined' = neither (we wrap)
        this._playbackRange = value;
        this.media.playbackRange = this.loopOwner === 'combined' ? null : value;
        this.synth.playbackRange = this.loopOwner === 'none' ? value : null;
    }
    public get isLooping(): boolean {
        return this._isLooping;
    }
    public set isLooping(value: boolean) {
        this._isLooping = value;
        this.media.isLooping = this.loopOwner === 'combined' ? false : value;
        this.synth.isLooping = this.loopOwner === 'none' ? value : false;
        this._hookMediaLoop();
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
        if (this.countInMediaMs > 0 && this.mode === 'nudgecal') {
            return this._playWithCountIn();
        }
        this._sendFollowConfig();
        const speed = this.media.playbackSpeed;
        const latency = this._latencyInMedia();
        let mediaTime = this._mediaTimeNow() + latency;
        this._settleUntil = performance.now() + this.settleDuration;
        const nudging = this.mode === 'nudge' || this.mode === 'nudgecal';
        // start handshake: the synth must not start *after* the media, otherwise a beat at the start
        // position is already in the past for it and gets skipped. If the synth is the slower one
        // (startLead > 0) the media start is delayed instead; if the media is slower the synth
        // starts a bit earlier in the song (a few ms of pre-roll).
        let lead = nudging ? this._startLead : 0;
        if (nudging && this.compensatedLeadPerSpeed) {
            lead = this._lineGuess(this._compLeadBySpeed, speed, 0);
        }
        if (this.startAtTarget) {
            // never start past the target: a positive latency offset is caught up after the first beat
            lead = nudging ? this._lineGuess(this._startLeadBySpeed, speed, 0) : 0;
            mediaTime = this._mediaTimeNow() + Math.min(0, latency);
            this._startGap = Math.max(0, latency);
            this._catchUpUntil = this._startGap > 0 ? performance.now() + this.settleDuration : 0;
        }
        this._resyncTo(mediaTime + Math.min(0, lead) * speed, 0, false);
        this._awaitingFirstDriftAfterStart = nudging;
        this.stats.resyncs--; // the start is not counted as a re-sync
        if (this.mode === 'decode') {
            return this.synth.play();
        }
        this.synth.play();
        this._scheduleLoopWrap(Math.max(0, lead));
        if (lead > 0) {
            setTimeout(() => this.media.play(), lead);
            return true;
        }
        return this.media.play();
    }

    // lap-1 F-10 spike: count-in hand-off (see countInMediaMs)
    private _playWithCountIn(): boolean {
        const speed = this.media.playbackSpeed;
        const target = this._mediaTimeNow();
        // media pre-roll (media ms): above 1x always (Chrome drops the start of stretched audio); below 1x opt-in
        const pre = speed > 1 ? this.loopPreRoll : speed < 1 ? this.countInPreRollBelow1 : 0;
        this._sendFollowConfig();
        this._settleUntil = 0;
        this._correction = 1;
        this.synth.spikeCorrection(1);
        this._countIn = { target, speed, pre, frameT: null, playAt: 0 };
        // the media stays paused during the count-in, so the controller ignores the stamps (media not Playing)
        this._resyncTo(target - this.countInMediaMs, 0, false);
        this.stats.resyncs--;
        if (pre > 0) {
            const seq = (this.media as any).sequencer;
            this.media.timePosition = seq.mainTimePositionFromBackingTrack(target - pre, this._mediaDuration());
        }
        this.synth.play();
        return true;
    }

    private _countInStamp(frame: number, synthMediaTime: number) {
        const c = this._countIn;
        if (!c || synthMediaTime < c.target - this.countInMediaMs - 100 || synthMediaTime > c.target) {
            return;
        }
        const ctx = this.audioContext;
        // the context frame where the synth reaches the target (refined on every stamp until the media starts)
        c.frameT = frame + ((c.target - synthMediaTime) / c.speed / 1000) * ctx.sampleRate;
        const dm = this._lineGuess(this._mediaStartLatencyBySpeed, c.speed, this.countInStartGuess);
        c.playAt = c.frameT / ctx.sampleRate - (dm + c.pre / c.speed) / 1000;
        if (this._countInTimer) {
            return;
        }
        const waitMs = (c.playAt - ctx.currentTime) * 1000;
        this._countInTimer = setTimeout(
            () => {
                this._countInTimer = null;
                if (this._countIn !== c) {
                    return;
                }
                // the last few ms: wait on the audio clock (bounded, spike only)
                const until = performance.now() + 30;
                while (ctx.currentTime < c.playAt && performance.now() < until) {
                    // busy wait
                }
                this._startMediaAfterCountIn();
            },
            Math.max(0, waitMs - 12)
        );
    }

    private _startMediaAfterCountIn() {
        const c = this._countIn;
        if (!c) {
            return;
        }
        this._countIn = null;
        const lateMs = (this.audioContext.currentTime - c.playAt) * 1000;
        this.countInLog.push({ speed: c.speed, lateMs: Math.round(lateMs * 10) / 10, agreed: NaN, learned: NaN });
        this._settleUntil = performance.now() + this.settleDuration;
        this._driftWindow = [];
        this._driftEma = null;
        this._ignoreUntil = 0;
        this._awaitingFirstDriftAfterCountIn = true;
        this.media.play();
    }

    // lap-1 F-4 option A: the combined player owns the wrap and restarts both through the start handshake
    private _scheduleLoopWrap(mediaStartDelay: number) {
        if (this._loopTimer) {
            clearTimeout(this._loopTimer);
            this._loopTimer = null;
        }
        if (this.loopOwner !== 'combined' || !this.loopRange || !this._isLooping) {
            return;
        }
        const speed = this.media.playbackSpeed;
        const untilEnd = (this.loopRange.end - 15 - this._mediaTimeNow()) / speed;
        this._loopTimer = setTimeout(() => this._wrapCombined(), Math.max(0, untilEnd) + mediaStartDelay);
    }

    private _wrapCombined() {
        this._loopTimer = null;
        if (!this.loopRange || this.state !== PlayerState.Playing) {
            return;
        }
        this.media.pause();
        this.synth.pause();
        // the backing-track player's sequencer maps media time to time at the current speed already.
        // Above 1x Chrome's time-stretch drops the first ms after play(): pre-roll so that is silence
        const pre = this.media.playbackSpeed > 1 ? this.loopPreRoll : 0;
        const seq = (this.media as any).sequencer;
        this.media.timePosition = seq.mainTimePositionFromBackingTrack(this.loopRange.start - pre, this._mediaDuration());
        this._synthMediaPosition = -1;
        this.loopWraps.push(performance.now());
        const el = this.mediaOutput.audioElement;
        const go = () => this.play();
        if (el.seeking) {
            el.addEventListener('seeked', go, { once: true });
        } else {
            go();
        }
    }

    // lap-1 F-4 option B: the media loops by itself; the synth is silent from 'seeking' to 'seeked'
    // and then restarts at the range start
    private _hookMediaLoop() {
        const el = this.mediaOutput?.audioElement;
        if (this._seekedHooked || !el) {
            return;
        }
        this._seekedHooked = true;
        el.addEventListener('seeking', () => {
            if (this.loopOwner === 'media' && this._isLooping && this.media.state === PlayerState.Playing) {
                this.synth.pause();
            }
        });
        el.addEventListener('seeked', () => {
            if (this.loopOwner !== 'media' || !this._isLooping || this.media.state !== PlayerState.Playing) {
                return;
            }
            const latency = this._latencyInMedia();
            const target = this._mediaTimeNow();
            this._settleUntil = performance.now() + this.settleDuration;
            if (this.startAtTarget) {
                this._startGap = Math.max(0, latency);
                this._catchUpUntil = this._startGap > 0 ? performance.now() + this.settleDuration : 0;
                this._resyncTo(target + Math.min(0, latency), 0);
            } else {
                this._resyncTo(target + latency, this._resyncLead);
            }
            this.synth.play();
            this.loopWraps.push(performance.now());
        });
    }

    public pause(): void {
        if (this._countInTimer) {
            clearTimeout(this._countInTimer);
            this._countInTimer = null;
        }
        this._countIn = null;
        this._awaitingFirstDriftAfterCountIn = false;
        if (this._oneTimeResumeTimer) {
            clearTimeout(this._oneTimeResumeTimer);
            this._oneTimeResumeTimer = null;
        }
        if (this._loopTimer) {
            clearTimeout(this._loopTimer);
            this._loopTimer = null;
        }
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
        if (this.oneTimeMidiMode === 'synthOnly') {
            this.synth.playOneTimeMidiFile(midi);
            return;
        }
        const wasPlaying = this.state === PlayerState.Playing;
        this.pause();
        // follow mode would map the paused media's position onto the one-time MIDI and dispatch all of
        // its events at once, so the synth plays it on its own clock (Play turns follow mode back on)
        this.synth.spikeFollow(false, this._mediaDuration(), this._syncPoints);
        this.synth.playOneTimeMidiFile(midi);
        let lastTick = 0;
        let microSecondsPerQuarter = 500000;
        for (const e of midi.events) {
            lastTick = Math.max(lastTick, e.tick);
            const tempo = (e as unknown as { microSecondsPerQuarterNote?: number }).microSecondsPerQuarterNote;
            if (tempo !== undefined) {
                microSecondsPerQuarter = tempo;
            }
        }
        const durationMs = (lastTick / midi.division) * (microSecondsPerQuarter / 1000) / this.media.playbackSpeed;
        const entry = { at: performance.now(), wasPlaying, durationMs: Math.round(durationMs), resumeAt: null as number | null };
        this.oneTimeLog.push(entry);
        if (this.oneTimeMidiMode === 'pauseBothResume' && wasPlaying) {
            this._oneTimeResumeTimer = setTimeout(() => {
                this._oneTimeResumeTimer = null;
                entry.resumeAt = performance.now();
                this.play();
            }, durationMs + 50);
        }
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
