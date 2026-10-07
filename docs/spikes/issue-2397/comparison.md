# Mixing the synth with backing tracks / external media — spike comparison

> Spike for [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397)
> ("External Media Sync / Backing Tracks - Allow mixing with Synthesizer").
> All code is throwaway, on branch `spike/2397-sync-options` (based on `develop` @ `25ef76d3`).
> Details per approach: [Spike 1](./spike-1-seek-on-drift.md) ·
> [Spike 2 / 2b](./spike-2-timestamp-nudge.md) · [Spike 3](./spike-3-decode-and-mix.md) ·
> [Spike 4: first beat, start re-syncs, loops](./spike-4-first-beat-and-loops.md) ·
> [Spike 5: unprobed speeds, playBeat during mixed playback](./spike-5-unprobed-speeds-and-playbeat.md).
> Raw numbers: [results.json](./results.json) · [results-2026-10-08.json](./results-2026-10-08.json).

## TL;DR

- **Mixing works**, and the two clocks don't drift. With the MP3 routed through the synth's
  `AudioContext`, an uncorrected run held a constant offset (116.6 ± 0.1 ms) for 2.5 minutes across
  tempo changes. The work is aligning at **start, seek and speed change**, not fighting drift.
- **Best overall: Spike 2b** (timestamp lock + gentle speed nudging + per-speed latency calibration).
  Clicks land within **~1–2 ms** of the backing track at 1.0× and 1.5×, and inside the MP3's own
  beat wobble at 0.5×. It keeps the MP3's pitch, and the same controller can drive YouTube.
- **Exact but limited: Spike 3** (decode the MP3 and mix it in the worker). It's sample-exact at
  every speed, but the MP3 changes pitch when slowed down, costs 78.5 MB RAM, and can't do YouTube.
- **Seek-on-drift (Spike 1)** never really corrects anything: any offset under the 50 ms threshold
  stays. Measured: +5 ms, +12 ms, −22 ms.
- **The late first click after Play (~100–117 ms) is solved for 2b**: warm start (the synth's
  worklet survives pauses) plus a start handshake (the MP3 starts a learned few ms later). Measured: first
  click 0–5 ms, all later clicks within ~1 ms
  ([details](./spike-2-timestamp-nudge.md#follow-up-fixing-the-late-first-click-after-listening-tests)).
  Still open: the first click after a *seek during playback* at 0.5×/1.5× (−49 / −24 ms). Fix:
  re-sync on the MP3's `seeked` event.
- **Correction from [Spike 4](./spike-4-first-beat-and-loops.md):** with a real skip check, a start
  exactly on a beat **skipped the first beat** (1×: 2 / 15, 0.5×: 10 / 10), because the synth
  started at *position + latency offset*. Starting the synth at the target fixed it (0 skips at
  every speed). Spike 4 also shows the 4 ms settle threshold cutting sounding notes, measures loop
  wraps (the combined player owning the wrap is cleanest), and finds Chrome dropping the start of
  time-stretched audio above 1× (fixed by a 60 ms pre-roll).

## The question

With a backing track (or external media) as the master clock, can the alphaTab synthesizer play
the metronome (and optionally the score's tracks) in sync, within ~10 ms, at any playback speed,
without costing performance when the feature is off?

## Test setup

| | |
|---|---|
| Score | "Pelados em Santos" (Guitar Pro 8): 1 drum track, 119 bars, 4/4, tempo changes 135 ↔ 145 BPM, **107 sync points** |
| Backing track | Embedded MP3, 3:24 (204.4 s), 4.65 MB |
| Measured audio | The MP3 replaced by a **generated WAV with a 3 ms 2 kHz beep on every beat** (476 beats). Beat positions come from the file's own sync points, so a perfect sync puts every metronome click on a beep |
| Synth | alphaTab worker synth, sonivox SoundFont, drum track muted, **metronome only** |
| Measuring | Two AudioWorklet taps inside the same `AudioContext`, one on the backing track and one on the synth output. Each tap records the frame where the signal first crosses a threshold. **Offset = click start − beep start** (positive = click late). Both share one clock, so this is the audible offset minus the shared output latency |
| Scenarios | (1) Play from 0:00 at 1.0× for 25 s · (2) seek to 1:00 for 15 s · (3) 0.5× + seek to 1:40 for 15 s · (4) 1.5× + seek to 2:10 for 15 s. "Settled" = after the first 1.5 s of a scenario |
| Environment | Chromium 152 (Claude desktop browser pane), macOS, `AudioContext` 48 kHz, baseLatency 5.3 ms, outputLatency 24 ms, alphaTab `bufferTimeInMilliseconds` 500 |
| Perfect alignment reads | **−0.65 ms ± 0.4 ms**. The synth starts events on 64-frame (1.33 ms) boundaries. Spike 3 is exact by construction and serves as this calibration |

## Shared base (built once for all spikes)

1. **The synth follows the sync points in real time.** In the worker, each 64-frame micro buffer
   advances the synth's *media* time by `duration × speed × correction`. The sequencer then
   dispatches every MIDI event up to the MIDI time the sync points map that media time to (the same
   mapping the cursor uses). Before this, the synth ignored sync points during playback; only the
   audio exporter used them.
2. **A combined player** (`MixSpikePlayer`): the backing-track player keeps driving the cursor, and
   the worker synth plays alongside. Play/pause/seek/speed/volume go to both. Mute/solo/track
   volume/metronome go to the synth. As a side effect, `midiEventsPlayed` now works in this mode,
   because the real synth produces the events.
3. **The `<audio>` is routed through the synth's `AudioContext`** (`createMediaElementSource`),
   for Spikes 1, 2 and 2b. Both streams share one clock and one output latency. A spike showed
   that once routed, `currentTime` matches the moment the audio enters Web Audio within 0.1–1.3 ms
   at 1.0×.

## Findings that apply to every approach

| # | Finding | Evidence |
|---|---|---|
| F1 | **No drift between the MP3 and the synth** once both run through one `AudioContext` | No correction, 1.0×, 152 s across tempo changes: offset 116.63 → 116.66 → 116.72 → 116.74 → 116.57 ms (10 s windows) |
| F2 | **The synth's audio starts ~100–117 ms after the MP3's** after Play | Baseline runs: +100.7, +106.0, +116.6 ms. Spikes 1/2b: first click 101–107 ms late |
| F3 | **Chrome's `<audio>` reports a `currentTime` that is behind the audio you hear when speed ≠ 1×** (pitch-preserving time-stretch latency). It depends on speed, not content | 1.0×: +0.7 ms · 0.75×: +34 ms · 0.5×: +63 ms (stable over 40 s) · 1.25×: −2 ms · 1.5×: −3 ms |
| F4 | **At 0.5× Chrome's time-stretch moves the MP3's own beats by up to ±17 ms** | Heard beep spacing alternated 1015 / 980 ms instead of 1000 ms. No sync method that keeps Chrome's time-stretch can beat this |
| F5 | `<audio>.currentTime` (not routed) is fine-grained, but jumpy right after `play()` | Updates every ~4.5 ms; jitter p95 2.4 ms in steady state; up to 41 ms off in the first ~300 ms |
| F6 | Bugs found on the way (today's alphaTab) | Count-in + backing track/external media → infinite loop ("Page unresponsive") · count-in rewinds the media to 0:00 · `midiEventsPlayed` never fires in those modes · metronome silently dropped |
| F7 | **Creating the synth's AudioWorklet on every Play is what makes the first click late** | Warm start (worklet created once, kept through pauses) took the first click from 101–107 ms late to 0–5 ms |
| F8 | **The worklet's "samples requested" counter must never go negative** | When it did (spike warm-start bug), the worklet over-requested forever: overflow dropped, synth audio ~1.8× fast, timestamps still looked fine. Clamp at 0 |
| F9 | **alphaTab's synth is much quieter than a mastered MP3** | Drums from this file: −38.5 dBFS RMS (same in plain synth mode) vs MP3 −19.3 dBFS. Mixing needs separate backing-track / synth volumes |

## Results side by side

Settled **mean / p95 |offset|** per scenario. Perfect = −0.65 ms. **Bold** = within the ~10 ms target.

| Scenario | No correction (baseline) | 1 Seek on drift | 2 Timestamp + nudge | 2b + speed calibration | **2b + start fixes** | 3 Decode + mix |
|---|---|---|---|---|---|---|
| Play from 0:00, 1.0× | +100.7 / 101.3 ms | **+4.7 / 5.3 ms** ¹ | **+2.0 / 3.0 ms** | **+1.4 / 2.3 ms** ¹ | **+0.6 / 1.3 ms** | **−0.7 / 1.3 ms** |
| Seek to 1:00, 1.0× | +10.0 / 10.6 ms ² | **+4.7 / 5.3 ms** | **+0.3 / 4.2 ms** | **+1.3 / 2.0 ms** | **+0.1 / 1.3 ms** | **−0.7 / 1.3 ms** |
| 0.5× (seek to 1:40) | +12.0 / 26.6 ms | +12.0 / 26.6 ms | +56.7 / 73.3 ms | **−3.4 / 13.3 ms** ³ | **−2.4 / 15.9 ms** ³ | **−0.7 / 1.3 ms** ⁴ |
| 1.5× (seek to 2:10) | −22.2 / 24.3 ms | −22.2 / 24.3 ms | **−5.3 / 8.3 ms** | **−0.7 / 3.0 ms** | **0.0 / 3.0 ms** | **−0.7 / 1.3 ms** ⁴ |
| First click after Play | 101 ms late | 101 ms late | on time (this run) | 107 ms late | **0–5 ms** (15/15 runs) ⁵ | on time |

¹ Before settling, one click was 101 ms (Spike 1) / 107 ms (2b) late (finding F2).

⁵ Judged from click offsets, which cannot show a skipped beat. A later run with a per-start skip
check found the first beat skipped when starting exactly on a beat: 2/15 starts at 1×, 10/10 at 0.5×
(cause and fix direction: [spike 2, Follow-up 2](./spike-2-timestamp-nudge.md)).
² Second baseline run: +4.7 ms. The offset a seek leaves behind varies between runs at 1.0×
(+4.7 … +10 ms). At 0.5× and 1.5× it repeated to the 0.01 ms in three runs. Either way it isn't zero.
³ Within the MP3's own beat wobble at 0.5× (finding F4).
⁴ Timing exact, but the MP3 is pitch-shifted (an octave down at 0.5×).

## Beyond precision

| | 1 Seek on drift | 2 Timestamp + nudge | 2b + calibration | 3 Decode + mix |
|---|---|---|---|---|
| Keeps the MP3's pitch at 0.5× / 1.5× | yes | yes | yes | **no** (needs own time-stretch) |
| External media / YouTube | yes | yes (clock = `updatePosition`) **untested** | yes, plus a latency offset **untested** | **no** |
| Glitches during playback | seek on every correction | none after lock | none after lock | none |
| Extra RAM | none | none | none | **78.5 MB** for a 3:24 song |
| Extra work per load / speed change | none | none | silent probe 3–8 s per new speed (can be ~1 s) | **0.4 s** decode per load (off main thread) |
| Messages while playing | ~50/s position reports | ~20/s timestamps | ~20/s timestamps | none |
| Controller size in the spike | ~25 lines | ~110 lines (incl. worklet) | +~110 lines (probe) | ~95 lines (decode + mix) |
| Fits the maintainer's design note ("media is the clock, synth follows") | yes | yes | yes | no (synth becomes the clock) |

All four share the ~650-line base (worker follow mode + combined player + routing).

## Weighted decision matrix (updated with the measurements)

Scores 1–5, multiplied by the weight.

| Criterion (weight) | 1 Seek on drift | 2 Timestamp + nudge | **2b + calibration** | 3 Decode + mix |
|---|---|---|---|---|
| Sync precision (×4) — ~10 ms target | 2 → 8 | 3 → 12 | 4 → 16 | 5 → 20 |
| In sync **and** same pitch at any speed (×3) | 3 → 9 | 2 → 6 | 5 → 15 | 1 → 3 |
| Performance (×3) | 4 → 12 | 4 → 12 | 4 → 12 | 2 → 6 |
| Covers YouTube / external media (×2) | 4 → 8 | 4 → 8 | 4 → 8 | 1 → 2 |
| Build effort / risk (×1) | 5 → 5 | 3 → 3 | 2 → 2 | 2 → 2 ⁵ |
| **Total** | 42 | 41 | **53** | 33 |

⁵ 4 at 1.0× only. With a pitch-preserving time-stretch (needed for parity) it drops to 1.

**The real trade-off:** exactness (3) versus keeping the MP3's pitch at practice speeds plus
YouTube support (2b).

**Recommendation: 2b, plus a start handshake** (start the synth first, then the MP3 once the synth's
audio is flowing) to remove the late first click. I'd switch to **3** for a "1.0× only, embedded MP3
only" use case, where it's exact and the simplest at runtime. Or add it later as an optional exact
mode.

## Not tested / open

- **Firefox and Safari**: their time-stretch latency (F3) will differ, and routing an `<audio>` into
  Web Audio has its own quirks there. 2b measures the latency at runtime, so it should adapt. Unverified.
- **YouTube / external media**: the controller design applies (`updatePosition()` is the clock),
  but the iframe's audio can't be routed or measured, so the latency offset would come from
  `AudioContext.outputLatency` plus a user setting. Not measured.
- **The default `<audio>` output path (not routed)**: its offset against Web Audio can't be measured
  from JS. Estimated at ~30 ms (the output latency), but not verified. All spikes 1/2/2b route the
  MP3.
- **Bluetooth headphones, mobile, `PlayerOutputMode.WebAudioScriptProcessor`**: untested.
- **Count-in in mixed mode** wasn't part of the spike. It needs the synth to play the count-in
  first, then start the media (which is also the natural place for the start handshake).
