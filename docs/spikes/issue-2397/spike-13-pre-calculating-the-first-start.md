# Spike 13 — Pre-calculating the first start at a new speed

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike.
> Run 2026-10-11 during the plan review's triage, right after gate D-4 (spec §14 Q-1) was settled as
> "reported, not gated": can alphaTab, or the app, measure what a new speed needs before the BPM changes, so
> the first click lands on time? Sync lab in Chromium 152 (the Claude desktop browser pane), macOS, 48 kHz,
> `baseLatency` 5.3 ms, mode `nudgecal`, generated beeps. Settings as spike 12.
> Code (throwaway): `demos/sync-spike/index.ts` (`spikeStartTest`), `MixSpikePlayer.ts` (`spikeCalibrate`,
> `_compLeadBySpeed`, `_mediaLatency`).
> Raw numbers: [results-2026-10-11.json](./results-2026-10-11.json) (key `spike13PreCalculatingTheFirstStart`).

## Why

The rhythm game's auto-BPM restarts every passed loop at a new speed, and spike 12 put that first click about
+17 ms late (twice +22 ms). Two ways to measure ahead were raised in triage:

- **A muted warm-up:** play each coming speed briefly at volume 0, so its start value is learned before it is heard.
- **Probing ahead:** measure the media's start delay at the coming speed in the background. The probe plays its
  own silent `<audio>` element, so it can run during playback.

`spikeStartTest` already sets the lab's master gain to 0 on every start; the taps that measure the clicks sit
before it. So every learning start in spikes 11 and 12 was already a muted start.

## Method

1. Fresh page. Background probe: 1× 0.2 ms, 0.5× 60 ms, 0.75× 26.6 ms, 1.25× −4.2 ms, 1.5× −4.7 ms.
2. Two starts each at 0.5×, 0.75× and 1× learned the start value: −39.1, −26.5 and +2.7 ms (spike 12: −43.7,
   −29.8, +4.2).
3. At 0.583×, 0.625×, 0.667× and 0.708× (70–85 BPM of 120), each run first removed that speed's learned values:
   - **(a)** a start with the guessed start value, then the next start at the same speed (one learning start
     between them), 3 runs per speed;
   - **(b)** a 1-second muted warm-up start, then a start, 3 runs per speed;
   - **(c)** the media delay probed at that exact speed first (`spikeCalibrate`), then two starts, 2 runs per
     speed.
4. **(d)** For comparison, fully learned and probed speeds: three starts each at 0.5× and 0.75×.

Every start began 30 ms before a beat; the first five clicks were measured against the recording's beeps.

## Results

| Condition | First click vs the beat | Mean |
|---|---|---:|
| (a) guessed start value | +4.6 … +15.3 ms (12 starts) | +10.8 ms |
| (a) after one learning start at that speed | +7.3 … +20.6 ms (12) | +10.9 ms |
| (b) after a 1-second muted warm-up | +6.0 … +18.0 ms (12) | +11.3 ms |
| (c) speed probed first, guessed start value | +0.6 … +20.6 ms (8) | +10.6 ms |
| (c) speed probed first, after one learning start | +0.6 … +22.0 ms (8) | +9.8 ms |
| (d) learned and probed, 0.5× | +10.0, +19.3, +23.3 ms | +17.5 ms |
| (d) learned and probed, 0.75× | +14.0, +14.0, +19.3 ms | +15.8 ms |

- **No re-sync and no skipped first click in 58 starts.**
- **Clicks 2–5 wobble between −26.4 and +18.2 ms in every condition**, learned or not: the recording's own
  time-stretch wobble at slow speeds (S3 allows p95 ≤ 20 ms there).
- **Probing a speed takes about 16 s** (15.9–17.1 s). The probed delay is not a straight line in speed: 0.583×
  47–48.5 ms, 0.625× 35.2 ms, 0.667× 43.1 ms, 0.708× 44.1–44.4 ms, against 0.75× 26.6 ms. Probing helped at
  0.667× and 0.708× (first clicks +0.6…+7.3 ms) and not at 0.625× (+16.6…+22.0 ms).
- **At 1× a learned start lands on time:** −0.7 ms (step 2's second start).
- Step 2's first starts repeat the big misses learning fixes: the page's first Play at 0.5× −24.7 ms with one
  re-sync (spike 12: the same), 0.75× with only 0.5× learned +27.3 ms.

## What this means

- **Pre-calculating does not move the first click at slow speeds.** A guessed start value, a learned one, a
  muted warm-up and a probed speed all land about +10 ms late; fully learned 0.5× and 0.75× land later still
  (+16.7 ms mean, once +23.3 ms).
- **The first click at slow speeds is set by the browser's time-stretching**, not by what alphaTab has learned.
  Learning removes the big misses only: the page's first Play (−24.7 ms and a re-sync) and a speed past the
  learned ones (+27.3 ms).
- **D-4 stays "reported, not gated".** There is nothing to pre-calculate for the auto-BPM step.
- **S4's ±20 ms at other speeds is at its edge at 0.5× even when learned:** +23.3 ms once in three (spike 4:
  +2…+20 ms). The acceptance run (Task 22) should expect it.
- Our design's problem to know about, not a bug in today's synth.

## Confidence

- **Medium**: 58 starts at 6 speeds, one song (generated beeps), one machine, Chromium only.

Not run:
- Safari and Firefox;
- an auto-BPM loop end to end;
- remembering learned values across page loads. It would turn a fresh page into a learned one, which by step 2's
  numbers removes the page's first re-sync, not the +10…+20 ms.

## How to reproduce

```text
open http://localhost:5188/demos/sync-spike/?mode=nudgecal&src=beeps
(click the page once; wait for the mediaLatencyByRate log line, then in the console:)
const p = spikePlayer
p.settleResyncThreshold = 12; p.settleNudgeGainMillis = 300; p.unlearnedGuess = 'line'
p.startAtTarget = false; p.compensatedLeadPerSpeed = true; p._compLeadBySpeed.clear()
for (const s of [0.5, 0.75, 1]) await spikeStartTest(2, 30, s)
for each speed of [0.5833, 0.625, 0.6667, 0.7083]:
  (a) p._compLeadBySpeed.delete(speed); await spikeStartTest(2, 30, speed)           // 3 runs
  (b) delete it; mute (p.masterGain.gain.value = 0), api.playbackSpeed = speed,
      api.play(), wait 1 s, api.pause(); then await spikeStartTest(1, 30, speed)     // 3 runs
  (c) delete it and p._mediaLatency's value; await p.spikeCalibrate([speed]);
      await spikeStartTest(2, 30, speed)                                             // 2 runs
(d) await spikeStartTest(3, 30, 0.5); await spikeStartTest(3, 30, 0.75)
```
