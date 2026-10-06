// SPIKE (#2397) — THROWAWAY measurement harness for synth + backing track synchronization.
//
// URL params: ?mode=free|seek|nudge|decode&src=beeps|mp3&listen=1&file=/test-data/temp/pelados.gp
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
const listen = params.get('listen') === '1';
const file = params.get('file') ?? '/test-data/temp/pelados.gp';

const logEl = document.getElementById('log')!;
function log(...args: unknown[]) {
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    logEl.textContent = `${logEl.textContent === 'loading…' ? '' : `${logEl.textContent}\n`}${line}`;
    logEl.scrollTop = logEl.scrollHeight;
    console.log('[spike]', line);
}

(document.getElementById('mode') as HTMLSelectElement).value = mode;
(document.getElementById('src') as HTMLSelectElement).value = src;
(document.getElementById('listen') as HTMLInputElement).checked = listen;
if (src === 'mp3') {
    (document.getElementById('drums') as HTMLInputElement).checked = true;
}
for (const id of ['mode', 'src', 'listen']) {
    document.getElementById(id)!.addEventListener('change', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('mode', (document.getElementById('mode') as HTMLSelectElement).value);
        url.searchParams.set('src', (document.getElementById('src') as HTMLSelectElement).value);
        url.searchParams.set('listen', (document.getElementById('listen') as HTMLInputElement).checked ? '1' : '0');
        window.location.href = url.toString();
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

async function prepareScore(): Promise<alphaTab.model.Score> {
    const bytes = new Uint8Array(await (await fetch(file)).arrayBuffer());
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
    const mp3 = score.backingTrack!.rawAudioFile!;
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
        `file=${file} src=${src} mode=${mode} duration=${(durationMs / 1000).toFixed(2)}s beats=${beatMediaTimes.length} syncPoints=${generator.syncPoints.length}`
    );
    return score;
}

(globalThis as any).__alphaTabMixSpike = mode;
const api = new alphaTab.AlphaTabApi(document.querySelector('.at-canvas') as HTMLElement, settings);
(window as any).api = api;
const player = (api.player as any).instance as MixSpikePlayer;
(window as any).spikePlayer = player;
player.split = mode === 'decode';

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
        player.onSynthWorkletCreated(node => node.connect(tapSynth));
    }
    player.masterGain.gain.value = listen ? 1 : 0;
}

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
    return sequencer.mainTimePositionFromBackingTrack(mediaTime, durationMs) / sequencer.playbackSpeed;
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
(window as any).spikeTaps = tapOnsets;
(window as any).spikeAnalyze = analyze;

document.getElementById('play')!.addEventListener('click', () => api.playPause());
document.getElementById('measure')!.addEventListener('click', () => runMeasurement());
document.getElementById('speed')!.addEventListener('change', e => {
    api.playbackSpeed = Number.parseFloat((e.target as HTMLSelectElement).value);
});
const metronomeEl = document.getElementById('metronome') as HTMLInputElement;
const drumsEl = document.getElementById('drums') as HTMLInputElement;
function applyMix() {
    api.metronomeVolume = metronomeEl.checked ? 1 : 0;
    if (api.score) {
        api.changeTrackMute(api.score.tracks, !drumsEl.checked);
    }
}
metronomeEl.addEventListener('change', applyMix);
drumsEl.addEventListener('change', applyMix);
const mediaVolEl = document.getElementById('mediaVol') as HTMLInputElement;
const synthVolEl = document.getElementById('synthVol') as HTMLInputElement;
function applyVolumes() {
    // measuring needs both streams unscaled
    if (src === 'beeps') {
        player.setMix(1, 1);
        return;
    }
    player.setMix(Number.parseFloat(mediaVolEl.value), Number.parseFloat(synthVolEl.value));
}
mediaVolEl.addEventListener('input', applyVolumes);
synthVolEl.addEventListener('input', applyVolumes);

api.playerReady.on(async () => {
    applyMix();
    applyVolumes();
    log('player ready');
    (window as any).spikeReady = true;
    if (mode === 'nudgecal' && src === 'mp3') {
        log('calibrating media latency in the background (silent) …');
        await player.spikeCalibrate([1, 0.5, 0.75, 1.25, 1.5]);
        log({ mediaLatencyByRate: player.stats.mediaLatencyByRate });
    }
});

(async () => {
    await setupTaps();
    const score = await prepareScore();
    api.renderScore(score, [0]);
})();
