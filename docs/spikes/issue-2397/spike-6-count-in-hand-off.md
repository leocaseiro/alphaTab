# Spike 6 — Count-in hand-off (backing track and YouTube), and pre-roll below 1×

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike.
> Throwaway code on branch `spike/2397-sync-options`. Run 2026-10-08 during the design review, on
> the same machine as the other spikes (Chromium, macOS, 48 kHz), sync lab in `nudgecal` mode
> (Spike 2b) with the 2026-10-08 settle settings (12 ms re-sync threshold and a faster settle nudge at
> 1×), `pelados.gp` with the generated beep backing track.
> Raw numbers: [results-2026-10-08.json](./results-2026-10-08.json) (key `spike6CountIn`).

## Why

With count-in on, the synth plays N clicks first and the backing track must then start exactly on the
downbeat. `<audio>.play()` cannot be scheduled for an exact moment, and no earlier spike tried a
count-in with media (review finding F-10).

## What was tried

The mechanism proposed for the design, emulated in the spike player:

- **One stream.** The synth starts N beats before the target and renders straight through it. Here the
  N beats are the song's own beats with only the metronome audible (tracks muted), i.e. a count-in at
  the song's tempo. The real count-in uses `generateCountInMidi`; the timing problem is the same.
- **Boundary frame.** The worklet's media-time stamps give the context frame where the synth reaches
  the target (the design's `countInEnd` message carries the same value).
- **Timed `play()`.** The media stays paused at the target during the count-in (so the sync controller
  ignores the stamps), and `play()` is issued a learned media-start latency before that frame: a timer
  to ~12 ms before, then a short wait on `AudioContext.currentTime`.
- **Learning.** The first agreed drift reading after the media starts corrects the latency for the
  next count-in at that speed (one value per speed; first guess 0).
- **Pre-roll.** The media can start a few ms of media time before the target.

Test: 4-beat count-in, starts exactly on a beat at different song positions; the synth tap and the
backing-track tap give the count-in clicks, the downbeat (the click at the media's first beep) and the
next clicks.

## Results

| Speed | Media pre-roll | Starts | Count-in clicks | Downbeat (click − beep) | Skipped | Re-syncs | Next 4 clicks |
|---|---|---:|---|---|---:|---:|---|
| 1× | none | 8 | 4 every time | **−1.3 … +1.3 ms** | 0 | 0 | ±1.8 ms |
| 1.5× | 60 ms | 8 | 4 every time | first start −21.3 ms (learning), then **0 … +2.7 ms** | 0 | 1 (first start) | ±3.6 ms ¹ |
| 0.5× | none | 6 | 4 (5 when the downbeat came > 50 ms early) | **−36 … −55 ms** | **2** | 0 | −17 … +20 ms |
| 0.5× | 60 ms | 6 | 4 every time | **+7.2 … +20.5 ms** | 0 | 0 | ±19 ms |
| 0.5× | 120 ms | 6 | 4 every time | **+4.5 … +13.9 ms** | 0 | 0 | ±15 ms |

¹ One later "click" at 1.5× read −292 ms: a beep too quiet for the tap (time-stretched beeps vary from
−12 to −20 dBFS, spike 4), so the nearest beep was the wrong one. Not a sync error.

A first run at 1× with the as-built 4 ms settle threshold had the same downbeats (−4 … +6.7 ms) but
re-synced twice in 8 starts; with 12 ms it never re-synced.

Learned media-start latency (ms from `play()` to the target entering the graph): 1× ≈ 1.4–4.3,
1.5× ≈ 23–27 (with pre-roll), 0.5× ≈ −9 … −17. Lateness of the `play()` call against its planned
moment: 0.2–4.8 ms.

## The same pre-roll fixes the late clicks after Play at 0.5×

Spike 4 left one thing open: at 0.5× the first clicks after Play run late (2nd click +11 … +44 ms),
because the synth starts exactly at the target and only then catches up the stretch offset (+30 ms of
media time at 0.5×). With a media pre-roll the beat is no longer at the start position, so the synth can
start already compensated (at the media's audible position) without skipping it. Start test at 0.5×,
8 starts each, starts exactly on a beat:

| Start rule at 0.5× | First click | 2nd click | Skipped | Re-syncs |
|---|---|---|---:|---:|
| start at target, no pre-roll (as decided after spike 4) | +2.4 … +19.7 ms | **+18.5 … +57.4 ms** | 0 | 0 |
| start at target, both 120 ms early | **+35 … +75 ms** (7 of 8 flagged skipped) | +2.9 … +28.8 ms | 7 | 0 |
| compensated start, both 60 ms early | +1.9 … +15.2 ms | −10.5 … +15.5 ms | 0 | 0 |
| compensated start, both 120 ms early | −24.8 ms (first start), then +4.5 … +15.2 ms | −10.5 … +16.8 ms | 0 | 1 (first start) |

So below 1× the rule is the same as above 1×: start the media ~60 ms of media time early, and start the
synth where the media will be heard (position + latency offset). The offset is at most ~32 ms of media
time at the speeds measured in spike 5 (0.6×), so 60 ms keeps the start before the beat. "Start at
target, never past it" remains the rule at exactly 1× (offset ≈ 0, no time-stretch).

## YouTube: can a count-in hand off to a video?

**Why.** With external media (YouTube) the app drives the video through the IFrame Player API and alphaTab
only sees position updates. Review finding F-15: the start handshake and count-in assume alphaTab
starts the media, but users often press play inside the YouTube player.

**How.** Playground `youtube-sync` demo page, a second, muted, hidden `YT.Player` on the demo's video
(`by8oyJztzwo`, 325 s), `controls: 0`. Per start: `seekTo(T)`, wait 1.5 s (batch 1) or 3 s (batch 2)
paused, `playVideo()`, then `getCurrentTime()` sampled continuously for 1.5 s and a straight line fitted
from 300 ms on; where the line crosses `T` is when the video's clock started. Then `pauseVideo()`.

| Measure | Batch 1 (1.5 s wait) | Batch 2 (3 s wait) |
|---|---|---|
| Clock start after `playVideo()` | 43.7 … 46.4 ms in 8 / 10 | 42.8 … 48.2 ms in 9 / 10 |
| Starts that stalled (buffering; fitted rate 0.3–0.6×) | 2 / 10 | 1 / 10 |
| `getCurrentTime()` | smooth: new value every ~1.3 ms, within 1–3 ms of a straight line | same |
| `BUFFERING` event after `playVideo()` | — | 2–5 ms |
| `PLAYING` event after `playVideo()` | 260–273 ms (one 33 ms) | 256–277 ms |
| Clock stops after `pauseVideo()` | 0–7 ms, ≤ 2 ms of drift | — |

- **alphaTab can start YouTube on a downbeat**: when it calls `playVideo()`, the video's clock starts a
  steady ~45 ms later (±3 ms in 17 of 20 starts), so a learned media-start latency works like it does for
  the backing track. About 1 start in 7–10 stalls on buffering and starts late.
- **A start inside the YouTube player is reported late**: the `PLAYING` event that apps use to call
  `api.play()` arrives ~220 ms after the video's clock started. By then the downbeat (and a count-in)
  is already past, so a media-initiated start can only be detected, not held.
- **Not measurable here**: when the video's *audio* is heard. The iframe's audio never enters the page's
  `AudioContext`, so these are the API's clock values, not taps (S9 stays best-effort with the manual
  offset). A pre-roll ad, if the video has one, was not seen in these runs.

### Desk research: Soundslice and the YouTube API

Read from public docs and the IFrame API's own script, not measured:

- **Soundslice** offers a 1–3 bar count-in for real recordings as well as synthetic audio, at the
  recording's tempo from its sync data, also before loops
  ([help](https://www.soundslice.com/help/en/player/basic/8/metronome-and-count-in/),
  [blog](https://www.soundslice.com/blog/269/new-loop-menu-and-improved-count-in)). The docs don't say
  whether the video waits during the clicks or plays a pre-roll, and describe no YouTube start-delay
  compensation; for their synth-over-YouTube mode they mention a slight delay from YouTube buffering
  ([help](https://www.soundslice.com/help/en/player/advanced/313/synth-overlay/)). YouTube's own UI stays
  visible in their player ([help](https://www.soundslice.com/help/en/player/basic/78/adjusting-videos/)).
- **No scheduled start** in the IFrame Player API: only `playVideo`, `seekTo`, `cue…`/`load…`
  ([reference](https://developers.google.com/youtube/iframe_api_reference)). `onStateChange` carries only
  the new state, so a click inside the player looks the same as an API call.
- **`getCurrentTime()` is extrapolated** inside the API script between the iframe's updates (last
  reported time + elapsed time × rate while playing, capped at +1 s), which is why it read as smooth
  here; the true value only refreshes when the iframe reports.
- **Hiding controls is allowed, overlays are not**: `controls=0` and `disablekb=1` are documented player
  parameters ([parameters](https://developers.google.com/youtube/player_parameters)); YouTube's required
  minimum functionality forbids overlays in front of the embedded player
  ([terms](https://developers.google.com/youtube/terms/required-minimum-functionality)). Clicking the video
  surface itself probably still starts it (reported by another project; not verified here).

## What this means for the design

- **The hand-off works**: one stream through the boundary, the boundary frame from the stamps and a
  timed `play()` land the downbeat within ±1.3 ms at 1× and +2.7 ms at 1.5×, with no gap and no skip.
- **Pre-roll at every stretched speed, not only above 1×.** At 0.5× without pre-roll the downbeat came
  36–55 ms early and was skipped in 2 of 6 starts; Chrome's time-stretch start transient distorts the
  first tens of ms below 1× too. 60 ms of media pre-roll fixed it, 120 ms was a little better.
- **The same pre-roll fixes Play at 0.5×**: with the media 60 ms early and a compensated synth start, the
  first two clicks after Play stay within +15 ms (as decided after spike 4, the 2nd click was up to 57 ms
  late).
- **The first count-in at a new speed is off** until the media-start latency is learned (1.5×: −21 ms
  on the first start). Same as the per-speed start lead.

Confidence: **High** at 1× (8 starts, ±1.3 ms) and 1.5× (8 starts); **Medium** at 0.5× (6 starts per
setting, within the ±20 ms tolerance for other speeds). The real count-in MIDI and a count-in after a seek
were not tried; for YouTube only the API's clock was measured (no count-in with sound).

## How to reproduce

```text
open http://localhost:5173/demos/sync-spike/?mode=nudgecal&src=beeps
(wait for the calibration log line, then in the console:)
spikePlayer.settleResyncThreshold = 12; spikePlayer.settleNudgeGainMillis = 300
spikePlayer.loopPreRoll = 60                 // media pre-roll above 1x
spikePlayer.countInPreRollBelow1 = 120       // media pre-roll below 1x
await spikeCountInTest(8, 4, 1)              // starts, count-in beats, speed
await spikeCountInTest(6, 4, 0.5)
```

Code: `MixSpikePlayer.ts` (`countInMediaMs`, `_playWithCountIn`, `_countInStamp`,
`_startMediaAfterCountIn`) and `demos/sync-spike/index.ts` (`countInTest`).
