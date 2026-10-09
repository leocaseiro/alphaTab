# Spike 11 — Speed changes during playback, and starts at unlearned speeds

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike.
> Run 2026-10-09 while triaging the second design-review lap, in the sync lab (Chromium 152, macOS,
> mode `nudgecal`, generated beeps, the local `pelados.gp` at 135–145 BPM).
> Settings as the design: settle re-sync threshold 12 ms at 1× and 15 ms elsewhere, settling nudge
> gain 300 ms, and the media latency at unprobed speeds guessed on a straight line (spec §6.4).
> Code (throwaway): `MixSpikePlayer.ts` (`speedChangeRule`, `unlearnedGuess`,
> `compensatedLeadPerSpeed`, `_lineGuess`), `AlphaSynth.ts` (`spikeKeepPositionOnSpeedChange`),
> `demos/sync-spike/index.ts` (`sweepTest`, `unlearnedStartTest`).
> Raw numbers: [results-2026-10-08.json](./results-2026-10-08.json) (key `spike11SpeedChanges`).

## Why

Review finding F-9 proposed two untested rules:

- **Speed change:** settle, and re-sync only if the agreed drift then exceeds the settle threshold
  (instead of always re-syncing). The goal: a held tempo button (notation-hero, 1-BPM steps) doesn't
  re-sync, and cut the synth's notes, at every step.
- **Unlearned speeds:** a speed with no learned start value guesses one on a straight line between
  the nearest learned speeds, instead of 0. The goal: the first start at a new speed (the rhythm
  game's auto-BPM adds 5 BPM per passed loop) is on time without a re-sync.

## 1. A held tempo sweep

12 steps of 0.0072× (about 1 BPM) every 250 ms, after 3 s of settled playback. Clicks are compared
with the beeps from the first step until 2 s after the last.

| Synth on a speed change | Rule | Sweep | Re-syncs (drift rules) | Clicks / beeps | Worst click | Clicks > 20 ms off |
|---|---|---|---:|---|---:|---:|
| as built | always re-sync | 1× → 0.91× | 15 (2) | 10 / 10 | 32 ms | 4 |
| as built | re-sync only above the threshold | 1× → 0.91× | 11 (10) | **16 / 10** | **274 ms** | 9 |
| keeps its position (patch) | re-sync only above the threshold | 1× → 0.91× | 13 (12) | 10 / 10 | 45 ms | 6 |
| keeps its position (patch) | always re-sync | 1× → 0.91× | 14 (1) | 11 / 10 | 105 ms | 3 |
| keeps its position (patch) | re-sync only above the threshold | 0.99× → 0.90× | 12 (11) | 10 / 10 | 55 ms | 4 |
| keeps its position (patch) | re-sync only above the threshold | 0.75× → 0.84× | 13 (12) | 8 / 8 | 42 ms | 2 |

- **Every speed change puts the recording 15–43 ms behind the synth**, right after the step: 48 of 48
  steps across four runs, slowing down and speeding up, near 1× and at 0.75×. It is above the
  15 ms threshold, so a re-sync per step is still needed. "At most one re-sync per sweep" doesn't
  hold in Chrome, under either rule. The clicks really were 20–45 ms off until each re-sync.
- **Without the forced re-sync, the synth's own speed change jumps it.** Today
  `AlphaSynth.updatePlaybackSpeed` rescales the position and seeks (`AlphaSynth.ts:149-153`). In
  follow mode that moved the synth 134–356 ms ahead and added 6 clicks. The forced re-sync hides it.
  A follow-mode synth that keeps its position removes the jump, but not Chrome's 15–43 ms.

## 2. The first start at a speed with no learned start value

Compensated start (the design's start below 1×) with the start value learned per speed (spike patch).
Learned first: 0.5× −36 ms, 0.75× −25.4 ms, 1× +5.7 ms. Then three first starts per cell, each with
the value for that speed removed beforehand, 30 ms before a beat. The speed was probed first, so only
the start value differs.

| Speed | Guess | First click vs the beat (3 starts) | Starts that re-synced |
|---|---|---|---:|
| 0.625× | 0 (as built) | −12.7, −7.4, −12.7 ms | 3 of 3 |
| 0.625× | straight line (−30.7) | +18.0, +18.0, +23.3 ms | 0 of 3 |
| 0.875× | 0 (as built) | −11.3, −6.0, −8.7 ms | 2 of 3 |
| 0.875× | straight line (−9.8) | +4.7, −0.7, +4.7 ms | 0 of 3 |

- **The straight-line guess removes the re-sync after the first start**: 0 of 6 starts, against 5 of
  6 with 0. Each of those re-syncs cuts the notes sounding at that moment.
- At 0.875× the first click lands within 5 ms. At 0.625× it lands 18–23 ms late, once just over the
  ±20 ms of success criterion S4.

## What this means for the design (F-9)

- Keep "re-sync on a speed change". Record why: each change puts Chrome's recording 15–43 ms behind,
  so a held tempo sweep re-syncs, and cuts the synth's sounding notes, at every step. A re-sync that
  keeps notes sounding would be later work.
- Use the straight-line guess for learned start values. It removes the start re-sync. The value
  learned at the new speed then replaces the guess.

## Confidence

- **High** for section 1: 48 of 48 steps, four runs, two speed ranges.
- **Medium** for section 2: three starts per cell, one song, one machine.

Not run:
- a probe value arriving mid-loop;
- the rhythm game's auto-BPM loop end to end;
- the media-start latency of the count-in (it uses the same guess);
- Safari and Firefox.

## How to reproduce

```text
open http://localhost:5188/demos/sync-spike/?mode=nudgecal&src=beeps
(wait for the calibration log line, then in the console:)
spikePlayer.settleResyncThreshold = 12; spikePlayer.settleNudgeGainMillis = 300; spikePlayer.unlearnedGuess = 'line'
spikePlayer.speedChangeRule = 'always';  await spikeSweepTest(1, 12, -0.0072, 250)
spikePlayer.speedChangeRule = 'ifDrift'; await spikeSweepTest(1, 12, -0.0072, 250)
await spikeSweepTest(0.75, 12, 0.0072, 250)
(the "as built" rows: set spikeKeepPositionOnSpeedChange = false in AlphaSynth.ts and reload)

spikePlayer.startAtTarget = false; spikePlayer.compensatedLeadPerSpeed = true
await spikePlayer.spikeCalibrate([0.625, 0.875])
await spikeStartTest(2, 30, 0.5); await spikeStartTest(2, 30, 0.75); await spikeStartTest(2, 30, 1)
for each speed (0.625, 0.875) and guess ('zero', 'line'), three times:
  spikePlayer.unlearnedGuess = guess; spikePlayer._compLeadBySpeed.delete(speed); await spikeStartTest(1, 30, speed)
```
