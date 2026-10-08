# Spike 9 — Code checks from the second review lap

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike.
> Run 2026-10-08 by the verify step of the design review's second lap, against today's code on branch
> `spike/2397-sync-options` (`develop` @ `25ef76d3` plus the spike code). No browser was used: Node
> scripts (tsx, vitest) import alphaTab's sources directly, and two small Python models stand in for
> the sync controller's rules.
> Scripts: [spike-9-review-checks/](./spike-9-review-checks/).
> Raw numbers: [results-2026-10-08.json](./results-2026-10-08.json) (key `spike9ReviewChecks`).

## 1. Follow mode for a song with no sync points

**Question.** The spec's follow-mode target is `mainTimePositionFromBackingTrack(mediaTime) ×
playbackSpeed` (§4 step 2). What does it give when the backing track has no sync points?

**Setup.** Eight bars of 4/4 at 120 BPM (alphaTex), with the media at 10 s. The sequencer's
mapping is compared with no sync points and with identity sync points. Today's `BackingTrackPlayer`
cursor is checked the same way.

| Sync points | Speed | Mapping returns | × speed (the spec's target) | Cursor today | Right answer |
|---|---|---:|---:|---|---|
| none | 0.5× | 10000 ms | **5000 ms** | tick 9601 (bar 3) | 10000 ms, tick 19200 (bar 6) |
| none | 1× | 10000 ms | 10000 ms | tick 19201 (bar 6) | the same |
| none | 1.5× | 10000 ms | **15000 ms** | tick 28800 (bar 8) | the same |
| identity | 0.5× / 1× / 1.5× | 20000 / 10000 / 6666.7 ms | 10000 ms | tick 19201 (bar 6) | the same |

- **Without sync points, follow mode would play the score at speed² of its tempo** at any speed
  other than 1×.
- The synth's timestamps would still match the media, so the controller could not notice.
- Today's cursor already has the same offset. That is an existing bug, outside this spec.
- The case is reachable: alphaTab creates no default sync points (`MidiFileGenerator`, `GpifParser`).

## 2. What today's media player emits

**Question.** Which events does today's media player (`ExternalMediaPlayer`, an `AlphaSynthBase`)
raise on each action? The spec (§6.1) forwards its state to the app.

**Setup.** `syncpoints-testfile.gp` with a fake external-media handler.

| Action | Events, in order | State afterwards |
|---|---|---|
| Play with count-in volume 1 | `stateChanged(Playing)`, `handler.seekTo(0)`, `handler.play` | Playing, count-in playing |
| Seek while playing | `handler.seekTo(4500)` | Playing, no state change |
| Set a range (3840–7680), then null | `handler.seekTo(2000)`, `playbackRangeChanged(range)`, `playbackRangeChanged(null)` | — |
| Loop wrap | `finished`, `handler.seekTo(2000)` | Playing, no state change |
| Range end, looping off | `finished`, `handler.pause`, `handler.seekTo(2000)`, `stateChanged(Paused, stopped)` | Paused |
| No SoundFont at all | `readyForPlayback` once the MIDI is loaded | ready |

- Today a seek and a loop wrap change no state and play no count-in.
- The inner players raise `stateChanged` on their own pause and play. Forwarding it, as §6.1 does,
  would show the app every pause inside a start, seek or loop-wrap handshake.
- A media player needs no SoundFont to be ready.

## 3. External-media volume echo

**Question.** alphaTab's external-media sample sets the element's volume from the handler's
`masterVolume`, and writes the element's `volumechange` back into `api.masterVolume`. What happens
when the handler gets `masterVolume × backingTrackVolume`, as spec §7 says?

**Setup.** A fake element that queues `volumechange` only when the value changes (as
`HTMLMediaElement` does), wired like the sample, run for 300 ms.

| The handler gets | `volumechange` events | `masterVolume` afterwards |
|---|---:|---:|
| `masterVolume` (today) | 1 | 0.8 |
| `masterVolume × 0.35` (§7, `backingTrackVolume` 0.35) | 239 | ~1e-110 (silence) |
| `masterVolume × 1` (§7, default) | 1 | 0.8 |

## 4. A media stall against the agreement rule

**Question.** While a YouTube video buffers, alphaTab's documented wiring keeps calling
`updatePosition()` with the same position. Does the controller's rule (act only on two readings that
agree within 3 ms; re-sync above 120 ms) ever fire during the stall?

**Setup.** A Python model:
- position updates every 50 ms, frozen during the stall;
- the media clock is a line fitted over the last 2 s, with three fits;
- worklet stamps every ~50 ms;
- the synth runs at 1×.

| Stall | Fit | Re-syncs (time after the media resumes: agreed drift) | Largest drift | A stall trigger on the fitted clock fires after |
|---|---|---|---:|---:|
| 3 s | least squares | 0.67 s: +3292 ms; 1.98 s: −292 ms | 3293 ms | 316 ms |
| 3 s | Theil–Sen | 1.48 s: +3002 ms | 3572 ms | 625 ms |
| 3 s | least squares, outliers rejected | 0.62 s: +3288 ms; 1.72 s: −290 ms | 3350 ms | 423 ms |
| 0.5 s | least squares | 1.07 s: +656 ms; 1.97 s: −155 ms | 656 ms | 316 ms |
| 0.5 s | Theil–Sen | 0.87 s: +611 ms | 611 ms | 625 ms (after the stall ended) |
| 0.5 s | least squares, outliers rejected | 1.02 s: +653 ms; 1.72 s: −154 ms | 654 ms | 423 ms |

- **No re-sync fires during any stall.** While the position is frozen, consecutive drift readings
  differ by ~50 ms, so no two agree within 3 ms. The synth plays on through the whole stall.
- The first re-sync comes 0.6–1.5 s after the media resumes. Least-squares fits then add a second
  one the other way.
- A trigger based on the fitted clock fires 0.3–0.6 s late. A trigger on the raw samples (the same
  position for 100 ms or more) does not lag. Restarting the fit after the stall avoids the second
  re-sync.

## 5. The unit-test fixture's tempos

| File | Score tempos | Sync points | Notes |
|---|---|---:|---|
| `syncpoints-testfile.gp` (in the repo) | 120 → 60 → 80 BPM (bars 0, 4, 8) | 9 | 12 bars; bars 8–11 repeat twice; the backing track's own tempo runs 60–240 BPM |
| `pelados.gp` (the spike's local song, not in git) | 135 ↔ 145 BPM | 107 | the "135↔145 BPM" the spec's §9 unit-test row names |

The verify step also computed a static compressor curve for the limiter question. That estimate is
superseded by [spike 8](./spike-8-limiter-settings.md), which rendered the real node.

## Confidence

- **High** for sections 1, 2, 3 and 5. They run today's code and are deterministic.
- **Medium** for section 4. It models the controller's rules rather than running a controller,
  and the fit window and stamp timing are assumptions.

Not run: anything in a browser, and the fixes themselves. The fixes are spec changes, and
`MediaSynthPlayer` does not exist yet.

## How to reproduce (from the repo root)

```text
npx tsx --tsconfig docs/spikes/issue-2397/spike-9-review-checks/tsconfig.json docs/spikes/issue-2397/spike-9-review-checks/followmap.ts
   (also cursor.ts, tempos.ts, repeat.ts; tempos.ts also reads the local, git-ignored pelados.gp)
npx vitest run --config docs/spikes/issue-2397/spike-9-review-checks/vitest.spike.config.mjs
node docs/spikes/issue-2397/spike-9-review-checks/volume-echo.mjs
python3 docs/spikes/issue-2397/spike-9-review-checks/stall_sim.py 3000      (and 500)
```
