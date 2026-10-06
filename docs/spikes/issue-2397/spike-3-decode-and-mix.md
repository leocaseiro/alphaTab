# Spike 3 — Decode the backing track and mix it inside the synth worker

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike.
> Throwaway code on branch `spike/2397-sync-options`. Method, environment and the side-by-side
> table: [comparison.md](./comparison.md).

## The idea

There's only one clock, because there's only one audio stream.

- On load, the embedded backing track (MP3) is decoded with `AudioContext.decodeAudioData`.
  The raw samples (`Float32Array` per channel) are transferred to the synth worker.
- The worker renders the synth (metronome + tracks) in the backing track's time axis, as in
  the other spikes. For every frame it also adds the backing track sample at that same media
  time. The `<audio>` element is never played.
- The synth is the clock: the cursor follows the synth's position (like synthesizer mode).

```ts
// AlphaSynthBase._spikeMixPcm(): per micro buffer, after synthesizing
for (let f = 0; f < frames; f++) {
    const pos = (mediaStart + f * mediaPerFrame) * framesPerMs;   // media time → sample index
    const i = Math.floor(pos);
    const l = left[i] + (left[i + 1] - left[i]) * (pos - i);      // linear interpolation
    samples[o] += l;  samples[o + 1] += r;                         // mixed into the synth output
}
```

For measuring only, the spike can write the backing track into the left channel and the synth
into the right channel ("split"), so the two can be told apart in one stream.

## Results

Offset = click start − beep start, measured inside Web Audio.

| Scenario | Clicks | First 1.5 s | Settled mean | Settled p95 \|offset\| | Settled max | Re-syncs |
|---|---:|---|---:|---:|---:|---:|
| Play from 0:00, 1.0× | 57 | mean −0.6 ms (max 1.2) | −0.66 ms | 1.29 ms | 1.35 ms | 1 |
| Seek to 1:00, 1.0× | 35 | mean −0.5 ms (max 0.9) | −0.65 ms | 1.31 ms | 1.33 ms | 1 |
| Seek to 1:40, 0.5× | 17 | mean −0.7 ms (max 0.9) | −0.74 ms | 1.27 ms | 1.27 ms | 1 |
| Seek to 2:10, 1.5× | 21 | mean −0.5 ms (max 1.3) | −0.69 ms | 1.31 ms | 1.31 ms | 1 |

The constant **−0.65 ms ± 0.4 ms** is the floor of the measurement. The synth starts events at
64-frame micro-buffer boundaries (1.33 ms at 48 kHz), so a click is 0–1.33 ms early. That makes
this spike the calibration reference for the other spikes: "−0.65 ms" means "perfectly aligned".
The re-syncs are only the ones play/seek trigger. There's no correction loop.

### Cost

| Measure | Your MP3 (3:24, 4.65 MB) |
|---|---|
| Decode time (`decodeAudioData`) | **406–429 ms**, off the main thread. The longest main-thread gap during the decode was 6 ms |
| Memory for the decoded audio | **78.5 MB** (stereo float32 at 48 kHz). 39 MB as 16-bit. Plus a temporary copy while transferring |
| Main thread during playback | No media clock to poll, and no correction messages |

## What you would hear

- **1.0×: perfect.** The metronome and synth tracks are sample-locked to the backing track,
  from the very first beat. There's no late first click: one stream means nothing to line up.
- **0.5× / 1.5×: the backing track changes pitch.** The worker reads the samples at the playback
  speed (plain resampling), so at 0.5× the MP3 plays an **octave lower** and at 1.5× a fifth
  higher. Timing stays exact. Keeping the pitch needs a time-stretch inside the worker
  (WSOLA or a phase vocoder, like the browser does inside `<audio>`): a few hundred lines of
  DSP plus CPU per frame. Not built.
- **External media (YouTube) can't use this at all.** There's no access to its samples.

## Pros / cons (from the measurements)

| Pros | Cons |
|---|---|
| Sample-exact (±0.4 ms, the measurement floor) at every speed and after every seek | Pitch changes at any speed ≠ 1× unless a time-stretch is written |
| No start offset, no controller, no re-syncs | 78.5 MB RAM for a 3:24 song (39 MB as Int16) + 0.4 s decode per load |
| Smallest runtime work: no clocks to compare | Doesn't work for external media (YouTube) |
| Exact even if the main thread is busy (no media clock involved) | The backing track's audio now depends on the synth pipeline: synth underruns also drop the MP3 |

## How to reproduce

```text
open http://localhost:5173/demos/sync-spike/?mode=decode&src=beeps     (measure)
open http://localhost:5173/demos/sync-spike/?mode=decode&src=mp3&listen=1   (listen; try 0.5×)
```

Code: `MixSpikePlayer._decodeAndSend` and `AlphaSynthBase._spikeMixPcm` / `spikeLoadPcm`.
