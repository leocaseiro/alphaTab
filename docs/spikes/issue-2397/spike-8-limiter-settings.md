# Spike 8 — Output limiter settings

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike.
> Run 2026-10-08 during the second design-review lap, on the same machine as the other spikes
> (Chromium 152, macOS, 48 kHz), as an offline Web Audio render in the playground page. No alphaTab
> code is involved: only the `DynamicsCompressorNode` the design uses as its output limiter.
> Raw numbers: [results-2026-10-08.json](./results-2026-10-08.json) (key `spike8Limiter`).
> Script: [spike-8-limiter-console.js](./spike-8-limiter-console.js).

## Why

The design's output limiter (spec §3) gives only threshold −1 dBFS and ratio 20. Review finding
F-13 says the node's other defaults (knee 30 dB, attack 3 ms, release 250 ms) leave it so soft that
raised levels still go over 0 dBFS. It proposes the spike's own settings: knee 0, attack 1 ms,
release 100 ms. The spike's limiter used those at −3 dBFS
(`AlphaSynthAudioWorkletOutput.ts`, spike code).

## Setup

The worst case for clipping is a metronome click landing exactly on a peak of the recording.

- "Recording": a 100 Hz sine peaking at −2.3 dBFS, the mastered recording's peak in spike 5.
- "Click": a 20 ms 1 kHz burst peaking at −11.4 dBFS × `synthVolume` (the click peak in spike 5),
  its crest on a recording crest, at 1 s and 2 s.
- Measured: the output peak, the samples over 0 dBFS, and the recording's own peak between clicks
  (to see whether the limiter changes the backing track's level).

The input peaks at +0.31 dBFS with `synthVolume` 1, +2.32 dBFS with 2 and +3.94 dBFS with 3.

## Results

Output peak in dBFS (samples over 0 dBFS in brackets):

| Limiter | `synthVolume` 1 | 2 | 3 | Recording alone (−2.3 in) | Hot recording (−0.3 dBFS peaks), `synthVolume` 1 |
|---|---:|---:|---:|---:|---:|
| None | +0.31 (14) | +2.32 (254) | +3.94 (454) | −2.30 | +1.83 (270) |
| **As specified:** −1 dBFS, ratio 20, rest default | +0.31 (14) | +2.26 (254) | +3.79 (434) | −2.30 | +1.79 (270) |
| **As proposed:** −1 dBFS, ratio 20, knee 0, attack 1 ms, release 100 ms | −0.10 (0) | **+0.10 (16)** | **+0.26 (30)** | **−1.73** | **+0.07 (10)** |
| Spike's original: −3 dBFS, knee 0, 1 ms / 100 ms | −0.75 (0) | −0.58 (0) | −0.38 (0) | −1.16 | −0.62 (0) |

The hard knee alone is not enough because of Web Audio's automatic make-up gain. With knee 0 the
compressor raises its whole output by 0.6 × the gain reduction it applies at 0 dBFS: +0.57 dB at
−1 dBFS, +1.14 dB at −2 and +1.71 dB at −3 (ratio 20). That pushes the limited peaks back over
0 dBFS, and it makes the backing track louder whenever mixing is on (−2.30 → −1.73 dBFS).

With a trim gain after the compressor that cancels the make-up gain (no sample over 0 dBFS in any
row):

| Limiter, then trim | `synthVolume` 1 | 2 | 3 | Recording alone (−2.3 in) | Hot recording (−0.3 dBFS peaks): peak / recording |
|---|---:|---:|---:|---:|---:|
| **−1 dBFS, knee 0, 1 ms / 100 ms, trim −0.57 dB** | −0.67 | −0.47 | −0.31 | −2.30 | −0.50 / −0.87 |
| −2 dBFS, knee 0, no trim | −0.41 | −0.24 | −0.07 | −1.16 | −0.27 / −0.64 |
| −2 dBFS, knee 0, trim −1.14 dB | −1.55 | −1.38 | −1.21 | −2.30 | −1.41 / −1.78 |
| −3 dBFS, knee 0, trim −1.71 dB | −2.46 | −2.29 | −2.09 | −2.87 | −2.33 / −2.72 |

## What this means for the design

- **F-13 is confirmed, and the gap is wider than the review said.** As specified, the limiter
  barely acts: the worst case passes +0.31 dBFS at default levels and +3.79 dBFS at `synthVolume` 3.
- **The proposed settings still go over 0 dBFS** at `synthVolume` 2 and 3, and even at default
  levels with a hotter master (+0.07 dBFS). They also make the backing track 0.57 dB louder whenever
  mixing is on.
- **What holds:** −1 dBFS, ratio 20, knee 0, attack 1 ms, release 100 ms, followed by a fixed
  −0.57 dB trim. The worst case peaks at −0.31 dBFS with `synthVolume` 3. The recording keeps its own
  level, and a hotter master (peaks at −0.3 dBFS) loses only its top ~0.6 dB.

Confidence: **High** for the node's behaviour (a deterministic offline render).

Not run:
- Firefox and Safari. Their compressors follow the same Web Audio spec; untested.
- Real recordings. The worst case here is synthetic.
- Peaks between samples after encoding.

## How to reproduce

```text
open http://localhost:5173/   (any page works)
paste spike-8-limiter-console.js into the console; it prints one table with every row above
```
