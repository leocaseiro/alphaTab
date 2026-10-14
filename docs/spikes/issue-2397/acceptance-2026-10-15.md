# #2397 acceptance run — Chromium on macOS (plan Task 22), 2026-10-14/15

Measured in the sync lab (`packages/playground/demos/sync-lab/`) at `feat/2397-synth-with-media` @ `0aeb165d`. Raw
numbers: `results-2026-10-15.json` (every run, the disturbed ones labelled).

## Environment and method

- Browser: the Claude desktop app's built-in browser pane, Chromium 152.0.7977.130, macOS; 48 kHz context,
  `baseLatency` 5.33 ms, `outputLatency` 24 ms. The default beep file (`syncpoints-testfile.gp`, 48 kHz WAV) unless
  noted.
- The console steps ran from a script, not by hand; listening, S8's performance panel and S9 (YouTube by ear) are
  owed by the person (below).
- The page was hidden. Chromium throttles hidden, silent pages (timers once a minute after 5 minutes, then once a
  second), which wrecked one batch (tests taking 2340 s). The clean runs kept the page active with a local WebRTC
  loopback and a 20 Hz tone at −60 dBFS sent straight to the destination (outside the measured taps; inaudible in
  practice). Every clean test logged a timer check before and after it (8 chained 20 ms timers: max gap 22–30 ms).
  Disturbed runs are kept in the JSON and not used below.
- The media-latency probe measures each speed once per page load. Seven loads read 0.5×: 45.1–57.7 ms and 0.75×:
  12.7–30.2 ms; one load (load 2) read both low. Which load a row comes from is noted where it matters.

## Results

### S1–S3 — steady playback (`runMeasurement`, settled p95 of |click − beat|)

| Segment | Target | Load 2 (probe low) | Load 4 (probe normal) | 44.1 kHz file, load 3 (reported) |
|---|---|---|---|---|
| start@0s 1.0x (S1) | ≤ 3 ms | 2.8 — pass | 2.3 — pass | 0.8 |
| seek 1.0x (S1) | ≤ 3 ms | 2.5 — pass | 2.3 — pass | 0.9 |
| seek + 1.25x (S2) | ≤ 5 ms | 2.4 — pass | 2.0 — pass | 8.1 (mean −4.5) |
| seek + 1.5x (S2) | ≤ 5 ms | 1.1 — pass | 1.5 — pass | 5.8 (mean −4.0) |
| seek + 0.5x (S3) | ≤ 20 ms | **22.1 — fail** | 10.6 — pass | 9.6 |
| seek + 0.75x (S3) | ≤ 20 ms | **27.0 — fail** | 11.0 — pass | 6.5 |

Load 2's misses are steady offsets (0.75×: mean 25.1 ms, std 1.7 ms), not jitter: that load's probe read 0.5× and
0.75× about 13 and 17 ms lower than the other loads, and the controller locks to the probe's value (it can't see
an error in it). With a normal reading, S3 passes with room to spare.

### S4 — the first click after Play (`startTest`)

| Run | Tolerance | Result |
|---|---|---|
| 15 starts at 1×, 30 ms before a beat | ±11 ms | 15/15 within (−0.7…+7.3), 0 skipped, counts match, 0 re-syncs — pass |
| 15 starts at 0.5× | ±25 ms | 15/15 within (+9.9…+20.5), 0 re-syncs — pass |
| 15 starts at 1.5× | ±20 ms | 15/15 within (−12…+1.3), 2 re-syncs — pass |
| 15 starts at 1×, exactly on a beat (run 1) | ±11 ms | **13/15 within; two at +12.0 and +13.3 ms — miss** |
| 15 starts at 1×, exactly on a beat (run 2, another load) | ±11 ms | 15/15 within (−2.7…+5.3) — pass |
| 5 starts at 0.25× (reported) | ±25 ms | 1 skipped (+51.7), others +15.7; fewer clicks than beeps in the window; never locked within 3 ms |
| 5 starts at 2× (reported) | ±20 ms | 5/5 within (−3.6…+8.4) |

Measured latencies outside the probed list (reported): 0.25× 95.2 ms (spike 5: 80), 2× −7.5 ms (spike 5: −6).
`autoBpmLoopTest(0.25, 5, 10)` (0.2× → 0.7×, reported): first beats 6.4, 5.7, 46.7, 35.5, 11.8, 18.4, 0.5, −5.3,
0.9, 0.4 ms; **23 missing clicks**; 0 re-syncs.

### S4 — the first Play at a speed with nothing learned (D-4: reported, not gated)

A fresh load, after the probe listed 1, 0.5, 0.75, 1.25 and 1.5: the page's first Play at 0.5× +9.9 ms (1 re-sync;
spike 4: −29.6, spike 12: −24.7); then 0.5× +9.9, +11.2; 0.75× +10.9, −3.8; 1× **+30.0**, −0.7 (the first 1×
start of the page; 1 re-sync). The straight-line guess between learned speeds: 0.625× −15.1 ms, 0.875× −17.2 ms
(within ±25; their probes landed 692 and 301 ms after Play).

### S4b — seeks and speed changes during playback, 30 ms before a beat (`midPlaybackTest`, 10 each)

| Action | Tolerance | Result |
|---|---|---|
| seek at 1× | ±11 ms | 10/10 within (−0.7…+4.7) — pass |
| seek at 0.5× | ±25 ms | 10/10 within (+8.5…+15.2) — pass |
| seek at 1.5× | ±20 ms | 10/10 within (−5.4…+1.3) — pass |
| speed 1 → 0.75 | ±25 ms | **9/10 out, 5 skipped; first clicks −19.8…−58.4 ms (synth early); 13 re-syncs — fail** |
| speed 0.75 → 1 | ±11 ms | **9/10 out; first clicks about −25 ms; 10 re-syncs — fail** |
| speed 1 → 1.5 | ±20 ms | **3/10 out (−21.9…−24.6 ms); 14 re-syncs — fail** |

The speed-change misses are the media player's own seek at each change (spike 11 saw the media land 15–43 ms
behind): decision gate D-9.

### S5 — a full song (`fullSongTest(1)`)

64 beats, 64 beeps, 64 clicks: missing 0, extra 0 — pass on clicks. `finished: false`: the song never finishes —
a bug in today's backing-track player, identical with mixing off (below). Counts matched in every clean
`startTest` row at 1×, 0.5× and 1.5×.

### S6 — the count-in (`countInTest`, 6 each; D-3's runs at 0.5×)

| Speed | Downbeat vs the media's first beat |
|---|---|
| 0.5×, pre-roll 60 ms (two runs) | +11.2…+23.2 ms (medians 13.9, 16.6), all within, 0 re-syncs |
| 0.5×, pre-roll 120 ms (two runs) | +9.9…+20.5 ms (medians 16.6, 16.6), all within, 0 re-syncs |
| 1× | first −13.3 ms (out of ±11, 1 re-sync: the page's first count-in at 1×), then −2.7…+2.7 |
| 1.5× | first −16.0 ms (1 re-sync), then −4.0…0 (F-14 expected 0…+2.7) |

The first count-in at an unlearned speed: (open).

### S7 — setting off

`?mixing=0`: 0 synth workers, 0 synth worklets — pass. Mixing on: 1 and 1.

### S10 — loop wraps (`loopTest`, 2 bars, 10 wraps; decision gate D-5)

| Speed | Added time per wrap (median) | Wraps over 15 ms | First beats | Clicks |
|---|---|---|---|---|
| 0.5× | **72.7 ms** | 10/10 (67–73 ms) | +8.5…+21.9, within ±25 | 88/88, 0 missing, 0 extra |
| 1× | −9 ms | 0 | 0…+5.3, within ±11 | 89/89 |
| 1.5× | **47.9 ms** | 10/10 (48–53 ms) | −1.3…+1.3, within ±20 | 88/88, 1 re-sync |

Away from 1× every wrap restarts through the start handshake, which pre-rolls the media 60 ms and waits for its
seek: the recording stumbles by ~50–75 ms at each wrap. Both of D-5's gates (median ≤ 30 ms; every wrap ≤ 30 ms)
fail at 0.5× and 1.5×.

### S12 — the apps' speed patterns (`sweepTest`, `autoBpmLoopTest`)

| Run | Result |
|---|---|
| Held tempo button down (1 → 0.9, 12 steps every 250 ms) | 12 re-syncs (one per step); p95 53.3 ms during the sweep; back within S4b's tolerance 1.5 s after the last step (max 18.5 ms) |
| Held tempo button up (0.75 → 0.84) | 13 re-syncs; p95 77.8 ms during the sweep; back within tolerance (max 21.5 ms) |
| Auto-BPM loop (0.8× → 1.2×, +5 BPM per wrap, 10 wraps) | 0 missing clicks; first beats −15.3…+18.6 ms, within tolerance; 3 re-syncs |
| D-9's settle-only sweep (1 → 0.9, no forced re-sync) | 11 re-syncs anyway; p95 29.1 ms; `firstDriftMs − seekBackMs` per step: 8.3, 48.2, 13.1, 17.1, 3.0, 9.0, 19.9, 17.3, 15.8, 21.0, 4.1, 15.5 |

### §6.4 — the probe's length (`probeComparison`, 3 repeats)

| Speed | 1 s probe | 4 s probe | Median difference |
|---|---|---|---|
| 0.5× | 59.1, 58.2, 56.7 | 59.8, 60.0, 60.0 | 1.8 ms |
| 0.75× | 27.2, 28.4, 23.2 | 25.1, 26.6, 25.1 | 2.1 ms |
| 1.25× | −2.6, −1.6, −2.4 | −5.3, −5.3, −3.2 | 2.9 ms |
| 1.5× | −3.4, −2.6, −4.4 | −3.9, −3.8, −4.0 | 0.5 ms |

No speed differs by more than 3 ms: the 1 s probe stays (plan Step 8). Separately, one of seven page loads read
0.5× and 0.75× 13–17 ms low (see S1–S3).

### Step 9 — what a script could check

- **F-8:** a SoundFont that fails (a bad file, or a network error) fires `soundFontLoadFailed` on the player
  instance, the wrapper and `api.error`. With mixing on and the synth worker's script missing, the player warns
  "The synthesizer can't play along the media; playing the media only: The alphaSynth worker failed" and plays the
  recording alone (ready; 2457 ms played in 2.5 s).
- **Spike 8's limiter (offline render):** the implemented setting peaks at −0.67 / −0.47 / −0.31 dBFS at
  `synthVolume` 1 / 2 / 3, with no clipped sample (a −0.3 dBFS recording: −0.5 dBFS). Without the limiter, +3.94 dBFS.
- **Learned values across a player recreation:** `startLeads` {1: 1.4, 0.5: −43.7, 0.75: −24.6} before and after
  `playerMode` 2 → 3.
- **YouTube's report of a paused seek** (the IFrame API, a test player without alphaTab): the old position for the
  first ~26 ms, then exactly the target (0.00 ms); one `infoDelivery` per paused seek; playback resumes 0.42 ms from
  the target.

## Decision gates (the numbers above; the person decides)

- **D-1** (a probe value lands mid-playback): settle-only arms — 0 re-syncs after the value landed; clicks after it
  0.875×: −6.6, −23.1, −10.9 ms; 0.625×: −1.4, +0.1 ms. Re-sync arms — 1 re-sync each (cut notes); clicks after
  +6.7, −12.5, −0.2 / +6.6, +6.8 ms. Status: pending.
- **D-3** (the count-in's pre-roll below 1×): 60 and 120 ms land the downbeat alike (S6 above); the ear check
  decides. Status: pending (listening).
- **D-5** (the loop-wrap gate): both gates fail at 0.5× and 1.5× (S10 above). Status: pending.
- **D-9** (the media player's seek at each speed change): `firstDriftMs − seekBackMs` exceeds the 15 ms settle
  threshold at 7 of 12 steps, so the seek is not the only cause; the plan's rule keeps Option 1. Status: pending.

## Owed by the person (by ear, or in Chrome's tools)

1. D-3 (Step 4): a real song (`?file=`), **Audio** = the file's audio, count-in on, 0.5×, Play from the first beat
   after a fill or a crash — once with 120 ms (built in), noting what of the previous bar sounds under the last
   count-in beat.
2. D-5 (Step 5): **Audio** = the file's audio, synth tracks on, loop at 1× and 1.5× and listen at each wrap; loop at
   0.5×: nothing of the bar after the range may sound before the jump back.
3. D-1 (Step 7): the `probeMidPlaybackTest` pair with "sound on" and the tracks unmuted, listening for a cut.
4. S8 (Step 9): 30 s in synth mode (the control demo) and 30 s mixing (the lab, the file's audio): main-thread
   scripting time and worker messages from Chrome's performance panel.
5. S11 / F-13: a mastered MP3 at default levels — the metronome clearly audible; `synthVolume` 3 — no clipping.
6. The §9 listening check: a song with sustained notes; Play, a seek, a speed change — no cut notes or dropouts
   beyond the one re-sync per speed change.
7. S9: the `youtube-sync` demo with mixing on (Step 9's snippet), tune `mediaSyncOffsetInMilliseconds` by ear, then
   three count-in-off starts at 1× and the 1× start lead; also pause → Play with the count-in on (it must count in).
8. Today's player (mixing off), in the rhythm game: does a looped backing track keep looping, and does a song whose
   recording ends early finish? (See below.)

## Bugs in today's player found by this run (out of scope; mixing off reproduces each)

- **A song never finishes when its recording ends early:** with this file (recording 42 s, score 48 s via sync
  points) the position stops at 47995 of 48000 ms and the player stays Playing — no `playerFinished`.
- **A looped range plays once:** in the control demo, a fresh API in backing-track mode (element muted, page hidden)
  wrapped once, then the `<audio>` stayed paused at the range start while the player reported Playing. With mixing
  on, the combined player's wrap kept looping (S10). To confirm by ear in an app (item 8).
