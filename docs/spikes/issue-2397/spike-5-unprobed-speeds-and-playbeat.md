# Spike 5 — Latency at unprobed speeds, playBeat during mixed playback, click level

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike.
> Throwaway code on branch `spike/2397-sync-options`. Run 2026-10-08 during the design review, on
> the same machine as the other spikes (Chromium, macOS, 48 kHz), sync lab in `nudgecal` mode
> (Spike 2b), `pelados.gp` with the generated beep backing track.
> Raw numbers: [results-2026-10-08.json](./results-2026-10-08.json) (keys `spike5UnprobedSpeeds`,
> `spike5PlayBeat`, `spike5ClickLevel`).

## 1. Latency at speeds the probe has not measured

**Why.** The design measures Chrome's time-stretch latency in the background at 0.5, 0.75, 1, 1.25
and 1.5×. Apps offer other speeds: the playground has 0.25, 0.9, 1.1 and 2×, and a rhythm-game app
moves the speed in 1 % steps (and an auto-BPM mode picks any value). The design did not say which
latency to use before a speed has its own measurement; the spike uses 0 (no compensation).

**How.** The sync lab's probe (`MixSpikePlayer._measureLatency(rate)`: a silent `<audio>` with beeps
on a known grid, tapped in an AudioWorklet; the median time between hearing a beep and the element's
`currentTime` reaching it, in real ms), 3 runs per speed. For the five standard speeds the page's own
background probe adds a fourth value.

| Speed | Runs (ms) | Median | Straight-line guess from the probed speeds | Guess off by | 0 off by |
|---|---|---:|---:|---:|---:|
| 0.25× | 79.9, 79.9, 79.9 | 79.9 | 60.0 (nearest: 0.5×) | 19.9 | 79.9 |
| 0.5× | 60, 60, 62.6, 60 | 60.0 | probed | | |
| 0.6× | 51.6, 53.7, 53.5 | 53.5 | 46.2 | 7.3 | 53.5 |
| 0.75× | 25.5, 25.5, 25.5, 28.2 | 25.5 | probed | | |
| 0.83× | 20.1, 20.1, 20.1 | 20.1 | 17.6 | 2.5 | 20.1 |
| 0.9× | 19.2, 17.9, 17.3 | 17.9 | 10.7 | 7.2 | 17.9 |
| 1× | 0.1, 0.1, 1.6, 1.4 | 0.8 | probed | | |
| 1.1× | −3.7, −3.7, −3.9 | −3.7 | −1.3 | 2.4 | 3.7 |
| 1.25× | −4.9, −6.5, −2.2, −3.9 | −4.4 | probed | | |
| 1.5× | −6.7, −6.7, −6.7, −3.1 | −6.7 | probed | | |
| 2× | −6.9, −6.3, −5.8 | −6.3 | −6.7 (nearest: 1.5×) | 0.4 | 6.3 |

Repeat runs of one speed differ by up to ~4 ms (1.25×: −2.2 … −6.5 ms), which is the probe's own noise.

- **Inside the probed range** (0.5–1.5×) the straight-line guess is at most 7.3 ms off; using 0 is
  4–54 ms off.
- **Below it**, the nearest probed value is 20 ms off at 0.25× (using 0: 80 ms off).
- **The curve is not a straight line near 1×**: 0.9× still has 17.9 ms while 1× has ~1 ms. Chrome
  probably skips time-stretching at exactly 1×, so a speed close to 1 keeps most of the stretch
  latency. That is why 0.6× and 0.9× are the worst guesses.
- **One probe fixes it**: each unprobed speed was measured exactly by one probe run (~1 s of real
  time, 4.4 s at 0.25×), so probing the active speed first bounds how long a guess is used.

**Design implication (review finding F-9).** Until the active speed has its own measurement, use the
straight-line guess between the nearest probed speeds (outside them, the nearest value), and probe the
active speed ahead of the background list. Confidence: **High** that the guess beats 0 (6 speeds
measured); **Medium** on how close it is (≤ 7.3 ms inside the probed range, 20 ms below it). Not run:
click-vs-beep offsets while playing at an unprobed speed.

## 2. playBeat during mixed playback

**Why.** The design routes `playOneTimeMidiFile` (used by `api.playBeat` / `api.playNote`) to the
synth only. Reading the code said the synth then pauses its own song while nothing pauses the media.

**How.** Sync lab at 1×, silent run (taps only), metronome on, tracks muted. Play from 20 s; after
3 s call `api.playBeat(...)` with the first beat of bar 13 on track 1 (2 notes); count the synth tap's
clicks and the backing-track tap's beeps.

| Window | Synth clicks | Backing-track beeps | Synth | Backing track | Combined player |
|---|---:|---:|---|---|---|
| 2 s before playBeat | 4 | 4 | Playing | playing | Playing |
| first 1 s after | 0 | 3 | Paused | playing | Playing |
| next 2 s | 0 | 4 | Paused | playing | Playing |

**Result: confirmed.** After `playBeat` the synth stays paused for good, the backing track keeps
playing, and alphaTab still reports `Playing`, so an app's Play/Pause button shows "playing" while the
metronome and synth tracks are silent. The sync controller logged nothing (no re-syncs).

For comparison, by reading (not run): today's synth-only player pauses the song (`stateChanged` →
Paused), plays the beat and leaves the song paused at its position. In today's non-mixed
backing-track / external-media players, `playOneTimeMidiFile` seeks the media to song time 0, plays
about one beat there, then pauses and seeks back to about the old position divided by the speed
(wrong at speeds other than 1×). The same sequencer loop as the count-in freeze
(`fillMidiEventQueueToEndTime`) may also hang there, so that path was not run.

## 3. Click level against a mastered backing track

**Why.** Review finding F-14 says the default mix may bury the metronome under a mastered recording,
and the design dropped the spike's output limiter. Earlier spikes measured the synth drums (~19 dB
under the MP3) but never the metronome click.

**How.** Sync lab, `src=mp3` (the file's own recording), 1×, silent (master gain 0), metronome on at
`metronomeVolume` 1, synth tracks muted. Analysers on the raw media and synth streams, plus two
silent summing busses: the design's default mix (media 1, synth 1) and the spike page's mix (media
0.35, synth 2). 10 s from 20 s into the song, read every 10 ms (21 ms windows).

| Measure | Value |
|---|---:|
| Recording, short-term level (RMS, median / 90th percentile) | −18.0 / −15.2 dBFS |
| Recording, highest peak | −2.3 dBFS |
| Metronome click, peak (22 clicks, all the same) | −11.4 dBFS |
| Metronome click, short-term level in its 21 ms window | −25.9 dBFS |
| Sum at the default mix (1 / 1), highest peak; windows over 0 dBFS | −2.3 dBFS; 0 |
| Sum at the spike page's mix (0.35 / 2), highest peak; windows over 0 dBFS | −3.8 dBFS; 0 |

- The click's short-term level sits about 8 dB under the recording's: likely audible in quiet
  passages, possibly masked in dense ones. Whether it is "clearly audible" needs an ear.
- Nothing clipped in 10 s at either mix. The worst case, a click landing exactly on the recording's
  loudest peak, would just pass full scale (0.77 + 0.27 ≈ 1.04, +0.3 dBFS): rare, but possible at
  default levels.
- The spike's limiter threshold (−3 dB) is below this recording's own peaks (−2.3 dBFS), so it would
  squash the backing track itself. A limiter that only catches the sum needs a threshold near −1 dBFS.
- Both apps that motivated this work cap the metronome and master volumes at 1 (sliders 0–1 or
  on/off toggles), so neither can boost the click above the default today.

## How to reproduce

```text
open http://localhost:5173/demos/sync-spike/?mode=nudgecal&src=beeps
(wait for the calibration log line, then in the console:)
await spikePlayer._measureLatency(0.83)          // ms, one probe run at 0.83x
api.timePosition = 20000; api.play()
// ~3 s later:
api.playBeat(api.score.tracks[0].staves[0].bars[12].voices[0].beats[0])
spikePlayer.synth.state                          // 0 = paused, while the <audio> keeps playing
```

Code: `MixSpikePlayer.ts` (`_measureLatency`, `playOneTimeMidiFile` → synth only).
