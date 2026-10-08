# Spike 7 — playBeat / playNote with a backing track (mixed and non-mixed)

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike.
> Throwaway code on branch `spike/2397-sync-options`. Run 2026-10-08 during the design review, on
> the same machine as the other spikes (Chromium, macOS, 48 kHz). Mixed runs: sync lab in `nudgecal`
> mode (Spike 2b) with the 2026-10-08 settle settings, `pelados.gp` with the generated beep backing
> track. Non-mixed runs: the playground's `control` demo, `pelados.gp` with its own recording
> (backing-track mode) and `full-song.gp5` (synth only).
> Raw numbers: [results-2026-10-08.json](./results-2026-10-08.json) (key `spike7PlayBeat`).

## Why

`api.playBeat` and `api.playNote` play a one-time MIDI file (`playOneTimeMidiFile`). Spike 5 showed
that routing it to the synth alone, as the design did, silences the synth for good while the backing
track plays on. Review findings F-17 and F-18 ask two things: what a beat click should do while
mixing, and what today's non-mixed players do (so the design can record it).

The API documents both methods as: "This will stop the any other current ongoing playback."

## 1. Today, without mixing

**Synth only** (`control` demo, `full-song.gp5`, 1×, 2 runs). A `playBeat` during playback sends
`Paused` 2 ms later. The song stays paused at its position (21.87 → 21.96 s), and Play continues from
there. This matches the documented contract.

**Backing track, non-mixed** (`control` demo, `pelados.gp` with its recording, 2 runs per speed;
the media position sampled every 10 ms):

| Speed | Media before | After the click | Media plays | Then returns to | Song position after |
|---|---:|---|---|---|---|
| 1× | 22.05 s | `Paused`; at +13 ms jumps to 0.16 s (the song start) | 0.16 → 0.50 s, ~390 ms | 22.05 s (right) | 21.97 s (unchanged) |
| 2× | 43.91 s | `Paused`; at +12 ms jumps to 0.17 s | 0.17 → 0.53 s, ~240 ms | **22.02 s (half)** | **10.97 s (half of 21.94 s)** |

So a beat click plays the first ~0.4 s of the recording audibly (the media is the only sound in this
mode), and at speeds other than 1× it leaves the player at the old position divided by the speed.
`playOneTimeMidiFile` seeks to song time 0 and the backing-track player forwards seeks to the media.
External media shares the code path (by reading, not run).

By reading, not run: when the song position is still near the start (for example before the first
Play), the same path can loop forever in `fillMidiEventQueueToEndTime`. That loop is the count-in
freeze, and the fix in [CoderLine/alphaTab#2932](https://github.com/CoderLine/alphaTab/pull/2932)
covers it, because it makes the loop advance the state it checks.

## 2. Mixed: what a beat click does, per option

**Why the as-built routing fails** (by reading the spike synth): in follow mode the synth maps the
media clock (here ~22 s) onto whatever MIDI is current. For the one-time MIDI (0–333 ms) that
dispatches every event in the first block and ends it at once. `checkForFinish` then pauses the synth,
and nothing restarts it. A fix needs both parts: pause the media, and play the one-time MIDI on the
synth's own clock (out of follow mode until the next Play).

The options were tested through `MixSpikePlayer.oneTimeMidiMode`:
- `synthOnly`: as built.
- `pauseBoth`: option 1, pause media and synth, play the beat on the synth's own clock, stay paused.
- `pauseBothResume`: option 2, the same, then Play again when the beat ends.

Setup: 1×. The beat is the first beat of bar 13 (2 notes, 333 ms at the song's tempo), clicked 2.5 s
after Play. "Audible" runs unmute the beat's track; the other runs mute it and measure the clicks
after Play.

| Behaviour | Runs | State the app sees | Backing track | The beat | Afterwards |
|---|---:|---|---|---|---|
| As built (`synthOnly`) | 7 | stays `Playing`, no event | keeps playing | note-ons in 2 of 3 checked runs, none in 1 | synth silent: no onset after the first 11 ms, against 3 beeps in 1.5 s |
| 1 · pause both, stay paused | 19 | `Paused` 0–1 ms after the click, stays paused | paused (moves 0–3 ms) | note-ons 8–12 ms after the click (3 of 3 checked); synth tap onset 5.4–10.7 ms (18 of 19) | Play 1.5 s later: first click −6.2 … +14.7 ms in 11 of 12, one +55.4 ms; next clicks within ±8.5 ms; 0 skipped |
| 2 · pause, then resume | 10 | `Paused` at 0 ms, `Playing` at 385–394 ms | paused ~390 ms, then plays | onset 5.4–10.7 ms (9 of 10) | automatic resume: first click −0.8 … +6.7 ms in 6 of 6; next within ±2.8 ms; 0 skipped |
| Baseline: plain Pause, Play 1.5 s later | 6 | `Paused`, then `Playing` | paused | (none) | first click −1.5 … +12.5 ms in 6 of 6; next within ±3.7 ms |
| 3 · play on top, no pause | — | not run | | | |

- **Option 1 works and matches today.** The app sees `Paused` at once, the backing track stops, the
  beat plays on the synth's own clock, and the next Play goes through the normal start handshake.
- **The +55.4 ms outlier** (1 of 12 starts after a beat click) was not seen in the 6 baseline starts
  or the 6 option-2 resumes. Its cause was not found. It is a start-handshake result (the S4 criterion,
  first click after Play) rather than a beat-click result, so it is noted here for the start tests.
- **Option 2** resumes in sync, but the app sees `Paused` and then `Playing` ~390 ms later. Its
  Play/Pause button flickers, and the song is held for the beat's length. It also contradicts the
  documented contract.
- **Option 3** was not run. The sequencer holds one current MIDI at a time (main, count-in or one-time).
  Playing a beat on top of a running song would need a second sequencer state mixed into the same
  synth while follow mode drives the main one: a bigger change.
- The synth tap also heard an onset 5.4–10.7 ms after the click when the beat's track was muted
  (12 of 12 runs). So part of that onset is not the beat's notes (possibly a metronome event in the
  one-time MIDI). Not investigated; it does not change the comparison.

## What this means for the design

- **F-18:** route `playOneTimeMidiFile` through the controller. If playing, pause the media and the
  synth, then let the synth play the one-time MIDI on its own clock (not following the media). The
  next Play or seek returns to following. That is option 1, measured above.
- **F-17:** non-mixed modes keep today's behaviour: a jump to the song start, and a wrong return
  position at speeds other than 1×. Record this in §8 as out of scope and tracked separately.

Confidence:
- **High** for option 1's state, media pause and beat (19 runs).
- **Medium** for the sync of the next Play: 11 of 12 within +14.7 ms, one unexplained +55 ms.
- **High** for the non-mixed jump and return (2 runs per speed, identical).

Not run:
- other speeds in mixed mode;
- external media (YouTube);
- `playNote` (same code path as `playBeat`).

## How to reproduce

```text
open http://localhost:5173/demos/sync-spike/?mode=nudgecal&src=beeps
(wait for the calibration log line, then in the console:)
spikePlayer.settleResyncThreshold = 12; spikePlayer.settleNudgeGainMillis = 300
await spikePlayBeatTest('synthOnly', 3, 1, true)          // mode, starts, speed, audible
await spikePlayBeatTest('pauseBoth', 6, 1, false)         // clicks after Play
await spikePlayBeatTest('pauseBothResume', 6, 1, false)   // clicks after the automatic resume
await spikePlayBeatTest('pauseOnly', 6, 1, false)         // baseline: plain pause

open http://localhost:5173/demos/control/
api.load(new Uint8Array(await (await fetch('/test-data/temp/pelados.gp')).arrayBuffer()))
api.playbackSpeed = 2; api.timePosition = 20000; api.play()
// ~2 s later; watch api.player.instance.output.audioElement.currentTime:
api.playBeat(api.score.tracks[0].staves[0].bars[12].voices[0].beats[0])
```

Code: `MixSpikePlayer.ts` (`oneTimeMidiMode`, `oneTimeLog`, `playOneTimeMidiFile`) and
`demos/sync-spike/index.ts` (`playBeatTest`).
