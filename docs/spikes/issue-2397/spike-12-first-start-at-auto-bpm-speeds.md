# Spike 12 — The first start at the rhythm game's auto-BPM speeds

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike.
> Run 2026-10-10 during the plan review, for decision gate D-4 (spec §14 Q-1: does S4 gate the first Play at
> a speed with no learned start value?). Sync lab in Chromium 152 (the Claude desktop browser pane), macOS,
> 48 kHz, `baseLatency` 5.3 ms, mode `nudgecal`, generated beeps, the local `pelados.gp`.
> Settings as spike 11 §2: compensated start with the start value learned per speed, settle re-sync
> threshold 12 ms, settling nudge gain 300 ms, straight-line guess for unlearned speeds.
> Code (throwaway): `demos/sync-spike/index.ts` (`spikeStartTest`), `MixSpikePlayer.ts`
> (`_compLeadBySpeed`, `_mediaLatency`, `_lineGuess`).
> Raw numbers: [results-2026-10-10.json](./results-2026-10-10.json) (key `spike12FirstStartAtAutoBpmSpeeds`).

## Why

Spike 11 §2 measured the first start at two unlearned speeds (0.625×, 0.875×), with the media latency
probed first, so only the start value was guessed. Two things make the case more common than "the first
Play" suggests:

- **The rhythm game's auto-BPM** (`useAutoBpm.ts`, alphaTabWebsite) adds 5 BPM after each passed loop and
  sets `playbackSpeed` to the new BPM over the song's BPM. Each step lands on a speed nobody has learned yet.
  A song practised from half speed spends those steps between 0.5× and 0.75×, where spike 11 saw the worst
  guess (+18…+23 ms).
- **A new speed is unprobed too.** The background probe covers 1, 0.5, 0.75, 1.25 and 1.5×, so the first
  start at 0.583× guesses the media latency as well as the start value.

## Method

1. Fresh page. The background probe measured the media latency: 1× 0.3 ms, 0.5× 60 ms, 0.75× 26.6 ms,
   1.25× −4.2 ms, 1.5× −5.1 ms.
2. Two starts each at 0.5×, 0.75× and 1× learned the start value: −43.7, −29.8 and +4.2 ms (spike 11:
   −36, −25.4, +5.7).
3. For each speed below, three first starts 30 ms before a beat, each with **both** the start value and the
   media latency for that speed removed beforehand, so both come from the straight-line guess.

## 1. First starts between learned speeds (both values guessed)

| Speed | BPM (of 120) | Guessed start value | Guessed media latency | First click vs the beat (3 starts) | Re-syncs | Skipped |
|---|---:|---:|---:|---|---:|---:|
| 0.542× | 65 | −41.4 ms | 54.4 ms | +16.6, +16.6, +16.6 ms | 0 | 0 |
| 0.583× | 70 | −39.1 ms | 48.9 ms | +16.6, +19.3, **+22.0** ms | 0 | 0 |
| 0.625× | 75 | −36.8 ms | 43.3 ms | +16.6, +16.6, +16.6 ms | 0 | 0 |
| 0.667× | 80 | −34.5 ms | 37.7 ms | **+22.0**, +16.6, +16.6 ms | 0 | 0 |
| 0.708× | 85 | −32.2 ms | 32.2 ms | +16.6, +16.6, +16.6 ms | 0 | 0 |
| 0.833× | 100 | −18.5 ms | 17.9 ms | +11.3, +11.3, +16.7 ms | 0 | 0 |
| 0.917× | 110 | −7.1 ms | 9.1 ms | +6.0, +6.0, +6.0 ms | 0 | 0 |

- **No re-sync and no skipped click in 21 first starts**; the click count matched the beat count every time.
- **19 of 21 first clicks within S4's ±20 ms.** The two misses are +22.0 ms, 2 ms over.
- **The guess is late, and the same way every time:** about +17 ms between 0.54× and 0.71×, +11…+17 ms at
  0.83×, +6 ms at 0.92×. The repeated +16.6 ms looks quantized (a media start step at these rates?
  unverified).
- The 2nd–4th clicks were within ±16 ms while settling (worst −16.0 ms at 0.917×).
- One start moves the learned value most of the way: at 0.625× the guess −36.8 ms became −28…−33 ms.

## 2. First starts with less learned (from step 2)

| Start | What was learned before | First click | Re-syncs |
|---|---|---:|---:|
| 0.5×, the first start of the page | nothing (the start value is 0) | −24.7 ms | 1 |
| 0.75× | 0.5× only (the guess is that one value) | +36.7 ms | 1 |
| 1× (compensated start; the design starts at the target at 1×, so not representative) | 0.5× and 0.75× | +34.0 ms | 1 |

The first start of a page lands where spike 4 put it (0.5×: −29.6 ms) and re-syncs once. The design keeps
learned values in memory only (`PerSpeedValues`), so every page load starts here.

## What this means for D-4

- Between learned speeds, the straight-line guess does its job: no re-sync, no skipped click, and the first
  click within ±20 ms in 19 of 21 starts. A ±20 ms gate would fail on 2 ms.
- The first start of a page and a speed beyond the learned ones miss by 25–37 ms and re-sync once. That is
  the case S4's "(open)" item describes (spike 4).
- The design's own problem, not a bug in today's synth: the start value isn't a straight line in speed
  (learned −43.7 ms at 0.5×, −29.8 ms at 0.75×, +4.2 ms at 1×).

## Confidence

- **Medium**: 21 starts at 7 speeds, one song, one machine, Chromium only.

Not run:
- the auto-BPM loop end to end (the speed change at a loop wrap, then the wrap's start at the new speed);
- Safari and Firefox;
- a second song.

## How to reproduce

```text
open http://localhost:5188/demos/sync-spike/?mode=nudgecal&src=beeps
(wait for the mediaLatencyByRate log line, then in the console:)
const p = spikePlayer
p.settleResyncThreshold = 12; p.settleNudgeGainMillis = 300; p.unlearnedGuess = 'line'
p.startAtTarget = false; p.compensatedLeadPerSpeed = true; p._compLeadBySpeed.clear()
for (const s of [0.5, 0.75, 1]) await spikeStartTest(2, 30, s)
for each speed of [0.5417, 0.5833, 0.625, 0.6667, 0.7083, 0.8333, 0.9167], three times:
  p._compLeadBySpeed.delete(speed); p._mediaLatency.delete(speed); await spikeStartTest(1, 30, speed)
```
