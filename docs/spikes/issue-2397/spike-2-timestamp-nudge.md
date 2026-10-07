# Spike 2 — Timestamp lock + gentle speed nudging (and 2b: + speed calibration)

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike.
> Throwaway code on branch `spike/2397-sync-options`. Method, environment and the side-by-side
> table: [comparison.md](./comparison.md).

## The idea

- The backing track or external media stays the clock (cursor unchanged). The worker synth
  follows the sync points and renders in the media's time axis (shared base).
- **Timestamps instead of positions.** Every chunk of samples the worker sends carries the media
  time of its first frame. The AudioWorklet knows exactly which frame it is outputting
  (`currentFrame`), so about every 50 ms it reports *"at context frame F I am rendering media time T"*.
- **Compare on one clock.** The `<audio>` element is routed through the synth's `AudioContext`
  (`createMediaElementSource`). The MP3 and the synth then share one clock and one output latency.
  The main thread turns the worklet's frame into the MP3's `currentTime` at that same frame.
- **Correct gently.** Small drift → the synth's speed is nudged by at most ±1%. That only moves when
  notes start, never their pitch. Large drift (> 120 ms, or > 15 ms in the first 1.5 s after
  play/seek/speed change) → one re-sync, with a lead the controller learns from the previous re-sync.

```ts
// MixSpikePlayer._onTimestamp(frame, synthMediaTime): runs ~20×/s, triggered by the worklet
const mediaAtFrame =
    el.currentTime * 1000 - (ctx.currentTime - frame / ctx.sampleRate) * 1000 * speed
    + latency * speed;                                  // 2b only: calibrated <audio> latency (below)
const drift = synthMediaTime - mediaAtFrame;            // ms, + = synth ahead
if (Math.abs(drift) > (settling ? 15 : 120)) {
    this._resyncTo(this._mediaTimeNow() + latency * speed, this._resyncLead);
} else {
    this._driftEma = this._driftEma === null ? drift : this._driftEma + (drift - this._driftEma) * 0.3;
    const correction = 1 - clamp(this._driftEma / 3000, -0.01, 0.01); // ±1% max
    this.synth.spikeCorrection(correction);             // worker: media time advances by speed × correction
}
```

Worker side: each micro buffer (64 frames) advances the synth's media time by
`duration × playbackSpeed × correction`, then dispatches the MIDI events up to the MIDI time
the sync points map that media time to (`AlphaSynthBase._spikeOnSampleRequest`).

## Variant 2b — calibrating Chrome's time-stretch latency

Spike 2 as first built was precise at 1.0× but **57 ms off at 0.5×**. The cause turned out to be
Chrome, not the controller. When an `<audio>` plays at a speed other than 1×, its pitch-preserving
time-stretch makes the audio you hear run *ahead* of what `currentTime` reports:

| Speed | `currentTime` minus heard audio (clicks only) | (music + beeps) |
|---|---|---|
| 1.0× | +0 … +2 ms | +0.7 ms |
| 0.75× | +31 … +39 ms | +34 ms |
| 0.5× | +53 … +70 ms (stable over 40 s, mean ≈ 64) | +63 ms |
| 1.25× | −1 … −3 ms | — |
| 1.5× | −4 … −5 ms | −3 ms |

The value depends on the speed and on the browser, but **not on the content**. So variant 2b
measures it at runtime. A silent probe (a generated beep WAV, routed into a tap and never to the
speakers) plays at the target speed, and the median offset is stored per speed. The controller
then aligns to `currentTime + latency`.

Measured by the probe in this run: 1.0× → **0.1 ms**, 0.5× → **60 ms**, 1.5× → **−3.6 ms**.
Probe duration: 3.9 s / 7.8 s / 2.6 s. That's longer than it needs to be: the probe WAV
is 4 s of media time and could be cut to about 1 s.

## Results

Offset = click start − beep start, measured inside Web Audio. Perfect alignment reads about
**−0.65 ms** (see Spike 3). "Settled" = after the first 1.5 s of each scenario.

### Spike 2 (no calibration)

| Scenario | Clicks | First 1.5 s | Settled mean | Settled p95 \|offset\| | Settled max | Re-syncs |
|---|---:|---|---:|---:|---:|---:|
| Play from 0:00, 1.0× | 57 | mean 4.8 ms (max 5.3) | **+2.0 ms** | **3.0 ms** | 3.8 ms | 1 |
| Seek to 1:00, 1.0× | 35 | mean −8.9 ms (max 10.7) | **+0.3 ms** | **4.2 ms** | 6.6 ms | 1 |
| Seek to 1:40, 0.5× | 17 | mean 46.3 ms (max 78) | +56.7 ms | 73.3 ms | 73.3 ms | 3 |
| Seek to 2:10, 1.5× | 21 | mean −4.2 ms (max 15.8) | −5.3 ms | 8.3 ms | 8.3 ms | 6 |

### Spike 2b (with calibration)

| Scenario | Clicks | First 1.5 s | Settled mean | Settled p95 \|offset\| | Settled max | Re-syncs |
|---|---:|---|---:|---:|---:|---:|
| Play from 0:00, 1.0× | 57 | **one click 107 ms late**, then ±3 ms | **+1.4 ms** | **2.3 ms** | 2.3 ms | 2 |
| Seek to 1:00, 1.0× | 35 | mean 0.0 ms (max 0.5) | **+1.3 ms** | **2.0 ms** | 2.0 ms | 1 |
| Seek to 1:40, 0.5× | 17 | mean −15.0 ms (max 48) | **−3.4 ms** | 13.3 ms ¹ | 13.3 ms | 3 |
| Seek to 2:10, 1.5× | 21 | mean 0.1 ms (max 1.2) | **−0.7 ms** | **3.0 ms** | 3.0 ms | 3 |

¹ At 0.5×, Chrome's time-stretch also moves the MP3's own beats: the heard beep spacing
alternated between 1015 ms and 980 ms instead of 1000 ms. The ±13 ms spread is the *backing
track's* wobble. The synth clicks are steady. No approach that keeps Chrome's time-stretch can
do better.

The re-sync counts include the re-syncs alphaTab's own play/seek/speed actions trigger.

## What you would hear

- **1.0× and 1.5×: locked.** About 1–2 ms from the beat (95% of clicks within 2–3 ms). The steady
  part is ~1 ms of controller bias, which could be calibrated out (one render quantum). No glitches
  after the initial lock: corrections are speed nudges of hundredths of a percent.
- **0.5× without calibration (Spike 2): clearly late** (+57 ms). With calibration (2b), the clicks
  sit in the middle of the MP3's own beat wobble.
- **Every Play still has one late click (2b run: 107 ms).** That's the same start problem as Spike 1: the
  synth's audio starts ~100 ms after the MP3. Whether the first beat is hit depends on how
  close it is to the start. It needs a start handshake: start the synth first, then the MP3 once
  the synth's audio is flowing. Not built in this spike.

## Pros / cons (from the measurements)

| Pros | Cons |
|---|---|
| 1–2 ms at 1.0× and 1.5×, steady, no seeks once locked | Most code: worklet timestamps, controller, routing, calibration probe |
| With 2b, 0.5× sits within the MP3's own wobble | Needs the `<audio>` routed through Web Audio (one `createMediaElementSource` per element, and the output device follows the `AudioContext`) |
| Same controller can drive external media (YouTube). There, `updatePosition()` is the clock and a user/auto latency offset replaces routing (**untested**) | Calibration is browser-specific behaviour. Firefox/Safari **untested** |
| Recovers from synth underruns and media buffering (re-sync on > 120 ms) | First click after Play is late until a start handshake is added |
| No extra cost when mixing is off; ~20 small messages/s when on | — |

## Follow-up: fixing the late first click (after listening tests)

Listening confirmed what the numbers showed: the first beat after Play was late. Measured cause:
on every Play the synth's AudioWorklet was created from scratch (async module + node + several
thread hops), so its audio started **~100–117 ms after the MP3's**. Four changes fixed it:

| Change | What it does |
|---|---|
| **Warm start** | The worklet is created when the player becomes ready and survives pauses (silent while paused). Play only costs one message round trip |
| **Start handshake** | The controller learns how much later the synth starts than the MP3 (median of the first 3 readings after Play). Next Play, the **MP3 start is delayed by that much** (a few ms) instead of starting the synth later, so a beat right at the start position isn't skipped |
| **Two agreeing readings** | The media clock can jump right after play/seek. A re-sync needs two consecutive readings that agree within 3 ms. Tight threshold at 1.0× (4 ms), 15 ms at stretched speeds (Chrome's clock jitters ±15 ms there). Nudges up to ±2% |
| **Request accounting fix** | Found while testing the warm start: if the worklet's "samples requested" counter goes negative, it over-requests forever. The overflow is dropped, so the synth audio runs ~1.8× fast while its timestamps still look right. The counter is now clamped at 0, and only written samples are tracked |

### Spike 2b with the start fixes (final)

| Scenario | First click after Play/seek | Settled mean | Settled p95 \|offset\| | Settled max | Re-syncs |
|---|---:|---:|---:|---:|---:|
| Play from 0:00, 1.0× | **+5.3 ms** (was 107 ms) | **+0.6 ms** | **1.3 ms** | 1.3 ms | 3 |
| Seek to 1:00, 1.0× | −2.7 ms | **+0.1 ms** | **1.3 ms** | 1.5 ms | 1 |
| Seek to 1:40, 0.5× | −49 ms ² | −2.4 ms | 15.9 ms ¹ | 15.9 ms | 3 |
| Seek to 2:10, 1.5× | −24 ms ² | **0.0 ms** | **3.0 ms** | 3.0 ms | 3 |

Start test (Stop → Play, and seek → Play exactly on a beat; 15 runs): **one click per beat in 15/15
runs** (judged from click offsets and counts; a later run with a per-start skip check found skipped
first beats, see Follow-up 2). The first click was 0 ms in about half the runs and ~5 ms in the rest (Chrome starts the
`<audio>` on 5.3 ms steps). Every later click was within ~1 ms.

² Still open: **a seek during playback at a stretched speed** makes the synth jump before the MP3
has finished seeking, so the first click after it is early. Fix for the real design: re-sync on the
MP3's `seeked` event, and keep the synth silent until then.

## Follow-up 2: a skip check finds skipped first beats (2026-10-08, spec review)

The start test above judged "never skipped" from click offsets, which cannot show a skipped beat
(the next click then lines up with the next beep). The start test now also checks that the backing
track's **first beep after Play has its own click** (within 50 ms), counts the controller's re-syncs
per start, and takes a speed. It also fixes a harness bug: at speeds ≠ 1× it seeked to the wrong
place (`api.timePosition` is in time at the current speed).

Starts exactly on a beat, nudgecal mode, same machine:

| Speed | Setup | Starts | First beat skipped | Re-syncs | First click |
|---|---|---:|---:|---|---|
| 1.0× | as built (settle threshold 4 ms) | 15 | **2** (the same 2 positions every run) | 10, in 6 starts | −1.7 … +10.7 ms |
| 1.0× | settle threshold 12 ms + faster settle nudge (gain 300 ms) | 15 | — (no skip check yet) | **0** | −5.3 … +6.7 ms, within 3 ms after ≤ 0.9 s |
| 0.5× | as built | 10 | **10** | 1 | — |
| 1.5× | as built | 10 | 0 ¹ | 1 | — |
| 1.0× | latency offset forced to −1 ms | 11 | **0** | 5 starts | 0 … +8 ms (+16 ms on the first start after a speed change) |
| 0.5× | latency offset forced to 0 | 4 | **0** | 1 | −35 … +21 ms, later clicks +45 … +82 ms (uncompensated) |

¹ At 1.5× the synth plays the first beat, but the backing track's own first beep is clipped by
Chrome's time-stretch start: one more click than beeps in 10/10 starts.

- **Cause:** the start puts the synth at *media position + calibrated latency × speed*. When that
  offset is positive (0.5×: +30 ms of song time; 1×: +0.2 ms) the synth starts just past a beat
  that sits exactly at the start position, so the beat counts as already played while the backing
  track plays it. Forcing the offset ≤ 0 removes every skip, but at 0.5× the clicks are then
  ~60 ms late, so the real design must start the synth **at** the target and apply the offset
  after the first beat, never by moving the start forward.
- **Start lead L is one value for all speeds:** the first start after a speed change was 15–55 ms
  off (or skipped) until L was re-learned. It needs one L per speed.
- **Faster settle nudge:** at 1× it removes the start re-syncs (each one cuts sounding notes); at
  1.5× it chases the time-stretch jitter (later clicks ±4–7 ms instead of ±1–3 ms), so 1× only.

## How to reproduce

```text
open http://localhost:5173/demos/sync-spike/?mode=nudge&src=beeps      (Spike 2)
open http://localhost:5173/demos/sync-spike/?mode=nudgecal&src=beeps   (Spike 2b, calibrates first)
click "Run measurement"
```

Code: `packages/alphatab/src/platform/javascript/MixSpikePlayer.ts` (`_onTimestamp`,
`spikeCalibrate`, `_measureLatency`), worklet timestamps in
`packages/alphatab/src/platform/javascript/AlphaSynthAudioWorkletOutput.ts`, and the worker
follow mode in `packages/alphatab/src/synth/AlphaSynth.ts`.
