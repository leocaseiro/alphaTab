---
lap: 1
last_applied: none
---

# Synthesizer + backing track / external media mixing — design

| | |
|---|---|
| Issue | [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) — "External Media Sync / Backing Tracks - Allow mixing with Synthesizer" |
| Status | Design approved section by section (2026-10-07). Spec awaiting review |
| Base | `develop` @ `25ef76d3` (alphaTab 1.9.0 alpha) |
| Evidence | Spike on branch `spike/2397-sync-options`: [comparison](../../spikes/issue-2397/comparison.md) · [Spike 1](../../spikes/issue-2397/spike-1-seek-on-drift.md) · [Spike 2/2b](../../spikes/issue-2397/spike-2-timestamp-nudge.md) · [Spike 3](../../spikes/issue-2397/spike-3-decode-and-mix.md) · [raw numbers](../../spikes/issue-2397/results.json) |

## 1. Goal

When a song plays from a backing track (embedded audio) or external media (e.g. YouTube), alphaTab
can also run its synthesizer in sync with it: the **metronome**, the **count-in** and, optionally,
the score's **tracks**. The media stays the time source. The synth follows it within a few
milliseconds, at any playback speed, with no cost when the feature is off.

### Success criteria

| # | Criterion | Target (measured in the spike unless marked) |
|---|---|---|
| S1 | Metronome click vs backing-track beat at 1.0× | p95 ≤ 3 ms (spike: 1.3 ms) |
| S2 | Same at 1.25× / 1.5× | p95 ≤ 5 ms (spike: 3.0 ms) |
| S3 | Same at 0.5× / 0.75× | within the media's own time-stretch wobble, p95 ≤ 20 ms (spike: 15.9 ms) |
| S4 | First click after Play | ≤ 10 ms, never skipped (spike: 0–5 ms, 15/15 starts) |
| S4b | First click after a seek or speed change during playback | within ±11 ms at 1×, the speed's own tolerance (S1–S3) elsewhere, never skipped |
| S5 | One click per beat, no extra or missing clicks | 15/15 start cycles, plus a full song |
| S6 | Count-in with media | plays N clicks at the media's tempo at the start position, then the media starts on the downbeat, no freeze, no rewind |
| S7 | Mixing off | no synth worker or AudioWorklet created, no extra main-thread work |
| S8 | Mixing on | CPU and main-thread cost comparable to plain synthesizer mode, no decoded audio in memory |
| S9 | External media (YouTube) | best-effort: in sync after `mediaSyncOffsetInMilliseconds` tuning **(untested)** |
| S10 | Loop wrap at 0.5× / 1× / 1.5× | the range's first beat clicks on every repetition within its speed's tolerance; no extra or missing clicks; ≤ 30 ms added per wrap (spike 4: 0 missing clicks at all three speeds, < 15 ms per wrap at 1×, ~24 ms at 0.5× / 1.5×) |

## 2. Decisions (made with the requester, in order)

| Ref | Decision |
|---|---|
| Target | A JS fix usable in the requester's own projects first (a patch: patch-package / `pnpm patch`). Upstream PR later, optional |
| Base | Latest upstream `develop` (1.9.0 alpha); consumers upgrade |
| Approach | **Timestamp lock + gentle speed nudging + per-speed latency calibration** (spike "2b"). Rejected: seek-on-drift (offsets < threshold never corrected), decode-and-mix (pitch shifts when slowed, 78.5 MB RAM, no YouTube) |
| Switch | Boolean setting `player.enableSynthesizerWithMedia` (default `false`) |
| Public additions | `player.mediaSyncOffsetInMilliseconds` (default 0) and runtime `api.backingTrackVolume` (default 1) |
| Probe | Silent latency probe per speed, run **in the background after load** for 1×, 0.5×, 0.75×, 1.25×, 1.5×; other speeds on first use; cached per session |
| Count-in tempo | Tempo from the **sync points** at the start position; if there are none, the score's tempo |
| External media | **Included in v1, best-effort** (fitted clock + manual offset) |
| Default tracks | Synth tracks **play by default** when mixing is on; existing mute/solo/volume apply |
| Code home | Shared TS for the synth "follow media" part; web-only (`platform/javascript`) for the combined player, sync controller and probe |
| Output mode | Mixing requires `PlayerOutputMode.WebAudioAudioWorklets` (default). ScriptProcessor → media only + warning |
| Verification | Keep the spike's measurement page as a playground demo ("sync lab") |
| Delivery | A patch (tarball for a first try) for **both**: patch-package in `alphaTabWebsite`, `pnpm patch` in `notation-hero/web` (see §11) |

## 3. Architecture

```text
 <audio> backing track ──createMediaElementSource──► mediaGain ───┐
                                                                   ├──► masterGain ──► destination
 synth worker ──samples + media time stamps──► AudioWorklet ──► synthGain ──┘
      ▲                                              │  "at context frame F I output media time T" (~20/s)
      │ seekToMediaTime / rateCorrection             ▼
      └───────────────────────────── MediaSyncController (main thread)
                                              ▲
                                              │ media clock: <audio>.currentTime (+ per-speed latency)
                                              │              or external updatePosition() (fitted)
 positions / cursor / finished ◄── BackingTrackPlayer / ExternalMediaPlayer (unchanged: media is the clock)
```

| Component | Responsibility | Location | Platform |
|---|---|---|---|
| Synth follow-media mode | Render in the media's time axis via the sync points; tag output with media time | `synth/AlphaSynth.ts`, `synth/MidiFileSequencer.ts` | shared |
| Worker protocol | New commands and the time-stamped sample message | `platform/worker/*` | web |
| AudioWorklet output | Media-time stamps, warm keep-alive, request accounting fix | `platform/javascript/AlphaSynthAudioWorkletOutput.ts` | web |
| `MediaSynthPlayer` | `IAlphaSynth` combining media player + worker synth; owns the loop wrap | `platform/javascript/MediaSynthPlayer.ts` (new) | web |
| `MediaSyncController` | Start/seek handshakes, settle, nudge, re-sync, learning | `platform/javascript/MediaSyncController.ts` (new; pure logic, unit-testable) | web (logic is platform-neutral) |
| Media clocks | Backing-track clock (routed `<audio>`) and external-media clock (fitted) | `platform/javascript/MediaClock.ts` (new) | web |
| `MediaLatencyProbe` | Measures `<audio>` time-stretch latency per speed | `platform/javascript/MediaLatencyProbe.ts` (new) | web |
| Wiring | Create `MediaSynthPlayer` when the setting is on | `AlphaTabApiBase.ts`, `IUiFacade`, `BrowserUiFacade.ts` | shared + web |

## 4. Synth "follow media" mode (worker, shared code)

**Internal API on `AlphaSynthBase`** (exposed to the main thread through worker messages):

```ts
followMedia(enabled: boolean, mediaDuration: number, syncPoints: BackingTrackSyncPoint[]): void
seekToMediaTime(mediaTime: number): void   // jump: reset buffers, position sequencer, keep state (program/CC) consistent
setRateCorrection(factor: number): void    // ~0.98..1.02, multiplies how fast media time advances
```

**Rendering, per 64-frame micro buffer** (replaces the normal sequencer step while following):

1. `mediaStep = microBufferMs × playbackSpeed × rateCorrection`; `nextMediaTime = mediaTime + mediaStep`.
2. `midiTarget = sequencer.mainTimePositionFromBackingTrack(nextMediaTime, mediaDuration) × playbackSpeed`
   — the same mapping the cursor uses (`BackingTrackPlayer`), so what you see and hear agree.
3. `sequencer.fillMidiEventQueueUntil(midiTarget)` (new): dispatch all events before the target.
4. Synthesize; `mediaTime = nextMediaTime`.
5. Each `addSamples` chunk carries `mediaStart` and `mediaPerFrame` (constant within a chunk).

**Played position:** a FIFO of generated chunks advanced by `samplesPlayed` gives the media time
actually played → `timePosition` / `checkForFinish` keep working (the synth's own loop / finish handling
is off while following: the combined player owns the loop wrap, §6.2). A position report every ~20 ms is
optional (diagnostics); the controller uses the worklet stamps.

**Count-in while following** (decision: sync-point tempo, else score tempo): `generateCountInMidi`
takes the tempo from the sync point active at the start position (`syncBpm`) when sync points
exist, otherwise the current score tempo. The count-in renders on the synth's own clock (the media
is not playing). Its end time (context frame) is reported so the media start can be scheduled (§6).

**Not changed:** the normal (non-following) synth path, the exporter, the media players' cursor
logic.

The spike's `MixSpikePlayer` and `_spike*` methods are a reference only. The implementation is
written fresh, with tests, following §4–§7.

## 5. Worker protocol and AudioWorklet output (web)

New messages (main → worker): `alphaSynth.followMedia`, `alphaSynth.seekToMediaTime`,
`alphaSynth.setRateCorrection`. Extended (worker → main → worklet):
`alphaSynth.output.addSamples { samples, mediaStart?, mediaPerFrame? }`.
New (worklet → main): `alphaSynth.output.mediaTimestamp { frame, mediaTime }` about every 50 ms,
only while the block being output came entirely from stamped chunks.

AudioWorklet changes:

| Change | Why |
|---|---|
| Chunk-marker FIFO aligned with the circular buffer; markers record **written** frames only | Exact "media time at `currentFrame`" |
| **Keep-alive** (in mixing mode): pause = silent output, no sample requests, buffer cleared; play = resume; the node is created when the player is ready (warm start) | Rebuilding the worklet on every Play made the first click 100–117 ms late (spike finding F7) |
| `requestedBufferCount` never below 0 | A negative count made the worklet over-request forever: overflow dropped, synth ran ~1.8× fast (finding F8). Applies to all modes |

## 6. `MediaSynthPlayer` and `MediaSyncController` (web)

### 6.1 `MediaSynthPlayer` — one `IAlphaSynth` over two players

| `IAlphaSynth` member | Goes to |
|---|---|
| `positionChanged`, `stateChanged`, `finished`, `midiLoaded`, `playbackRangeChanged`, `loadedMidiInfo`, `currentPosition`, `timePosition`, `tickPosition` | media player (the clock) |
| `midiEventsPlayed`, `soundFontLoaded/Failed`, `loadSoundFont`, `resetSoundFonts`, `setChannel*`, transposition, `metronomeVolume`, `countInVolume`, `playOneTimeMidiFile` | synth |
| `masterVolume` | both (`masterGain`) |
| `backingTrackVolume` (new) | `mediaGain` |
| `play/pause/stop`, `playbackSpeed`, `loadMidiFile`, `updateSyncPoints`, `loadBackingTrack` | both, through the controller |
| `playbackRange`, `isLooping` | `MediaSynthPlayer` itself (loop wrap, §6.2); the inner players run without them |
| `ready` / `readyForPlayback` | when both are ready (then warm up the worklet, start the background probe) |
| `output` | the media output (keeps `output.audioElement` usable) |

Routing: the backing track's `<audio>` goes through `createMediaElementSource` into the synth's
`AudioContext` (one clock, one output latency; spike: `currentTime` equals graph time within ~1 ms
at 1×). Output-device selection then follows the `AudioContext`.

### 6.2 `MediaSyncController` — rules

Inputs: worklet stamps `(frame, synthMediaTime)`, a media clock giving `mediaTimeAt(frame)`.
`drift = synthMediaTime − mediaTimeAt(frame)` (+ = synth ahead).

| Rule | Value (internal constants) |
|---|---|
| Act only on **two consecutive readings that agree within 3 ms** (use their mean) | 3 ms |
| Settling window after play/seek/speed change | 1.5 s |
| Re-sync threshold while settling | 4 ms at 1×, 15 ms at other speeds (time-stretch jitter) |
| Re-sync threshold when locked | 120 ms |
| Nudge | `correction = 1 − clamp(EMA(drift) / 3000 ms, ±2%)`, EMA factor 0.3 |
| Re-sync lead | learned from the first agreed drift after each re-sync (clamped 0–100 ms) |
| **Start handshake** | learned start lead L, **one per speed** (median of the first 3 readings after Play). If the synth is slower (L > 0) the **media start is delayed by L**. If the media is slower, the synth starts L earlier in the song. The synth starts **at** the target, never past it: a positive per-speed latency offset is caught up after the first beat by a faster nudge (≤ 8 %), never by moving the start forward. Above 1× the media starts ~60 ms before the target (Chrome drops the start of time-stretched audio). A beat at the start position is always rendered (spike 4: 0 skips at 0.5× / 1× / 1.5×) |
| **Seek handshake** | Backing track: a seek while playing restarts through the start handshake (pause both, seek both, Play). External media (can't be held): synth silent until the first position update after the jump, then restarts at the target (same rule) |
| **Loop wrap** | `MediaSynthPlayer` owns `playbackRange` and `isLooping`. Just before the range end it fires `finished` (as today), then pauses both, seeks both to the range start (~60 ms earlier above 1×) and restarts them through the start handshake, so the range's first beat plays on every repetition (spike 4: 0 missing clicks at 0.5× / 1× / 1.5×; the backing track owning the wrap added 29–50 ms per wrap at 1× and lost beats at 1.5×) |
| Speed change | apply speed to both, use the probe's latency for the new speed, re-sync, settle |
| Count-in | synth plays the count-in. At its reported end (context frame) the media is started via the start handshake. Cursor stays at the start position meanwhile |

### 6.3 Media clocks

| Clock | `mediaTimeAt(frame)` |
|---|---|
| Backing track | `currentTime·1000 − (ctx.currentTime − frame/sampleRate)·1000·speed + latency(speed)·speed` |
| External media | linear fit (robust, last ~2 s) of `updatePosition(ms)` samples mapped to context time via `getOutputTimestamp()`, evaluated at the moment frame F is **heard** (frame time + `outputLatency`), plus `mediaSyncOffsetInMilliseconds` **(untested)** |

`mediaSyncOffsetInMilliseconds` is applied to both clocks as a final user adjustment (e.g. Bluetooth).

### 6.4 `MediaLatencyProbe`

A generated ~1 s WAV (2 kHz beeps every 125 ms; the spike used 4 s with 250 ms spacing, so the
shorter probe is **untested**), played in a hidden `<audio>` at the target speed,
routed into the same `AudioContext` into a tap that is never audible. The probe records the onset
frames, and the median of (`currentTime` reaching a beep − beep onset) is the latency for that speed.
Runs in the background after load for 1, 0.5, 0.75, 1.25, 1.5×, other speeds on first use. Cached per
session. If it fails, the latency is 0. Spike values (Chrome): 1×: 0, 0.5×: 60, 0.75×: 27, 1.25×: −4,
1.5×: −4 ms.

## 7. Public API

```ts
// settings (JSON: player.*)
enableSynthesizerWithMedia: boolean = false;     // run the synth along a backing track / external media
mediaSyncOffsetInMilliseconds: number = 0;       // + = synth plays later; manual fine-tune

// runtime (AlphaTabApiBase + IAlphaSynth implementations)
backingTrackVolume: number = 1;                  // the media's own level (masterVolume still scales both)
```

`backingTrackVolume` is added to `IAlphaSynth` (public interface, so a minor break for third-party
implementations): `AlphaSynth` / worker synth ignore it; `BackingTrackPlayer` / `ExternalMediaPlayer`
apply `masterVolume × backingTrackVolume` to the media (so it also works without mixing);
`AlphaSynthWrapper` remembers it across player switches like `masterVolume`.

Behaviour of existing calls when mixing is on:

| Call | Effect |
|---|---|
| `metronomeVolume`, `countInVolume` | work in media modes (synth) |
| `changeTrackVolume/Mute/Solo`, transposition | synth tracks |
| `playbackSpeed` | both (+ latency correction) |
| `timePosition`, `tickPosition` | media; synth follows |
| `playbackRange`, `isLooping` | the combined player owns the loop wrap (§6.2) |
| `midiEventsPlayed` | fires (from the synth) |
| `playerMode`, `actualPlayerMode` | unchanged values |

`PlayerSettings` additions need `npm run generate-typescript` (JSON types, serializers), doc
comments in the repo's style, and `@since 1.9.0`.

Wiring: `_setupOrDestroyPlayer` → when the resolved mode is `EnabledBackingTrack` or
`EnabledExternalMedia` and `enableSynthesizerWithMedia` is set → `uiFacade.createMediaSynthPlayer(mode)`
(new `IUiFacade` member). Web returns a `MediaSynthPlayer`; other platforms return `null` → today's
media-only player. `_setupOrDestroyPlayer` today only recreates the player when the *mode* changes; it
must also recreate it when `enableSynthesizerWithMedia` changes (via `updateSettings()`).

## 8. Fixes included, and coordination

| Item | Handling |
|---|---|
| Count-in freeze / rewind in media modes | Mixed mode: solved by design (§4, §6). Non-mixed modes: separate session "Fix count-in freeze in backing-track/external-media modes" (task chip) — keep both changes mergeable |
| `midiEventsPlayed` silent in media modes | Fixed when mixing is on (real synth events). Non-mixed modes unchanged (out of scope) |
| Worklet request accounting | Fixed for all modes (§5) |

## 9. Testing

| Layer | Tests |
|---|---|
| Unit (vitest, Node) | Sequencer `fillMidiEventQueueUntil`; follow mode dispatches events at the right media times (sync points, tempo changes 135↔145 BPM, 0.5×/1.5×), using the repo's `syncpoints-testfile.gp` |
| | Chunk stamps consistent (`mediaStart + frames × mediaPerFrame` = next `mediaStart`); `seekToMediaTime`; rate correction |
| | `MediaSyncController` with fed readings: agreement rule, settle thresholds, nudge sign/limits, re-sync, lead learning, start handshake (media delay vs synth pre-roll, start at target never past it, one start lead per speed, media pre-roll above 1×), seek = restart, loop wrap, a jumpy-clock sequence that must not re-sync |
| | Count-in: tempo from sync points / fallback, end reported, no freeze, no rewind |
| Browser — sync lab | Playground demo (the spike page, cleaned up): generated beep track from the file's sync points, two taps, per-click offsets, "Run measurement", start test with a skip check (the first beat after Play must have its own click) that also seeks and changes speed during playback on a beat at 0.5× / 1× / 1.5×, loop test (a 2-bar range, ≥ 10 wraps per speed), live readout. Acceptance: S1–S5, S4b, S10 |
| Browser — manual | Your real MP3 with drums/metronome by ear; YouTube demo with the metronome + offset (S9) |
| Performance | S7: with the setting off, no worker/worklet is created (checked in sync lab). S8: compare main-thread message rate and CPU with synth mode |
| Repo gates | `npm run lint`, `npm run typecheck`, `npm test` (packages/alphatab); playground typecheck |

## 10. Performance budget

| Situation | Cost |
|---|---|
| Setting off | none: identical object graph to today |
| Setting on, idle | one synth worker + one AudioWorklet (silent while paused) + SoundFont |
| Playing | synth rendering as in synth mode; ~20 stamp messages/s; controller math per stamp |
| After load | background probe: one hidden `<audio>` for ~6 s total, once per session |
| Memory | no decoded media (unlike spike 3); SoundFont as in synth mode |

## 11. Delivery

1. Implement on a clean branch `feat/2397-synth-with-media` off `develop` (the spike branch stays
   as a reference).
2. First try: `npm pack` the built package → `file:` dependency.
3. Then a patch: install the `1.9.0-alpha` build that is current at delivery time in the target
   project → look up the commit it was built from (`npm view @coderline/alphatab@<alpha> gitHead`;
   alphaTab also logs it as `VersionInfo.commit`) → check that this commit is an ancestor of this
   branch (`git merge-base --is-ancestor <commit> HEAD`); if not, rebase this branch onto `develop`
   at or after that commit and rebuild → replace its `node_modules/@coderline/alphatab/dist` with
   this branch's build → create the patch (`npx patch-package @coderline/alphatab`; `pnpm patch` in
   notation-hero, step 4). Repeat the check and regenerate whenever the alpha is upgraded. The patch
   then only adds commits (this feature, plus any `develop` commits newer than the alpha) and never
   reverts upstream fixes.
4. **Target projects: both** — `alphaTabWebsite` (rhythm game, already on patch-package, `^1.8.1`)
   and `notation-hero/web` (Next.js, `1.8.4`; a pnpm workspace, so it uses **`pnpm patch`**, not
   patch-package, which only creates patches next to an npm/yarn lockfile): in `web`, first add
   `'@coderline/alphatab@<alpha>'` to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` (alphaTab
   alphas are exempt from the 7-day release-age rule; exact `name@version` like the list's other
   entries, updated with every alpha upgrade, and `pnpm run check:supply-chain-pins` flags a stale
   one) → `pnpm add @coderline/alphatab@<alpha>` → `pnpm patch @coderline/alphatab@<alpha>` → copy
   this branch's `dist` into the folder it prints → `pnpm patch-commit <folder>` (writes the patch
   and `patchedDependencies`). Both upgrade to the alpha first; each project generates its own patch
   file (patch-package and `pnpm patch` use different file formats). In `alphaTabWebsite`, delete
   `patches/@coderline+alphatab+1.8.1.patch` in the same commit as the upgrade: it is
   CoderLine/alphaTab#2591 (drum tablature) back-ported to 1.8.1, the alpha contains all of it
   (verified 2026-10-08 with `guitar-pro-rock-beat-repeat.gp`), and a stale patch file fails every
   install (patch-package exits 1 and skips any patch after it). After the upgrade a hi-hat on
   string 6 is drawn on the 6th tab line (as in Guitar Pro) instead of line 5, and drum notes have
   `note.fret = NaN`, so the rhythm game's marker id in `cross-markers.tsx` should use
   `note.percussionArticulation` for drums.
5. Upstream PR: later and optional (would need C#/Kotlin-safe shared code, which §4 keeps, plus docs).

## 12. Out of scope / later

- Kotlin/C# implementations of the web parts.
- Spike 3's exact decode-and-mix mode, and any own pitch-preserving time-stretch.
- Firefox/Safari tuning beyond what the probe measures **(untested)**.
- Direct worker→worklet `MessagePort` (would take sample traffic off the main thread; perf idea).
- Muting the synth during YouTube buffering beyond the 120 ms re-sync rule.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Firefox/Safari: different time-stretch latency or `createMediaElementSource` quirks | The probe measures at runtime; manual checks before claiming support; worst case the offset setting |
| YouTube precision unknown | Best-effort, fitted clock, manual offset; verified by ear |
| `createMediaElementSource` is one-shot per element and ties output to the `AudioContext` | Created once per output; device selection follows the context |
| AudioContext suspended (autoplay policy) | Existing resume-on-gesture logic; the probe waits until the context runs |
| Hidden probe playback in the background | Silent (never connected to the destination), ~6 s once per session; can be made lazy if needed |
