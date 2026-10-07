// SPIKE (#2397) — THROWAWAY measurement harness for synth + backing track synchronization.
//
// URL params: ?mode=free|seek|nudge|nudgecal|decode&src=beeps|mp3&listen=0|1&drums=0|1&metronome=0|1&mv=0..1&sv=0..4
//             &file=/test-data/temp/pelados.gp
//
// With src=beeps the embedded MP3 is replaced by a generated track with a 2 kHz beep exactly on every
// beat (positions computed from the file's own sync points). The synth plays only the metronome.
// Two taps inside Web Audio record the onset frame of every beep (backing track) and every click
// (synth). Both share the AudioContext clock, so click - beep is the audible offset.
import * as alphaTab from '@coderline/alphatab';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import type { MixSpikeMode, MixSpikePlayer } from '@coderline/alphatab/platform/javascript/MixSpikePlayer';
import type { IAudioSampleSynthesizer } from '@coderline/alphatab/synth/IAudioSampleSynthesizer';
import { MidiFileSequencer } from '@coderline/alphatab/synth/MidiFileSequencer';
import type { SynthEvent } from '@coderline/alphatab/synth/synthesis/SynthEvent';
import { Paths } from '../../src/util/Paths';

const params = new URL(window.location.href).searchParams;
const mode = (params.get('mode') ?? 'nudge') as MixSpikeMode;
const src = params.get('src') ?? 'beeps';
// sound is ON unless listen=0 (measurement runs mute themselves while they run)
const listen = params.get('listen') !== '0';
const file = params.get('file') ?? '/test-data/temp/pelados.gp';

const logEl = document.getElementById('log')!;
function log(...args: unknown[]) {
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    logEl.textContent = `${logEl.textContent === 'loading…' ? '' : `${logEl.textContent}\n`}${line}`;
    logEl.scrollTop = logEl.scrollHeight;
    console.log('[spike]', line);
}

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
(document.getElementById('mode') as HTMLSelectElement).value = mode;
(document.getElementById('src') as HTMLSelectElement).value = src;
input('listen').checked = listen;
// keep the mix settings across reloads (changing mode/src reloads the page)
input('drums').checked = params.has('drums') ? params.get('drums') === '1' : src === 'mp3';
input('metronome').checked = params.get('metronome') !== '0';
if (params.has('mv')) {
    input('mediaVol').value = params.get('mv')!;
}
if (params.has('sv')) {
    input('synthVol').value = params.get('sv')!;
}
if (params.has('mtv')) {
    input('metronomeVol').value = params.get('mtv')!;
}
function currentUrl(): URL {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', (document.getElementById('mode') as HTMLSelectElement).value);
    url.searchParams.set('src', (document.getElementById('src') as HTMLSelectElement).value);
    url.searchParams.set('listen', input('listen').checked ? '1' : '0');
    url.searchParams.set('drums', input('drums').checked ? '1' : '0');
    url.searchParams.set('metronome', input('metronome').checked ? '1' : '0');
    url.searchParams.set('mv', input('mediaVol').value);
    url.searchParams.set('sv', input('synthVol').value);
    url.searchParams.set('mtv', input('metronomeVol').value);
    return url;
}
for (const id of ['mode', 'src']) {
    document.getElementById(id)!.addEventListener('change', () => {
        window.location.href = currentUrl().toString();
    });
}
// remember the other settings in the address bar without reloading
for (const id of ['listen', 'drums', 'metronome', 'mediaVol', 'synthVol', 'metronomeVol']) {
    document.getElementById(id)!.addEventListener('change', () => {
        window.history.replaceState(null, '', currentUrl().toString());
    });
}

class SilentSynth implements IAudioSampleSynthesizer {
    public masterVolume = 0;
    public metronomeVolume = 0;
    public outSampleRate = 44100;
    public currentTempo = 120;
    public timeSignatureNumerator = 4;
    public timeSignatureDenominator = 4;
    public activeVoiceCount = 0;
    public noteOffAll(): void {}
    public resetSoft(): void {}
    public resetPresets(): void {}
    public loadPresets(): void {}
    public setupMetronomeChannel(): void {}
    public synthesizeSilent(): void {}
    public dispatchEvent(_e: SynthEvent): void {}
    public synthesize(): SynthEvent[] {
        return [];
    }
    public applyTranspositionPitches(): void {}
    public setChannelTranspositionPitch(): void {}
    public channelSetMute(): void {}
    public channelSetSolo(): void {}
    public resetChannelStates(): void {}
    public channelSetMixVolume(): void {}
    public hasSamplesForProgram(): boolean {
        return true;
    }
    public hasSamplesForPercussion(): boolean {
        return true;
    }
}

function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const w = (o: number, s: string) => {
        for (let i = 0; i < s.length; i++) {
            v.setUint8(o + i, s.charCodeAt(i));
        }
    };
    w(0, 'RIFF');
    v.setUint32(4, 36 + pcm.length * 2, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, pcm.length * 2, true);
    new Int16Array(buf, 44).set(pcm);
    return new Uint8Array(buf);
}

async function mediaDuration(bytes: Uint8Array): Promise<number> {
    const el = new Audio(URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>])));
    await new Promise(r => el.addEventListener('loadedmetadata', r, { once: true }));
    return el.duration * 1000;
}

const settings = new alphaTab.Settings();
settings.fillFromJson({
    core: { fontDirectory: Paths.fontDirectory, logLevel: 'warning' },
    player: {
        playerMode: alphaTab.PlayerMode.EnabledBackingTrack,
        soundFont: Paths.soundFont,
        scrollMode: alphaTab.ScrollMode.Off
    }
} satisfies alphaTab.json.SettingsJson);

// conversions media time <-> alphaTab time (same sync points as the player)
let sequencer!: MidiFileSequencer;
let durationMs = 0;
let beatMediaTimes: number[] = [];

async function prepareScore(bytes: Uint8Array, name: string): Promise<alphaTab.model.Score | null> {
    let score: alphaTab.model.Score;
    try {
        score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
    } catch (e) {
        log(`${name}: could not load (${(e as Error).message})`);
        return null;
    }
    const mp3 = score.backingTrack?.rawAudioFile;
    if (!mp3) {
        log(`${name}: no embedded audio track. This spike needs a Guitar Pro file with an audio track (+ sync points).`);
        return null;
    }
    durationMs = await mediaDuration(mp3);

    const midi = new MidiFile();
    const generator = new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(midi));
    generator.generate();
    sequencer = new MidiFileSequencer(new SilentSynth());
    sequencer.loadMidi(midi);
    sequencer.mainUpdateSyncPoints(generator.syncPoints);
    const metronomeEvents = ((sequencer as any)._mainState.synthData as SynthEvent[]).filter(e => e.isMetronome);
    beatMediaTimes = metronomeEvents.map(e => sequencer.mainTimePositionToBackingTrack(e.time, durationMs));

    if (src === 'beeps') {
        const rate = 48000;
        const pcm = new Int16Array(Math.ceil((durationMs / 1000) * rate));
        const beepFrames = Math.round(rate * 0.003);
        for (const t of beatMediaTimes) {
            const start = Math.round((t / 1000) * rate);
            for (let i = 0; i < beepFrames && start + i < pcm.length; i++) {
                pcm[start + i] = Math.round(Math.sin((2 * Math.PI * 2000 * i) / rate) * 0.6 * 32767);
            }
        }
        score.backingTrack!.rawAudioFile = encodeWav(pcm, rate);
    }
    log(
        `file=${name} src=${src} mode=${mode} duration=${(durationMs / 1000).toFixed(2)}s beats=${beatMediaTimes.length} syncPoints=${generator.syncPoints.length} tracks=${score.tracks.length}`
    );
    return score;
}

const fileNameEl = document.getElementById('fileName')!;
let pendingFileName = '';
async function loadBytes(bytes: Uint8Array, name: string) {
    const score = await prepareScore(bytes, name);
    if (!score) {
        return;
    }
    api.stop();
    tapOnsets.media.length = 0;
    tapOnsets.synth.length = 0;
    // the label is finalised by the playerReady handler (subscribing here would fire immediately
    // because the previous song is still "ready")
    pendingFileName = name;
    fileNameEl.textContent = `${name} — loading, wait for "player ready"…`;
    api.renderScore(
        score,
        score.tracks.map(t => t.index)
    );
}

// file picker + drag & drop anywhere on the page (the file stays in memory only)
document.getElementById('fileInput')!.addEventListener('change', async e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) {
        await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name);
    }
});
window.addEventListener('dragover', e => {
    e.preventDefault();
    document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
window.addEventListener('drop', async e => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const f = e.dataTransfer?.files?.[0];
    if (f) {
        await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name);
    }
});

(globalThis as any).__alphaTabMixSpike = mode;
const api = new alphaTab.AlphaTabApi(document.querySelector('.at-canvas') as HTMLElement, settings);
(window as any).api = api;
const player = (api.player as any).instance as MixSpikePlayer;
(window as any).spikePlayer = player;
// measurement only: put the backing track into the left and the synth into the right channel
player.split = mode === 'decode' && src === 'beeps';

// ---- taps ----
const tapOnsets = { media: [] as number[], synth: [] as number[] };
const tapPeaks = { media: 0, synth: 0 };
const tapCode = `
class SpikeTap extends AudioWorkletProcessor {
    constructor(o) {
        super();
        this.threshold = o.processorOptions.threshold;
        this.cool = 0;
        this.coolFrames = Math.round(sampleRate * 0.1);
        this.peak = 0;
        this.sincePeak = 0;
    }
    process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) {
            for (let i = 0; i < ch.length; i++) {
                const v = Math.abs(ch[i]);
                if (v > this.peak) this.peak = v;
                if (this.cool > 0) { this.cool--; continue; }
                if (v > this.threshold) {
                    this.port.postMessage({ frame: currentFrame + i });
                    this.cool = this.coolFrames;
                }
            }
        }
        this.sincePeak += 128;
        if (this.sincePeak > sampleRate) { this.port.postMessage({ peak: this.peak }); this.sincePeak = 0; this.peak = 0; }
        return true;
    }
}
registerProcessor('spike-tap', SpikeTap);`;

async function setupTaps() {
    const ctx = player.audioContext;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([tapCode], { type: 'application/javascript' })));
    const makeTap = (kind: 'media' | 'synth', threshold: number) => {
        const node = new AudioWorkletNode(ctx, 'spike-tap', { processorOptions: { threshold } });
        node.port.onmessage = e => {
            if (e.data.frame !== undefined) {
                tapOnsets[kind].push(e.data.frame);
            } else if (e.data.peak !== undefined) {
                tapPeaks[kind] = Math.max(tapPeaks[kind], e.data.peak);
            }
        };
        node.connect(ctx.destination);
        return node;
    };
    const tapMedia = makeTap('media', 0.25);
    const tapSynth = makeTap('synth', 0.02);
    if (mode === 'decode') {
        player.onSynthWorkletCreated(node => {
            const splitter = ctx.createChannelSplitter(2);
            node.connect(splitter);
            splitter.connect(tapMedia, 0);
            splitter.connect(tapSynth, 1);
        });
    } else {
        player.mediaOutput.spikeSource!.connect(tapMedia);
        player.onSynthWorkletCreated(node => {
            node.connect(tapSynth);
            // lap-1 spike 2026-10-08: envelope recordings (F-8 re-sync cut, 1.5x first-beat clip)
            (window as any).spikeSynthNode = node;
        });
    }
    applySound();
}

function applySound() {
    player.masterGain.gain.value = input('listen').checked ? 1 : 0;
}
input('listen').addEventListener('change', applySound);

// ---- analysis ----
interface SegmentStats {
    name: string;
    clicks: number;
    matched: number;
    unmatched: number;
    firstWindow: { n: number; meanMs: number; maxAbsMs: number };
    settled: { n: number; meanMs: number; medianMs: number; p95AbsMs: number; maxAbsMs: number; stdMs: number };
    resyncs: number;
    firstOffsets: number[];
    synthOnsets: number;
    mediaOnsets: number;
    fromFrame: number;
}

function nearest(sorted: number[], x: number): number {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < x) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    let best = sorted[lo];
    if (lo > 0 && Math.abs(sorted[lo - 1] - x) < Math.abs(best - x)) {
        best = sorted[lo - 1];
    }
    return best;
}

function analyze(name: string, fromFrame: number, toFrame: number, fromPerf: number, toPerf: number, settleMs: number): SegmentStats {
    const sr = player.audioContext.sampleRate;
    const media = tapOnsets.media.filter(f => f >= fromFrame - sr && f <= toFrame + sr).sort((a, b) => a - b);
    const synth = tapOnsets.synth.filter(f => f >= fromFrame && f <= toFrame);
    const settleFrame = fromFrame + (settleMs / 1000) * sr;
    const first: number[] = [];
    const settled: number[] = [];
    let unmatched = 0;
    for (const s of synth) {
        if (media.length === 0) {
            unmatched++;
            continue;
        }
        const m = nearest(media, s);
        const off = ((s - m) / sr) * 1000;
        if (Math.abs(off) > 150) {
            unmatched++;
            continue;
        }
        (s < settleFrame ? first : settled).push(off);
    }
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : Number.NaN);
    const sortedAbs = settled.map(Math.abs).sort((a, b) => a - b);
    const sorted = [...settled].sort((a, b) => a - b);
    const m = mean(settled);
    const std = Math.sqrt(mean(settled.map(x => (x - m) ** 2)));
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return {
        name,
        clicks: synth.length,
        matched: first.length + settled.length,
        unmatched,
        firstWindow: {
            n: first.length,
            meanMs: r2(mean(first)),
            maxAbsMs: r2(first.length ? Math.max(...first.map(Math.abs)) : Number.NaN)
        },
        settled: {
            n: settled.length,
            meanMs: r2(m),
            medianMs: r2(sorted[Math.floor(sorted.length / 2)] ?? Number.NaN),
            p95AbsMs: r2(sortedAbs[Math.floor(sortedAbs.length * 0.95)] ?? Number.NaN),
            maxAbsMs: r2(sortedAbs[sortedAbs.length - 1] ?? Number.NaN),
            stdMs: r2(std)
        },
        resyncs: player.stats.resyncTimes.filter(t => t >= fromPerf && t <= toPerf).length,
        firstOffsets: [...first, ...settled].slice(0, 12).map(r2),
        synthOnsets: synth.length,
        mediaOnsets: media.length,
        fromFrame
    };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function alphaTabTimeForMedia(mediaTime: number) {
    // api.timePosition is in time at the current speed (the harness's own sequencer always runs at 1x)
    return sequencer.mainTimePositionFromBackingTrack(mediaTime, durationMs) / api.playbackSpeed;
}

async function segment(name: string, action: () => void, durationMs: number, settleMs = 1500): Promise<SegmentStats> {
    const ctx = player.audioContext;
    const fromFrame = Math.round(ctx.currentTime * ctx.sampleRate);
    const fromPerf = performance.now();
    action();
    await sleep(durationMs);
    const toFrame = Math.round(ctx.currentTime * ctx.sampleRate);
    const toPerf = performance.now();
    const stats = analyze(name, fromFrame, toFrame, fromPerf, toPerf, settleMs);
    log(stats);
    return stats;
}

async function runMeasurement() {
    if (src !== 'beeps') {
        log('measurement needs src=beeps');
        return;
    }
    api.stop();
    api.playbackSpeed = 1;
    // measuring: silent, metronome only at full level, both streams unscaled (fixed tap thresholds)
    player.masterGain.gain.value = 0;
    api.metronomeVolume = 1;
    api.changeTrackMute(api.score!.tracks, true);
    player.setMix(1, 1);
    await sleep(500);
    if (mode === 'nudgecal') {
        log('calibrating media latency for 1, 0.5, 1.5 …');
        await player.spikeCalibrate([1, 0.5, 1.5]);
        log({ mediaLatencyByRate: player.stats.mediaLatencyByRate, calibrationMs: player.stats.calibrationMs });
    }
    tapOnsets.media = [];
    tapOnsets.synth = [];
    player.stats.driftLog = [];
    const results: SegmentStats[] = [];
    results.push(await segment('start@0s 1.0x', () => api.play(), 25000));
    results.push(await segment('seek→60s 1.0x', () => (api.timePosition = alphaTabTimeForMedia(60000)), 15000));
    results.push(
        await segment(
            'seek→100s + 0.5x',
            () => {
                api.playbackSpeed = 0.5;
                api.timePosition = alphaTabTimeForMedia(100000);
            },
            15000
        )
    );
    results.push(
        await segment(
            'seek→130s + 1.5x',
            () => {
                api.playbackSpeed = 1.5;
                api.timePosition = alphaTabTimeForMedia(130000);
            },
            15000
        )
    );
    api.pause();
    applySound();
    applyMix();
    applyVolumes();
    const summary = {
        mode,
        sampleRate: player.audioContext.sampleRate,
        baseLatency: player.audioContext.baseLatency,
        outputLatency: player.audioContext.outputLatency,
        peaks: tapPeaks,
        totalResyncs: player.stats.resyncs,
        resyncLeadMs: Math.round(player.stats.resyncLead * 10) / 10,
        mediaLatencyByRate: player.stats.mediaLatencyByRate,
        calibrationMs: player.stats.calibrationMs,
        decodeMs: Math.round(player.stats.decodeMs),
        pcmMB: Math.round(player.stats.pcmBytes / 1e5) / 10,
        segments: results
    };
    (window as any).spikeResults = summary;
    (window as any).spikeDriftLog = player.stats.driftLog;
    log('DONE', summary);
    return summary;
}
(window as any).spikeRun = runMeasurement;

/**
 * Start test: N plays from different positions; reports the offset of the first clicks after each Play.
 * beforeBeatMs: how long before a beat the playback starts (0 = exactly on a beat).
 */
async function startTest(n: number, beforeBeatMs: number, speed = 1) {
    const sr = player.audioContext.sampleRate;
    player.masterGain.gain.value = 0;
    api.metronomeVolume = 1;
    api.changeTrackMute(api.score!.tracks, true);
    player.setMix(1, 1);
    api.playbackSpeed = speed;
    const rows: {
        startMedia: number;
        first: number[];
        lockMs: number | null;
        resyncs: number;
        firstGap: number | null;
        skipped: boolean;
        counts: string;
    }[] = [];
    for (let i = 0; i < n; i++) {
        api.pause();
        await sleep(400);
        const beat = beatMediaTimes[40 + i * 23];
        const startMedia = beat - beforeBeatMs;
        api.timePosition = alphaTabTimeForMedia(startMedia);
        await sleep(300);
        tapOnsets.media.length = 0;
        tapOnsets.synth.length = 0;
        const ctx = player.audioContext;
        const playFrame = ctx.currentTime * sr;
        const playT = performance.now();
        api.play();
        await sleep(speed < 1 ? 4500 : 2500);
        const resyncs = player.stats.driftLog.filter(e => e.t > playT && e.action === 'resync').length;
        const media = [...tapOnsets.media].sort((a, b) => a - b);
        const offs = tapOnsets.synth
            .filter(f => f > playFrame)
            .slice(0, 5)
            .map(f => Math.round((((f - nearest(media, f)) / sr) * 1000) * 10) / 10);
        // ms after Play until clicks stay within 3 ms
        let lockMs: number | null = null;
        const synthAfter = tapOnsets.synth.filter(f => f > playFrame);
        for (let k = 0; k < synthAfter.length; k++) {
            const ok = synthAfter.slice(k).every(f => Math.abs(((f - nearest(media, f)) / sr) * 1000) < 3);
            if (ok) {
                lockMs = Math.round(((synthAfter[k] - playFrame) / sr) * 1000);
                break;
            }
        }
        // skip check: the first backing-track beep after Play must have its own click (within 50 ms)
        const mediaAfter = media.filter(f => f > playFrame);
        const firstGap =
            mediaAfter.length > 0 && synthAfter.length > 0
                ? Math.round(((synthAfter[0] - mediaAfter[0]) / sr) * 1000 * 10) / 10
                : null;
        const skipped = firstGap === null || Math.abs(firstGap) > 50;
        const counts = `${synthAfter.length}/${mediaAfter.length}`;
        rows.push({ startMedia: Math.round(startMedia), first: offs, lockMs, resyncs, firstGap, skipped, counts });
    }
    api.pause();
    applySound();
    applyMix();
    applyVolumes();
    log({ startTest: { beforeBeatMs, rows } });
    return rows;
}
(window as any).spikeStartTest = startTest;

/**
 * Loop test (lap-1 F-4): loops `bars` bars from beat 40 for `wraps` repetitions and checks every beat:
 * each backing-track beep must have its own click. Reports offsets, missing/extra clicks and the gap at each wrap.
 */
async function loopTest(owner: 'combined' | 'media', speed: number, bars = 2, wraps = 10, beatsPerBar = 4) {
    const sr = player.audioContext.sampleRate;
    player.masterGain.gain.value = 0;
    api.metronomeVolume = 1;
    api.changeTrackMute(api.score!.tracks, true);
    player.setMix(1, 1);
    api.pause();
    api.playbackSpeed = speed;
    await sleep(400);
    const k0 = 40;
    const k1 = k0 + bars * beatsPerBar;
    const startMedia = beatMediaTimes[k0];
    const endMedia = beatMediaTimes[k1];
    const beatMs = (beatMediaTimes[k0 + 1] - beatMediaTimes[k0]) / speed;
    api.timePosition = alphaTabTimeForMedia(endMedia);
    await sleep(150);
    const endTick = api.tickPosition;
    api.timePosition = alphaTabTimeForMedia(startMedia);
    await sleep(150);
    const startTick = api.tickPosition;
    player.loopOwner = owner;
    player.loopRange = { start: startMedia, end: endMedia };
    player.loopWraps = [];
    (api as any).playbackRange = { startTick, endTick };
    api.isLooping = true;
    await sleep(300);
    tapOnsets.media.length = 0;
    tapOnsets.synth.length = 0;
    const playFrame = player.audioContext.currentTime * sr;
    api.play();
    const repMs = (endMedia - startMedia) / speed;
    await sleep(repMs * (wraps + 1) + 300);
    api.pause();
    api.isLooping = false;
    (api as any).playbackRange = null;
    player.loopOwner = 'none';
    await sleep(300);
    const media = tapOnsets.media.filter(f => f > playFrame).sort((a, b) => a - b);
    const synth = tapOnsets.synth.filter(f => f > playFrame).sort((a, b) => a - b);
    const offsets: number[] = [];
    let missing = 0;
    for (const m of media) {
        const off = ((nearest(synth, m) - m) / sr) * 1000;
        if (Math.abs(off) <= 50) {
            offsets.push(off);
        } else {
            missing++;
        }
    }
    let extra = 0;
    for (const s of synth) {
        if (Math.abs(((s - nearest(media, s)) / sr) * 1000) > 50) {
            extra++;
        }
    }
    // gap at each wrap: beep intervals longer than one beat + 15 ms
    const gaps: number[] = [];
    for (let i = 1; i < media.length; i++) {
        const d = ((media[i] - media[i - 1]) / sr) * 1000;
        if (d > beatMs + 15) {
            gaps.push(Math.round(d - beatMs));
        }
    }
    const abs = offsets.map(Math.abs).sort((a, b) => a - b);
    const p95 = abs.length ? Math.round(abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] * 10) / 10 : null;
    const mean = offsets.length ? Math.round((offsets.reduce((a, b) => a + b, 0) / offsets.length) * 10) / 10 : null;
    const result = {
        owner,
        speed,
        startAtTarget: player.startAtTarget,
        beeps: media.length,
        clicks: synth.length,
        missing,
        extra,
        mean,
        p95,
        wraps: player.loopWraps.length,
        gaps,
        beatMs: Math.round(beatMs)
    };
    applySound();
    applyMix();
    applyVolumes();
    log({ loopTest: result });
    return result;
}
(window as any).spikeLoopTest = loopTest;
(window as any).spikeTaps = tapOnsets;
(window as any).spikeDebug = {
    get beatMediaTimes() {
        return beatMediaTimes;
    },
    get sequencer() {
        return sequencer;
    },
    alphaTabTimeForMedia
};
(window as any).spikeAnalyze = analyze;

document.getElementById('play')!.addEventListener('click', () => api.playPause());
document.getElementById('measure')!.addEventListener('click', () => runMeasurement());
document.getElementById('speed')!.addEventListener('change', e => {
    api.playbackSpeed = Number.parseFloat((e.target as HTMLSelectElement).value);
});
const metronomeEl = document.getElementById('metronome') as HTMLInputElement;
const drumsEl = document.getElementById('drums') as HTMLInputElement;
const metronomeVolEl = document.getElementById('metronomeVol') as HTMLInputElement;
function applyMix() {
    api.metronomeVolume = metronomeEl.checked ? Number.parseFloat(metronomeVolEl.value) : 0;
    if (api.score) {
        api.changeTrackMute(api.score.tracks, !drumsEl.checked);
    }
}
metronomeEl.addEventListener('change', applyMix);
metronomeVolEl.addEventListener('input', applyMix);
drumsEl.addEventListener('change', applyMix);
const mediaVolEl = document.getElementById('mediaVol') as HTMLInputElement;
const synthVolEl = document.getElementById('synthVol') as HTMLInputElement;
function applyVolumes() {
    player.setMix(Number.parseFloat(mediaVolEl.value), Number.parseFloat(synthVolEl.value));
}
mediaVolEl.addEventListener('input', applyVolumes);
synthVolEl.addEventListener('input', applyVolumes);

api.playerReady.on(async () => {
    applyMix();
    applyVolumes();
    fileNameEl.textContent = pendingFileName;
    log('player ready');
    (window as any).spikeReady = true;
    if (mode === 'nudgecal') {
        log('calibrating media latency in the background (silent) …');
        await player.spikeCalibrate([1, 0.5, 0.75, 1.25, 1.5]);
        log({ mediaLatencyByRate: player.stats.mediaLatencyByRate });
    }
});

// live readout: how far is each metronome click from the backing track's beep (beeps only)
const liveEl = document.getElementById('live')!;
let liveSeen = 0;
setInterval(() => {
    const speed = api.playbackSpeed;
    const lat = player.stats.mediaLatencyByRate[String(speed)];
    const calib =
        mode === 'nudgecal'
            ? lat === undefined
                ? `Chrome latency @${speed}×: calibrating…`
                : `Chrome latency @${speed}×: ${lat} ms (compensated)`
            : mode === 'nudge'
              ? `Chrome latency @${speed}×: not compensated`
              : '';
    if (src !== 'beeps') {
        liveEl.textContent = `live: ${calib} — switch Audio to "generated beeps" to see click-vs-beep offsets`;
        return;
    }
    const sr = player.audioContext.sampleRate;
    const media = [...tapOnsets.media].sort((a, b) => a - b);
    const recent = tapOnsets.synth.slice(-8);
    if (media.length === 0 || recent.length === 0 || tapOnsets.synth.length === liveSeen) {
        return;
    }
    liveSeen = tapOnsets.synth.length;
    const offsets = recent
        .map(s => ((s - nearest(media, s)) / sr) * 1000)
        .filter(o => Math.abs(o) < 150)
        .map(o => Math.round(o));
    const mean = offsets.length ? Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length) : 0;
    liveEl.textContent = `live @${speed}×: click − beep (last ${offsets.length}): ${offsets.map(o => (o > 0 ? `+${o}` : `${o}`)).join(' ')} ms → mean ${mean > 0 ? '+' : ''}${mean} ms   ${calib}`;
}, 400);

(async () => {
    await setupTaps();
    const bytes = new Uint8Array(await (await fetch(file)).arrayBuffer());
    await loadBytes(bytes, file.split('/').pop() ?? file);
})();
