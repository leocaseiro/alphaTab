# Synthesizer + backing track / external media mixing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a song plays from a backing track or external media, alphaTab also runs its synthesizer (metronome,
count-in, optionally the tracks) locked to the media: within p95 ≤ 3 ms at 1×, ≤ 5 ms at 1.25×/1.5×, and within
the media's own time-stretch wobble (p95 ≤ 20 ms) at 0.5×/0.75×, with no cost when the feature is off.

**Architecture:** The media stays the clock. The worker synth renders on the media's time axis (sync points map
media time to song time) and tags every sample chunk with its media time. The AudioWorklet reports "at context
frame F I output media time T" about 20 times a second. A pure `MediaSyncController` compares that with the media
clock and nudges the synth's rate (±2 %), re-syncs above a threshold, and plans the start, seek, count-in and loop
handshakes. `MediaSynthPlayer` is one `IAlphaSynth` over the two players and owns the transport state and the loop
wrap.

**Tech Stack:** TypeScript (alphaTab 1.9.0 alpha, `develop` @ `25ef76d3`), Web Workers, Web Audio (AudioWorklet,
`createMediaElementSource`, `DynamicsCompressorNode`), vitest (Node), Biome, the alphaTab playground (Vite).

**Spec:** [`docs/superpowers/specs/2026-10-07-synth-with-media-design.md`](../specs/2026-10-07-synth-with-media-design.md)
@ `f3aff5b4` (review closed after lap 2; its §14 open items are settled by this plan). Section numbers below (§4,
§6.2, …) are the spec's. Spike evidence: [`docs/spikes/issue-2397/`](../../spikes/issue-2397/).

---

## How to run this plan

- **Branch.** Task 1 creates `feat/2397-synth-with-media` from `25ef76d3` (the spec's base, where every line
  reference in this plan holds) in its own worktree, and carries `docs/superpowers/` and
  `docs/spikes/issue-2397/` from `spike/2397-sync-options` so the spec, this plan and the evidence travel with the
  code. Those doc commits are dropped if an upstream PR is ever prepared (§11 step 5). The spike branch stays as a
  reference; its `MixSpikePlayer` and `_spike*` code is never copied (§4: "written fresh, with tests").
- **Each task ends green and pushed.** Run the gates named in the task, commit, `git push`. Never
  `git commit --no-verify` / `git push --no-verify`. Never a bare `git stash` (the stash is shared across
  worktrees). Tracked files never contain absolute `/Users/...` paths.
- **Decision gates (D-1 … D-8)** are marked **STOP — decision gate**. The main session runs them, never a task
  subagent: run the measurement named in the gate first, then put the choice to the person as an
  `AskUserQuestion` picker tagged `[Q-D<n>]`, following `spec-triage-loop:triage` (load it before the first picker):
  scenario first, the app it affects, High / Medium / Low confidence per option, whether each option was spiked.
  The plan already implements the recommended option, so the gate either confirms it or switches to the
  alternative it names. `[No preference]` or "Skip — decide later" means *not decided*: keep the implemented
  default, carry the item, never pick for the person.
- **Today's synth bugs are out of scope.** Where a task meets one (each is named where it appears), leave it as it
  is: no fix in this work.
- **Repo gates** (§9): from the repository root, `npm run lint`, `npm run typecheck`, `npm test`. When the
  playground changes, also `npm run typecheck --workspace=packages/playground`.
- **Sync lab:** `npm run dev --workspace=packages/playground -- --port 5188 --strictPort`, then
  `http://localhost:5188/demos/sync-lab/` (Task 21 creates it). Save every new measurement in
  `docs/spikes/issue-2397/` (a dated `.md` plus raw numbers in a dated `results-*.json`).

## Global Constraints

Copied from the spec; every task's requirements include these.

- Base: `develop` @ `25ef76d3` (alphaTab 1.9.0 alpha); consumers upgrade (§2 Base).
- Switch: `player.enableSynthesizerWithMedia: boolean = false` (§2, §7).
- Public additions: `player.mediaSyncOffsetInMilliseconds: number = 0` (+ = synth plays later); runtime
  `api.backingTrackVolume = 1` and `api.synthVolume = 1` (`synthVolume` pending decision D-6). New settings and API
  members get doc comments in the repo's style and `@since 1.9.0`; `PlayerSettings` changes need
  `npm run generate-typescript` (§7).
- Mixing requires `PlayerOutputMode.WebAudioAudioWorklets` (the default) and working AudioWorklets (an
  `AudioWorkletNode` and a secure context). Otherwise: media only, plus a warning (§2 Output mode, §7 Wiring).
- Setting off: identical object graph to today, no synth worker or AudioWorklet created, no extra main-thread work
  (S7, §10).
- Mixing on: no decoded media in memory; CPU and main-thread cost comparable to synth mode (S8, §10).
- Code homes (§2, §3): the synth "follow media" part is shared TypeScript (`synth/`, must stay transpilable to
  C#/Kotlin: no DOM types, no web APIs); the combined player, sync controller, clocks and probe are web-only
  (`platform/javascript/`, `platform/worker/`, tagged `@target web`).
- Not changed (§4): the normal (non-following) synth path, the audio exporter, the media players' cursor logic.
  Non-mixed modes keep today's behavior (§8).
- Delivery (§11): a patch for **both** apps — patch-package in `alphaTabWebsite`, `pnpm patch` in
  `notation-hero/web`. Upstream PR later and optional.
- alphaTab's [AGENTS.md](../../../AGENTS.md): no PR without an accepted issue; issues describe problems, not
  solutions; the `alphatab-ai-authored-v1` disclosure on every issue, PR and comment; never post the #2397 comment
  without the person's OK.

## Review Focus

The five inputs the spec implies but no other test pins, most likely to bite first. Each has a test in the task
that owns the code.

1. **A backing track that runs past the score** (an outro after the last bar). The synth keeps following and stays
   silent, the media plays to its end, and `finished` fires once. Tests: Task 3
   (`keeps-following-after-the-song-ends`) and Task 16 (`media-end-stops-both-once`).
2. **Actions in the middle of a handshake**: Pause while the media start is still delayed, Pause or a seek during
   the count-in, a speed change during the count-in. Expected: no media `play()` after a Pause, no second worklet,
   no `stateChanged` from inside the handshake. Tests: Task 16 (`pause-during-media-delay-cancels-the-media-start`),
   Task 17 (`pause-during-count-in-cancels-the-hand-off`, `seek-during-count-in-restarts-without-count-in`).
3. **Play before the background probe is done, or while the `AudioContext` is still suspended** (autoplay policy).
   Expected: the start uses the straight-line guess, the probe waits for a running context, and a value that
   lands mid-playback settles without cutting notes (D-1). Tests: Task 10 (`latency-change-settles-without-resync`)
   and Task 15 (`probe-waits-for-a-running-context`, `probe-value-during-playback-settles`).
4. **Changing `enableSynthesizerWithMedia` or `playerMode` at runtime** through `updateSettings()`. Expected: the
   old player is destroyed, the new one is created, and volumes, speed and looping are restored. Test: Task 20
   (`flag-change-recreates-the-player`, `wrapper-restores-media-volumes`).
5. **`destroy()` while a timer is pending** (a delayed media start, a count-in time limit, a hand-off, a loop
   wrap). Expected: nothing fires into a destroyed player. Tests: Task 16 (`destroy-clears-pending-timers`) and
   Task 18 (`destroy-clears-the-wrap-timer`).

## Where each §14 open item lands

Every item is **our design's problem**: none of them is a bug in today's synth. Confidence is for the
recommendation as it stands. "Spiked" says whether a run backs it.

| Item | App | What the plan does | Task / gate | Test | Spiked? | Confidence |
|---|---|---|---|---|---|---|
| F-9a | both | A speed with no learned value of its own uses a straight-line guess between learned speeds (`PerSpeedValues`). A probe value that lands during playback settles without a forced re-sync. | Tasks 8, 10 · D-1 in Task 22 | unit (spike 11's numbers) · lab: first Play at an unprobed speed, probe value mid-loop | guess: yes (spike 11 §2) · probe part: no | Medium (guess) · Low (probe part) |
| F-9d | both | S12 (new success criterion) plus lab tests for an auto-BPM loop (+5 BPM per wrap), a held sweep in 1-BPM steps, and the first Play at an unprobed speed | Task 21 (lab) · Task 22 (S12 into the spec, run) | lab | sweep: yes (spike 11 §1) | High (the sweep re-syncs at each step) · Medium (rest) |
| F-3 | both | Settle re-sync threshold at 1× = max(12 ms, 2 × `baseLatency` + 1 ms). The lab's first-click tolerance = max(±11 ms, ±2 × `baseLatency`). A run on a machine with `baseLatency` > 5.3 ms. | Task 9 (code) · Task 21 (lab) · Task 23 (run, D-2) | unit + lab | no | Low |
| F-14 | both | Count-in media pre-roll below 1× = 120 ms (the recommendation). D-3 compares 60 ms and 120 ms with the real count-in. The 1.5× figure is restated as 0…+2.7 ms. The first count-in at an unlearned speed is marked (open). | Task 10 (constant) · Task 22 (D-3, spec edits) | lab count-in test at 0.5× | yes (spike 6, emulated count-in) | Medium |
| Q-1 | both | S4 reports the first Play at a speed with no learned start lead separately and doesn't gate on it (the recommendation) | Task 22 (D-4; can be settled during the plan review) | lab start test's first-Play cell | n/a (a reporting rule) | High |
| F-15 | both | Re-run spike 4's loop test at 1× and 1.5×, listen at each wrap the lab flags, then pick the S10 gate (provisional: a median gate plus an ear check) | Task 22 (D-5) | lab loop test | partly (spike 4) | Medium |
| F-5 | library-only | External media wraps without pausing: the media seeks to the range start, the synth stays silent until the first position update after the jump, then restarts. S10 is scoped to the backing track. | Task 19 (code, spec edit) | unit (fakes) | no | Low |
| F-6 | alphaTabWebsite | A start pressed inside YouTube (the position moved at `play()` or within 100 ms) gets no count-in and no learning. Integrations call `updatePosition()` right before `api.play()`. | Task 19 (code, spec §7 edit) · Task 20 (setting docs) | unit | no | Low |
| F-17 | alphaTabWebsite | Stall rule: the same position for ≥ 100 ms silences the synth. Once the position moves, the fit restarts and the synth restarts at the media's position. | Tasks 11, 19 | unit | modeled (spike 9 §4) | Medium |
| F-11 | alphaTabWebsite | Both clocks subtract `mediaSyncOffsetInMilliseconds × speed`. The spec states the sign (+ = synth later) and the unit (ms of real time). | Task 11 (code, spec edit) | unit | no (arithmetic) | High |
| F-13 | both | Limiter: −1 dBFS, ratio 20, knee 0, attack 1 ms, release 100 ms, then a fixed −0.57 dB trim | Task 14 · lab check in Task 22 | unit (node params) + lab (spike 8 script) | yes (spike 8) | High |
| FYI-3 | both | Whether `synthVolume` stays public | Task 13 (D-6, before any code) | none needed | n/a | — |
| F-10 | both | Turn the flag on in both apps. Rhythm game: YouTube player with `controls: 0`, `disablekb: 1`. notation-hero keeps its controls (a notation-hero spec delta). | Tasks 26, 27 | manual, in each app | no | Medium |
| F-18 | both | Acceptance list becomes "S1–S6 (S6: backing track), S4b, S10, S12" after D-3 and D-4 | Task 22 | lab | n/a | High |
| R-1 | both | iPad with the Ring/Silent switch on: is the backing track still heard? Remedy to try: `navigator.audioSession.type = 'playback'`. | Task 24 (D-8) | iPad, manual | no | Low |
| R-2 | both | WebKit may refuse a `play()` that comes a bar after the gesture. Safety net: a media start that never happens pauses both and warns (Task 17). The real fallback is decided at D-7. | Task 17 (safety net) · Task 24 (D-7) | unit + iPad | no | Low |

### Gaps the plan fills (not in the spec, carried from the spikes)

Each one is flagged where it is used. Keep or drop them during the plan review.

- **G-1** (spike 11 §1): while following, a speed change doesn't rescale and seek the synth. The position is the
  media's, and a speed change doesn't move it. Task 3.
- **G-2** (the spike's controller): stamps are ignored for 200 ms after a re-sync, so stale stamps from before the
  jump can't trigger another one. Task 9.
- **G-3** (spike 4): the loop-wrap timer fires 15 ms of media time before the range end. Task 18.
- **G-4** (spikes 4 and 6): clamps on the learned values — start lead −50…150 ms, media-start latency −50…250 ms,
  re-sync lead 0…100 ms (the last is in the spec). Tasks 9 and 10.
- **G-5** (spike 6): the count-in hand-off timer fires 12 ms early, then waits on the audio clock for at most 30 ms.
  That is how spike 6 got its 0.2–4.8 ms. Task 17.
- **G-6** (spec wording): the external clock stamps each sample with the context time *being heard* (via
  `getOutputTimestamp()`) and is read at frame time `F / sampleRate`. §6.3's "frame time + `outputLatency`" names
  the same moment, so don't add `outputLatency` twice. Task 11.
- **G-7** (spec wording, §13): the probe's tap is connected to the destination but outputs silence (as in spike 5).
  A node that isn't connected may not be processed. Task 12 fixes the §13 sentence.

## Decision gates

| Gate | Decides | Where | Implemented default |
|---|---|---|---|
| D-1 | F-9a probe part: a probe value that lands mid-playback settles (no forced re-sync) **or** re-syncs as §6.4 says today | Task 22 | settle only |
| D-2 | F-3: keep the `baseLatency`-derived thresholds **or** go back to the fixed 12 ms / ±11 ms | Task 23 | derived |
| D-3 | F-14: count-in pre-roll below 1× = 120 ms **or** 60 ms | Task 22 | 120 ms |
| D-4 | Q-1: S4 gates the first Play at an unlearned speed **or** only reports it | Task 22 (or the plan review) | report only |
| D-5 | F-15: S10 gate = every wrap ≤ 30 ms **or** median ≤ 30 ms plus an ear check | Task 22 | median + ear |
| D-6 | FYI-3: `synthVolume` stays public **or** is dropped (apps use `backingTrackVolume` + `masterVolume`) | Task 13 (or the plan review) | public (as §7 says) |
| D-7 | R-2: the fallback when WebKit refuses the delayed `play()` | Task 24 | safety net only |
| D-8 | R-1: whether to set `navigator.audioSession.type = 'playback'` while mixing on iOS | Task 24 | not set |

## File structure

**Shared (`packages/alphatab/src/synth/`, transpilable):**

- `MidiFileSequencer.ts` (modify): `fillMidiEventQueueUntil`, `mainMidiTimeFromMediaTime`, `mainTickToMediaTime`,
  `mainSyncBpmAt`; `startCountIn(bpm)` / `generateCountInMidi(bpm)` take an optional tempo.
- `MediaSampleOutput.ts` (create): `MediaSampleChunk` (the media stamp of one sample chunk) and `IMediaSampleOutput`.
- `AlphaSynth.ts` (modify): follow mode on `AlphaSynthBase` — `followMedia`, `seekToMediaTime`,
  `setRateCorrection`, `mediaSampleOutput`, `countInStarted`; rendering on the media's axis; played-position FIFO;
  count-in as one stream; `backingTrackVolume` / `synthVolume`.
- `IAlphaSynth.ts` (modify): `backingTrackVolume`, `synthVolume`.
- `BackingTrackPlayer.ts` (modify): applies `masterVolume × backingTrackVolume`; internal `seekMediaTo`,
  `tickToMediaTime`.
- `ExternalMediaPlayer.ts` (modify): the handler keeps getting `masterVolume` alone.
- `AlphaSynthWrapper.ts` (modify): remembers `backingTrackVolume` and `synthVolume` across player switches.

**Shared API and settings:**

- `packages/alphatab/src/PlayerSettings.ts` (modify): `enableSynthesizerWithMedia`, `mediaSyncOffsetInMilliseconds`.
- `packages/alphatab/src/generated/*` (regenerate): JSON types and serializers.
- `packages/alphatab/src/AlphaTabApiBase.ts` (modify): `backingTrackVolume`, `synthVolume`; creates the combined
  player; recreates the player when the flag changes.
- `packages/alphatab/src/platform/IUiFacade.ts` (modify): `createMediaSynthPlayer(mode)`.

**Web worker (`packages/alphatab/src/platform/worker/`):**

- `AlphaTabWorkerProtocol.ts` (modify): new messages, the extended `addSamples`, the worker's `error` event.
- `AlphaSynthWebWorker.ts` (modify): handles `followMedia`, `seekToMediaTime`, `setRateCorrection`; posts
  `countInStarted`.
- `AlphaSynthWorkerSynthOutput.ts` (modify): implements `IMediaSampleOutput`.
- `AlphaSynthWebWorkerApi.ts` (modify): implements `IMediaSynth` — sends the new commands, routes stamped samples,
  listens to the worker's `error`.

**Web (`packages/alphatab/src/platform/javascript/`):**

- `MediaSynthTypes.ts` (create): `MediaTimestampEventArgs`, `IMediaFollowingOutput`, `IMediaSynth`,
  `IMediaMixGraph`, `IMediaTimer` + `BrowserMediaTimer`, `IMediaLatencyProbe`.
- `MediaChunkMarkers.ts` (create): the worklet's media-time markers, aligned with its circular buffer (pure).
- `AlphaSynthAudioWorkletOutput.ts` (modify): stamps, `countInEnd`, keep-alive, `requestedBufferCount` never
  below 0, `workletFailed`, a settable destination node, the probe tap processor.
- `PerSpeedValues.ts` (create): a value per playback speed with the straight-line guess (pure).
- `MediaSyncController.ts` (create): the §6.2 rules and handshake planning (pure).
- `MediaClock.ts` (create): `BackingTrackMediaClock`, `ExternalMediaClock` (pure, behind small source interfaces).
- `MediaLatencyProbe.ts` (create): probe WAV, onset matching (pure), and the browser measurement.
- `WebAudioMixGraph.ts` (create): media/synth/master gains, limiter and trim, media routing.
- `MediaSynthOutput.ts` (create): `MediaSynthPlayer.output` — the media output's members plus the synth output's
  device methods.
- `MediaSynthPlayer.ts` (create): the combined `IAlphaSynth`.
- `BrowserUiFacade.ts` (modify): `createMediaSynthPlayer`.
- `AlphaTabApi.ts` (modify): a failed SoundFont download is raised on the player instance.

**Tests (`packages/alphatab/test/audio/`):** `RecordingAudioSynthesizer.ts`, `FollowTestOutput.ts`,
`MediaSyncFakes.ts` (helpers); `FollowMedia.test.ts`, `MediaWorkerProtocol.test.ts`, `MediaChunkMarkers.test.ts`,
`AudioWorkletOutputMedia.test.ts`, `PerSpeedValues.test.ts`, `MediaSyncController.test.ts`, `MediaClock.test.ts`,
`MediaLatencyProbe.test.ts`, `MediaVolumes.test.ts`, `WebAudioMixGraph.test.ts`, `MediaSynthPlayer.Routing.test.ts`,
`MediaSynthPlayer.Transport.test.ts`, `MediaSynthPlayer.CountIn.test.ts`, `MediaSynthPlayer.Loop.test.ts`,
`MediaSynthPlayer.External.test.ts`, `MediaSynthWiring.test.ts`.
`packages/alphatab/test/visualTests/TestUiFacade.ts` (modify).

**Playground:** `packages/playground/demos/sync-lab/index.html`, `index.ts` (create, from the spike page).

## Shared interfaces

The names and types the tasks rely on. A task's implementer sees only their own task; this section is how they
learn what their neighbors use.

```ts
// synth/MediaSampleOutput.ts (shared)
export class MediaSampleChunk {
    public mediaStart: number = -1;      // media ms of the chunk's first frame; -1: not on the media's axis (count-in)
    public mediaPerFrame: number = 0;    // media ms per frame (constant within a chunk)
    public countInEnd: boolean = false;  // the chunk's first frame is the first frame after the count-in
}
export interface IMediaSampleOutput {
    addMediaSamples(samples: Float32Array, chunk: MediaSampleChunk): void;
}

// AlphaSynthBase (synth/AlphaSynth.ts), all @internal
mediaSampleOutput: IMediaSampleOutput | null;
readonly countInStarted: IEventEmitterOfT<number>;      // count-in length (ms, real time) while following
readonly isFollowingMedia: boolean;
followMedia(enabled: boolean, mediaDuration: number, syncPoints: BackingTrackSyncPoint[]): void;
seekToMediaTime(mediaTime: number): void;
setRateCorrection(factor: number): void;

// platform/javascript/MediaSynthTypes.ts (web)
export class MediaTimestampEventArgs { constructor(public readonly frame: number, public readonly mediaTime: number) }
export interface IMediaFollowingOutput extends IMediaSampleOutput {   // AlphaSynthAudioWorkletOutput
    readonly mediaTimestamp: IEventEmitterOfT<MediaTimestampEventArgs>;
    readonly countInEnd: IEventEmitterOfT<number>;                    // context frame of the count-in's end
    readonly workletFailed: IEventEmitterOfT<Error>;
    readonly workletNode: AudioNode | null;
    keepAlive: boolean;
    destinationNode: AudioNode | null;
    warmUp(): void;
}
export interface IMediaSynth extends IAlphaSynth {                    // AlphaSynthWebWorkerApi
    followMedia(enabled: boolean, mediaDuration: number, syncPoints: BackingTrackSyncPoint[]): void;
    seekToMediaTime(mediaTime: number): void;
    setRateCorrection(factor: number): void;
    readonly countInStarted: IEventEmitterOfT<number>;
    readonly workerFailed: IEventEmitterOfT<Error>;
}
export interface IMediaMixGraph {                                     // WebAudioMixGraph
    masterGain: number; mediaGain: number; synthGain: number;
    readonly currentTime: number;        // AudioContext.currentTime (s)
    readonly sampleRate: number;
    readonly baseLatencyMs: number;
    readonly isRunning: boolean;         // AudioContext.state === 'running'
    whenRunning(action: () => void): void;
    readonly context: AudioContext | null;           // diagnostics only
    readonly mediaSourceNode: AudioNode | null;      // diagnostics only
    readonly masterGainNode: GainNode | null;        // diagnostics only
}
export interface IMediaTimer {                                        // BrowserMediaTimer
    now(): number;                                   // ms, monotonic (performance.now())
    setTimeout(action: () => void, ms: number): number;
    clearTimeout(id: number): void;
    spinUntil(done: () => boolean, maxMs: number): void;   // bounded busy-wait (G-5)
}
export interface IMediaLatencyProbe { measure(speed: number): Promise<number>; }   // MediaLatencyProbe

// platform/javascript/MediaSyncController.ts (web, pure)
export interface IMediaSyncSynth { seekToMediaTime(mediaTime: number): void; setRateCorrection(factor: number): void; }
export interface IMediaSyncClock { mediaTimeAt(frame: number): number; mediaTimeNow(): number; }  // NaN = no reliable time
export interface IMediaSyncTime { now(): number; }
export class MediaStartPlan { speed; target; mediaSeekTo; synthSeekTo; mediaDelayMs; catchUpGapMs }
export class MediaSyncController {
    readonly startLeads: PerSpeedValues; readonly mediaStartLatencies: PerSpeedValues; readonly stats: MediaSyncStats;
    baseLatencyMs: number; readonly speed: number; readonly correction: number; readonly isActive: boolean;
    settleThreshold(speed: number): number;
    planStart(target: number, speed: number, mediaLatencyMs: number): MediaStartPlan;
    started(plan: MediaStartPlan, learnStartLead: boolean): void;
    startedAfterHandOff(speed: number, learnMediaStartLatency: boolean): void;
    stopped(): void; resync(): void; speedChanged(speed: number): void; latencyChanged(): void;
    onStamp(frame: number, synthMediaTime: number): void;
    handOffPlayTime(countInEndFrame: number, sampleRate: number, speed: number, preRollMediaMs: number): number;
    static preRoll(speed: number, countIn: boolean): number;
}

// platform/javascript/MediaClock.ts (web, pure)
export interface IMediaClock extends IMediaSyncClock {
    readonly position: number;     // media ms as the media reports it (no latency, no offset)
    readonly isSeeking: boolean;
    speed: number;
    whenSeeked(action: () => void): void;   // runs now when not seeking
}
```

---
## Phase 0 — Branch

### Task 1: Branch, docs and a green baseline

**Files:** nothing in `packages/`; `docs/superpowers/**` and `docs/spikes/issue-2397/**` come from the spike branch.

**Interfaces:** none.

- [ ] **Step 1: Create the worktree and the branch from the spec's base**

Run from the repository's main checkout:

```bash
git fetch origin
git worktree add .claude/worktrees/feat-2397-synth-with-media -b feat/2397-synth-with-media 25ef76d3
```

Expected: `Preparing worktree (new branch 'feat/2397-synth-with-media')`. Work in that folder from here on.

- [ ] **Step 2: Carry the spec, this plan and the spike evidence**

```bash
git checkout origin/spike/2397-sync-options -- docs/superpowers docs/spikes/issue-2397
git add docs/superpowers docs/spikes/issue-2397
git commit -m "docs: carry the #2397 spec, plan and spike evidence"
```

- [ ] **Step 3: Install and run the gates (baseline)**

```bash
npm install
npm run lint
npm run typecheck
npm test
```

Expected: all pass. Write the test count into the task's commit message or PR notes; later tasks only add tests.

- [ ] **Step 4: Push**

```bash
git push -u origin feat/2397-synth-with-media
```

---

## Phase 1 — The synth follows the media (shared code + worker)

### Task 2: Sequencer — media-time mapping, fill-until and the count-in tempo

**Files:**
- Modify: `packages/alphatab/src/synth/MidiFileSequencer.ts` (new methods after `fillMidiEventQueueToEndTime`;
  `startCountIn` and `generateCountInMidi` at the end of the class)
- Create: `packages/alphatab/test/audio/RecordingAudioSynthesizer.ts`
- Create: `packages/alphatab/test/audio/FollowMedia.test.ts`

**Interfaces:**
- Consumes: today's `MidiFileSequencer` (`mainTimePositionFromBackingTrack`, `mainTimePositionToBackingTrack`,
  `mainTickPositionToTimePosition`).
- Produces (used by Tasks 3, 4, 15, 18):
  - `fillMidiEventQueueUntil(midiTime: number): boolean`
  - `mainMidiTimeFromMediaTime(mediaTime: number, mediaDuration: number): number` (song ms at speed 1)
  - `mainTickToMediaTime(tick: number, mediaDuration: number): number`
  - `mainSyncBpmAt(mediaTime: number): number` (0 without sync points)
  - `startCountIn(bpm: number = 0)`
  - test helper `RecordingAudioSynthesizer` with `events: RecordedSynthEvent[]` and `synthesizeCalls: number`

The no-sync-points rule (§4 step 2, spike 9 §1): without sync points the media plays the song at its own tempo, so
the target is the media time itself at any speed. `mainTimePositionFromBackingTrack` returns the media time unscaled
there, and today's cursor multiplies it by the speed. That cursor offset is **today's bug**: out of scope, don't
touch it.

- [ ] **Step 1: Write the test helper**

Create `packages/alphatab/test/audio/RecordingAudioSynthesizer.ts`:

```ts
import { MidiEventType, type TempoChangeEvent, type TimeSignatureEvent } from '@coderline/alphatab/midi/MidiEvent';
import type { IAudioSampleSynthesizer } from '@coderline/alphatab/synth/IAudioSampleSynthesizer';
import type { Hydra } from '@coderline/alphatab/synth/soundfont/Hydra';
import type { SynthEvent } from '@coderline/alphatab/synth/synthesis/SynthEvent';

/**
 * An event the {@link RecordingAudioSynthesizer} received.
 * @internal
 */
export class RecordedSynthEvent {
    public readonly synthEvent: SynthEvent;
    /**
     * The micro buffer the event was dispatched for: the number of synthesize() calls before it.
     */
    public readonly microBuffer: number;

    public constructor(synthEvent: SynthEvent, microBuffer: number) {
        this.synthEvent = synthEvent;
        this.microBuffer = microBuffer;
    }
}

/**
 * A synthesizer that renders silence and records every dispatched event. Like TinySoundFont it keeps the
 * tempo and time signature of the dispatched events (the count-in reads them).
 * @internal
 */
export class RecordingAudioSynthesizer implements IAudioSampleSynthesizer {
    public masterVolume: number = 1;
    public metronomeVolume: number = 0;
    public outSampleRate: number = 44100;
    public currentTempo: number = 120;
    public timeSignatureNumerator: number = 4;
    public timeSignatureDenominator: number = 4;
    public activeVoiceCount: number = 0;

    public readonly events: RecordedSynthEvent[] = [];
    public synthesizeCalls: number = 0;

    public dispatchEvent(synthEvent: SynthEvent): void {
        this.events.push(new RecordedSynthEvent(synthEvent, this.synthesizeCalls));
        const e = synthEvent.event;
        if (e && e.type === MidiEventType.TimeSignature) {
            const timeSignature = e as TimeSignatureEvent;
            this.timeSignatureNumerator = timeSignature.numerator;
            this.timeSignatureDenominator = Math.pow(2, timeSignature.denominatorIndex);
        } else if (e && e.type === MidiEventType.TempoChange) {
            this.currentTempo = (e as TempoChangeEvent).beatsPerMinute;
        }
    }

    public synthesize(_buffer: Float32Array, _bufferPos: number, _sampleCount: number): SynthEvent[] {
        this.synthesizeCalls++;
        return [];
    }

    public synthesizeSilent(_sampleCount: number): void {}
    public noteOffAll(_immediate: boolean): void {}
    public resetSoft(): void {}
    public resetPresets(): void {}
    public loadPresets(
        _hydra: Hydra,
        _instrumentPrograms: Set<number>,
        _percussionKeys: Set<number>,
        _append: boolean
    ): void {}
    public setupMetronomeChannel(_metronomeChannel: number, _metronomeVolume: number): void {}
    public applyTranspositionPitches(_transpositionPitches: Map<number, number>): void {}
    public setChannelTranspositionPitch(_channel: number, _semitones: number): void {}
    public channelSetMute(_channel: number, _mute: boolean): void {}
    public channelSetSolo(_channel: number, _solo: boolean): void {}
    public resetChannelStates(): void {}
    public channelSetMixVolume(_channel: number, _volume: number): void {}
    public hasSamplesForProgram(_program: number): boolean {
        return true;
    }
    public hasSamplesForPercussion(_key: number): boolean {
        return true;
    }
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/alphatab/test/audio/FollowMedia.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiEventType } from '@coderline/alphatab/midi/MidiEvent';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { MidiUtils } from '@coderline/alphatab/midi/MidiUtils';
import { Settings } from '@coderline/alphatab/Settings';
import type { BackingTrackSyncPoint } from '@coderline/alphatab/synth/IAlphaSynth';
import { MidiFileSequencer } from '@coderline/alphatab/synth/MidiFileSequencer';
import { RecordingAudioSynthesizer } from 'test/audio/RecordingAudioSynthesizer';
import { TestPlatform } from 'test/TestPlatform';

/**
 * The backing track of syncpoints-testfile.gp is 42 s long (see SyncPoint.test.ts).
 */
const MediaDuration = 42000;

async function loadSyncPointSong(): Promise<{ midi: MidiFile; syncPoints: BackingTrackSyncPoint[] }> {
    const data = await TestPlatform.loadFile('test-data/audio/syncpoints-testfile.gp');
    const score = ScoreLoader.loadScoreFromBytes(data, new Settings());
    const midi = new MidiFile();
    const generator = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(midi));
    generator.generate();
    return { midi, syncPoints: generator.syncPoints };
}

function loadTexSong(tex: string): MidiFile {
    const score = ScoreLoader.loadAlphaTex(tex);
    const midi = new MidiFile();
    new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(midi)).generate();
    return midi;
}

function createSequencer(midi: MidiFile, syncPoints: BackingTrackSyncPoint[], speed: number) {
    const synthesizer = new RecordingAudioSynthesizer();
    const sequencer = new MidiFileSequencer(synthesizer);
    sequencer.loadMidi(midi);
    sequencer.mainUpdateSyncPoints(syncPoints);
    sequencer.playbackSpeed = speed;
    return { sequencer, synthesizer };
}

function noteOnTimes(synthesizer: RecordingAudioSynthesizer): number[] {
    return synthesizer.events
        .filter(e => !e.synthEvent.isMetronome && e.synthEvent.event?.type === MidiEventType.NoteOn)
        .map(e => e.synthEvent.time);
}

describe('FollowMediaTests', () => {
    it('fill-until-dispatches-the-events-before-the-target', () => {
        const midi = loadTexSong(`
            \\tempo 120
            .
            C4 * 4 | C4 * 4
        `);
        const { sequencer, synthesizer } = createSequencer(midi, [], 1);

        expect(sequencer.fillMidiEventQueueUntil(1000)).toBe(true);
        expect(noteOnTimes(synthesizer)).toEqual([0, 500]);

        // a target behind the current time dispatches nothing
        expect(sequencer.fillMidiEventQueueUntil(900)).toBe(false);
        expect(noteOnTimes(synthesizer)).toEqual([0, 500]);

        sequencer.fillMidiEventQueueUntil(1000.5);
        expect(noteOnTimes(synthesizer)).toEqual([0, 500, 1000]);
    });

    it('media-time-is-the-song-time-without-sync-points', async () => {
        const { midi } = await loadSyncPointSong();
        for (const speed of [0.5, 1, 1.5]) {
            const { sequencer } = createSequencer(midi, [], speed);
            // spike 9 §1: media time × speed would play the score at speed² of its tempo
            expect(sequencer.mainMidiTimeFromMediaTime(10000, MediaDuration)).toBe(10000);
        }
    });

    it('media-time-with-sync-points-does-not-depend-on-the-speed', async () => {
        const { midi, syncPoints } = await loadSyncPointSong();
        const mediaTimes = [0, 5000, 15000, 30000, 41000];
        const atOne = createSequencer(midi, syncPoints, 1).sequencer;
        const expected = mediaTimes.map(m => atOne.mainMidiTimeFromMediaTime(m, MediaDuration));
        expect(expected).toEqual(mediaTimes.map(m => atOne.mainTimePositionFromBackingTrack(m, MediaDuration)));

        for (const speed of [0.5, 1.5]) {
            const { sequencer } = createSequencer(midi, (await loadSyncPointSong()).syncPoints, speed);
            for (let i = 0; i < mediaTimes.length; i++) {
                expect(sequencer.mainMidiTimeFromMediaTime(mediaTimes[i], MediaDuration)).toBeCloseTo(expected[i], 6);
            }
        }
    });

    it('tick-to-media-time-inverts-the-mapping', async () => {
        const { midi, syncPoints } = await loadSyncPointSong();
        for (const points of [syncPoints, []]) {
            for (const speed of [0.5, 1.5]) {
                const { sequencer } = createSequencer(midi, points, speed);
                for (const tick of [0, MidiUtils.QuarterTime * 4, MidiUtils.QuarterTime * 30]) {
                    const mediaTime = sequencer.mainTickToMediaTime(tick, MediaDuration);
                    expect(sequencer.mainMidiTimeFromMediaTime(mediaTime, MediaDuration)).toBeCloseTo(
                        sequencer.mainTickPositionToTimePosition(tick) * speed,
                        3
                    );
                }
            }
        }
    });

    it('sync-bpm-at-follows-the-active-sync-point', async () => {
        const { midi, syncPoints } = await loadSyncPointSong();
        const { sequencer } = createSequencer(midi, syncPoints, 1);
        const points = sequencer.currentSyncPoints;
        expect(points.length).toBeGreaterThan(1);
        for (let i = 0; i < points.length; i++) {
            expect(sequencer.mainSyncBpmAt(points[i].syncTime)).toBe(points[i].syncBpm);
            if (i > 0) {
                expect(sequencer.mainSyncBpmAt(points[i].syncTime - 1)).toBe(points[i - 1].syncBpm);
            }
        }
        expect(createSequencer(midi, [], 1).sequencer.mainSyncBpmAt(1000)).toBe(0);
    });

    it('count-in-uses-the-given-tempo-else-the-score-tempo', () => {
        const midi = loadTexSong(`
            \\tempo 100
            \\ts 3 4
            .
            C4 * 3 | C4 * 3
        `);
        const scoreTempo = createSequencer(midi, [], 1).sequencer;
        scoreTempo.startCountIn();
        expect(scoreTempo.isPlayingCountIn).toBe(true);
        expect(scoreTempo.currentTempo).toBe(100);
        expect(scoreTempo.currentEndTime).toBeCloseTo(3 * 600, 6); // one bar of 3/4 at 100 BPM

        const syncTempo = createSequencer(midi, [], 1).sequencer;
        syncTempo.startCountIn(90);
        expect(syncTempo.currentTempo).toBe(90);
        expect(syncTempo.currentEndTime).toBeCloseTo((3 * 60000) / 90, 6);
    });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run test/audio/FollowMedia.test.ts` (from `packages/alphatab`)
Expected: FAIL — `fillMidiEventQueueUntil is not a function` (and the other new methods).

- [ ] **Step 4: Implement the sequencer methods**

In `packages/alphatab/src/synth/MidiFileSequencer.ts`, add after `fillMidiEventQueueToEndTime`:

```ts
    /**
     * Dispatches all events before the given time and moves the current state there. Used while the
     * synthesizer follows a media clock: the media decides the position, not the number of rendered samples.
     * @param midiTime The song time in milliseconds at speed 1.
     * @returns Whether any events were dispatched.
     */
    public fillMidiEventQueueUntil(midiTime: number): boolean {
        const state = this._currentState;
        if (midiTime <= state.currentTime) {
            return false;
        }
        state.currentTime = midiTime;
        let anyEventsDispatched = false;
        while (state.eventIndex < state.synthData.length && state.synthData[state.eventIndex].time < midiTime) {
            this._synthesizer.dispatchEvent(state.synthData[state.eventIndex]);
            state.eventIndex++;
            anyEventsDispatched = true;
        }
        return anyEventsDispatched;
    }

    /**
     * The song time (milliseconds at speed 1) that plays while the media is at the given time. With sync
     * points it is the mapping the backing-track cursor uses. Without sync points the media plays the song at
     * its own tempo, so the media time is the song time at any playback speed.
     */
    public mainMidiTimeFromMediaTime(mediaTime: number, mediaDuration: number): number {
        if (mediaTime < 0 || this._mainState.syncPoints.length === 0) {
            return mediaTime;
        }
        return this.mainTimePositionFromBackingTrack(mediaTime, mediaDuration) * this.playbackSpeed;
    }

    /**
     * The media time at which the main song reaches the given tick (the inverse of
     * {@link mainMidiTimeFromMediaTime}).
     */
    public mainTickToMediaTime(tick: number, mediaDuration: number): number {
        const timePosition = this.mainTickPositionToTimePosition(tick);
        if (this._mainState.syncPoints.length === 0) {
            return timePosition * this.playbackSpeed;
        }
        return this.mainTimePositionToBackingTrack(timePosition, mediaDuration);
    }

    /**
     * The media's tempo at the given media time: the BPM of the sync point active there, or 0 without sync
     * points.
     */
    public mainSyncBpmAt(mediaTime: number): number {
        const syncPoints = this._mainState.syncPoints;
        if (syncPoints.length === 0) {
            return 0;
        }
        let index = 0;
        while (index + 1 < syncPoints.length && syncPoints[index + 1].syncTime <= mediaTime) {
            index++;
        }
        return syncPoints[index].syncBpm;
    }
```

Then give the count-in an optional tempo:

```diff
-    public startCountIn() {
-        this.generateCountInMidi();
+    /**
+     * @param bpm The count-in's tempo; 0 (default) for the tempo at the current position, as before.
+     */
+    public startCountIn(bpm: number = 0) {
+        this.generateCountInMidi(bpm);
         this._currentState = this._countInState!;
@@
-    generateCountInMidi() {
+    generateCountInMidi(bpmOverride: number = 0) {
         const state = new MidiSequencerState();
@@
             timeSignatureDenominator = this._synthesizer.timeSignatureDenominator;
         }
+        if (bpmOverride > 0) {
+            bpm = bpmOverride;
+        }
 
         state.tempoChanges.push(new MidiFileSequencerTempoChange(bpm, 0, 0));
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run test/audio/FollowMedia.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/synth/MidiFileSequencer.ts packages/alphatab/test/audio/RecordingAudioSynthesizer.ts packages/alphatab/test/audio/FollowMedia.test.ts
git commit -m "feat(synth): map media time to song time for following a media clock (#2397)"
git push
```

---

### Task 3: Synth follow mode — rendering on the media's axis, stamps and the played position

**Files:**
- Create: `packages/alphatab/src/synth/MediaSampleOutput.ts`
- Modify: `packages/alphatab/src/synth/AlphaSynth.ts` (`AlphaSynthBase`: new fields and methods,
  `updatePlaybackSpeed`, `onSampleRequest`, `_onSamplesPlayed`)
- Create: `packages/alphatab/test/audio/FollowTestOutput.ts`
- Modify: `packages/alphatab/test/audio/FollowMedia.test.ts` (new tests)

**Interfaces:**
- Consumes (Task 2): `fillMidiEventQueueUntil`, `mainMidiTimeFromMediaTime`.
- Produces (used by Tasks 4, 5, 7):
  - `MediaSampleChunk` / `IMediaSampleOutput` (see "Shared interfaces")
  - on `AlphaSynthBase` (all `@internal`): `mediaSampleOutput`, `isFollowingMedia`, `followMedia(...)`,
    `seekToMediaTime(mediaTime)`, `setRateCorrection(factor)`

What it does (§4): per 64-frame micro buffer the media time advances by `microBufferMs × speed × rateCorrection`;
the sequencer moves to the song time of the micro buffer's end; each chunk carries the media time of its first
frame and the media ms per frame. The synth's own finish and loop handling is off while following: the combined
player owns the song end and the wrap (§6.2). **Gap G-1** (spike 11 §1): a speed change while following doesn't
rescale and seek. Today's `updatePlaybackSpeed` does, and in follow mode that jumped the synth 134–356 ms.

- [ ] **Step 1: Create the shared stamp types**

Create `packages/alphatab/src/synth/MediaSampleOutput.ts`:

```ts
/**
 * The media time of one chunk of samples the synthesizer rendered while following a media clock.
 * @internal
 */
export class MediaSampleChunk {
    /**
     * The media time (milliseconds) of the chunk's first frame, or -1 when the chunk is not on the media's
     * time axis (the count-in).
     */
    public mediaStart: number = -1;

    /**
     * The media milliseconds per frame, constant within a chunk.
     */
    public mediaPerFrame: number = 0;

    /**
     * Whether the chunk's first frame is the first frame after the count-in.
     */
    public countInEnd: boolean = false;
}

/**
 * Receives the samples the synthesizer renders while following a media clock, with their media time.
 * @internal
 */
export interface IMediaSampleOutput {
    addMediaSamples(samples: Float32Array, chunk: MediaSampleChunk): void;
}
```

- [ ] **Step 2: Write the test output helper**

Create `packages/alphatab/test/audio/FollowTestOutput.ts`:

```ts
import {
    EventEmitter,
    EventEmitterOfT,
    type IEventEmitter,
    type IEventEmitterOfT
} from '@coderline/alphatab/EventEmitter';
import type { ISynthOutput, ISynthOutputDevice } from '@coderline/alphatab/synth/ISynthOutput';
import type { IMediaSampleOutput, MediaSampleChunk } from '@coderline/alphatab/synth/MediaSampleOutput';
import { SynthConstants } from '@coderline/alphatab/synth/SynthConstants';

/**
 * A chunk the {@link FollowTestOutput} received.
 * @internal
 */
export class RecordedChunk {
    public readonly frames: number;
    public readonly mediaStart: number;
    public readonly mediaPerFrame: number;
    public readonly countInEnd: boolean;

    public constructor(frames: number, mediaStart: number, mediaPerFrame: number, countInEnd: boolean) {
        this.frames = frames;
        this.mediaStart = mediaStart;
        this.mediaPerFrame = mediaPerFrame;
        this.countInEnd = countInEnd;
    }

    public get mediaEnd(): number {
        return this.mediaStart + this.frames * this.mediaPerFrame;
    }
}

/**
 * An output for a synthesizer that follows a media clock: records the chunks with their media time; the test
 * asks for chunks and reports frames as played.
 * @internal
 */
export class FollowTestOutput implements ISynthOutput, IMediaSampleOutput {
    public readonly chunks: RecordedChunk[] = [];
    public resetCount: number = 0;

    public get sampleRate(): number {
        return 44100;
    }

    public open(_bufferTimeInMilliseconds: number): void {
        (this.ready as EventEmitter).trigger();
    }

    public play(): void {}
    public pause(): void {}
    public destroy(): void {}
    public activate(): void {}

    public addSamples(samples: Float32Array): void {
        this.chunks.push(new RecordedChunk(samples.length / SynthConstants.AudioChannels, -1, 0, false));
    }

    public addMediaSamples(samples: Float32Array, chunk: MediaSampleChunk): void {
        this.chunks.push(
            new RecordedChunk(
                samples.length / SynthConstants.AudioChannels,
                chunk.mediaStart,
                chunk.mediaPerFrame,
                chunk.countInEnd
            )
        );
    }

    public resetSamples(): void {
        this.resetCount++;
    }

    /**
     * Asks the synthesizer for the next chunk.
     */
    public request(): void {
        (this.sampleRequest as EventEmitter).trigger();
    }

    /**
     * Reports frames as played.
     */
    public played(frames: number): void {
        (this.samplesPlayed as EventEmitterOfT<number>).trigger(frames);
    }

    /**
     * The song chunks (on the media's time axis), in order.
     */
    public get stampedChunks(): RecordedChunk[] {
        return this.chunks.filter(c => c.mediaStart >= 0);
    }

    /**
     * The media time at the end of each micro buffer rendered, in order (64 frames per micro buffer).
     */
    public microBufferEnds(): number[] {
        const ends: number[] = [];
        for (const chunk of this.chunks) {
            const microBuffers = chunk.frames / SynthConstants.MicroBufferSize;
            for (let i = 0; i < microBuffers; i++) {
                ends.push(
                    chunk.mediaStart < 0
                        ? -1
                        : chunk.mediaStart + (i + 1) * SynthConstants.MicroBufferSize * chunk.mediaPerFrame
                );
            }
        }
        return ends;
    }

    public readonly ready: IEventEmitter = new EventEmitter();
    public readonly samplesPlayed: IEventEmitterOfT<number> = new EventEmitterOfT<number>();
    public readonly sampleRequest: IEventEmitter = new EventEmitter();

    public async enumerateOutputDevices(): Promise<ISynthOutputDevice[]> {
        return [] as ISynthOutputDevice[];
    }
    public async setOutputDevice(_device: ISynthOutputDevice | null): Promise<void> {}
    public async getOutputDevice(): Promise<ISynthOutputDevice | null> {
        return null;
    }
}
```

- [ ] **Step 3: Write the failing tests**

Add to `FollowMedia.test.ts` — imports:

```ts
import { AlphaSynthBase } from '@coderline/alphatab/synth/AlphaSynth';
import { PlayerState } from '@coderline/alphatab/synth/PlayerState';
import { SynthConstants } from '@coderline/alphatab/synth/SynthConstants';
import { FollowTestOutput } from 'test/audio/FollowTestOutput';
```

then, at the end of the file:

```ts
const MicroBufferMs = (SynthConstants.MicroBufferSize / 44100) * 1000;

function createFollowingSynth(midi: MidiFile, syncPoints: BackingTrackSyncPoint[], speed: number, startMedia: number) {
    const output = new FollowTestOutput();
    const synthesizer = new RecordingAudioSynthesizer();
    const synth = new AlphaSynthBase(output, synthesizer, 500);
    synth.mediaSampleOutput = output;
    synth.loadMidiFile(midi);
    synth.playbackSpeed = speed;
    synth.followMedia(true, MediaDuration, syncPoints);
    synth.seekToMediaTime(startMedia);
    synthesizer.events.length = 0;
    synthesizer.synthesizeCalls = 0;
    return { output, synthesizer, synth };
}

function renderUntil(output: FollowTestOutput, mediaTime: number) {
    while (output.stampedChunks.length === 0 || output.stampedChunks[output.stampedChunks.length - 1].mediaEnd < mediaTime) {
        output.request();
    }
}

describe('FollowMediaSynthTests', () => {
    for (const withSyncPoints of [true, false]) {
        for (const speed of [0.5, 1, 1.5]) {
            it(`dispatches-events-at-their-media-time-${withSyncPoints ? 'sync-points' : 'no-sync-points'}-${speed}x`, async () => {
                const { midi, syncPoints } = await loadSyncPointSong();
                const points = withSyncPoints ? syncPoints : [];
                const { output, synthesizer, synth } = createFollowingSynth(midi, points, speed, 0);
                synth.play();
                renderUntil(output, 20000);

                const oracle = createSequencer(midi, withSyncPoints ? (await loadSyncPointSong()).syncPoints : [], speed).sequencer;
                const ends = output.microBufferEnds();
                const step = MicroBufferMs * speed;
                let checked = 0;
                for (const recorded of synthesizer.events) {
                    const e = recorded.synthEvent;
                    if (!e.isMetronome && e.event?.type !== MidiEventType.NoteOn) {
                        continue;
                    }
                    // the media time the event belongs to (the cursor's inverse mapping; none: song time = media time)
                    const expected = withSyncPoints
                        ? oracle.mainTimePositionToBackingTrack(e.time / speed, MediaDuration)
                        : e.time;
                    const dispatchedAt = ends[recorded.microBuffer];
                    expect(dispatchedAt - expected).toBeGreaterThanOrEqual(-1e-3);
                    expect(dispatchedAt - expected).toBeLessThanOrEqual(step + 1e-3);
                    checked++;
                }
                expect(checked).toBeGreaterThan(10);
            });
        }
    }

    it('chunk-stamps-are-continuous', async () => {
        const { midi, syncPoints } = await loadSyncPointSong();
        const { output, synth } = createFollowingSynth(midi, syncPoints, 1.5, 1000);
        synth.play();
        renderUntil(output, 3000);
        const chunks = output.stampedChunks;
        expect(chunks[0].mediaStart).toBe(1000);
        for (let i = 1; i < chunks.length; i++) {
            expect(chunks[i].mediaStart).toBeCloseTo(chunks[i - 1].mediaEnd, 9);
            expect(chunks[i].mediaPerFrame).toBeCloseTo((1000 / 44100) * 1.5, 12);
        }
    });

    it('rate-correction-scales-the-media-step', async () => {
        const { midi, syncPoints } = await loadSyncPointSong();
        const { output, synth } = createFollowingSynth(midi, syncPoints, 1, 0);
        synth.play();
        output.request();
        synth.setRateCorrection(1.02);
        output.request();
        const chunks = output.stampedChunks;
        expect(chunks[1].mediaPerFrame).toBeCloseTo((1000 / 44100) * 1.02, 12);
        expect(chunks[1].mediaStart).toBeCloseTo(chunks[0].mediaEnd, 9);
    });

    it('seek-to-media-time-restarts-the-stamps', async () => {
        const { midi, syncPoints } = await loadSyncPointSong();
        const { output, synth } = createFollowingSynth(midi, syncPoints, 1, 0);
        synth.play();
        output.request();
        const resets = output.resetCount;
        synth.seekToMediaTime(20000);
        expect(output.resetCount).toBe(resets + 1);
        output.request();
        const chunks = output.stampedChunks;
        expect(chunks[chunks.length - 1].mediaStart).toBe(20000);
        const oracle = createSequencer(midi, (await loadSyncPointSong()).syncPoints, 1).sequencer;
        expect(synth.timePosition).toBeCloseTo(oracle.mainMidiTimeFromMediaTime(20000, MediaDuration), 6);
    });

    it('played-position-follows-the-played-frames', async () => {
        const { midi, syncPoints } = await loadSyncPointSong();
        const { output, synth } = createFollowingSynth(midi, syncPoints, 1, 0);
        synth.play();
        output.request();
        output.played(1000);
        const oracle = createSequencer(midi, (await loadSyncPointSong()).syncPoints, 1).sequencer;
        expect(synth.timePosition).toBeCloseTo(
            oracle.mainMidiTimeFromMediaTime((1000 * 1000) / 44100, MediaDuration),
            6
        );
    });

    it('speed-change-while-following-keeps-the-media-position', async () => {
        const { midi, syncPoints } = await loadSyncPointSong();
        const { output, synth } = createFollowingSynth(midi, syncPoints, 1, 0);
        synth.play();
        output.request();
        output.request();
        const lastEnd = output.stampedChunks[1].mediaEnd;
        const resets = output.resetCount;
        synth.playbackSpeed = 0.75; // G-1 (spike 11 §1): no rescale and seek while following
        expect(output.resetCount).toBe(resets);
        output.request();
        const chunk = output.stampedChunks[2];
        expect(chunk.mediaStart).toBeCloseTo(lastEnd, 9);
        expect(chunk.mediaPerFrame).toBeCloseTo((1000 / 44100) * 0.75, 12);
    });

    it('keeps-following-after-the-song-ends', async () => {
        // Review Focus 1: a backing track with an outro after the last bar
        const { midi, syncPoints } = await loadSyncPointSong();
        const oracle = createSequencer(midi, (await loadSyncPointSong()).syncPoints, 1).sequencer;
        const songEnd = oracle.mainTickToMediaTime(oracle.currentEndTick, MediaDuration);
        const { output, synth } = createFollowingSynth(midi, syncPoints, 1, songEnd - 50);
        let finished = 0;
        synth.finished.on(() => finished++);
        synth.play();
        for (let i = 0; i < 5; i++) {
            output.request();
            output.played(output.chunks[output.chunks.length - 1].frames);
        }
        const chunks = output.stampedChunks;
        expect(chunks.length).toBe(5);
        for (let i = 1; i < chunks.length; i++) {
            expect(chunks[i].mediaStart).toBeCloseTo(chunks[i - 1].mediaEnd, 9);
        }
        expect(finished).toBe(0);
        expect(synth.state).toBe(PlayerState.Playing);
    });
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `npx vitest run test/audio/FollowMedia.test.ts`
Expected: FAIL — `synth.followMedia is not a function`.

- [ ] **Step 5: Implement follow mode in `AlphaSynthBase`**

In `packages/alphatab/src/synth/AlphaSynth.ts` add the import and a small class above `AlphaSynthBase`:

```ts
import { MediaSampleChunk, type IMediaSampleOutput } from '@coderline/alphatab/synth/MediaSampleOutput';

/**
 * A chunk sent while following a media clock, for the played position.
 * @internal
 */
class FollowedChunk {
    public frames: number;
    public consumed: number = 0;
    public mediaStart: number;
    public mediaPerFrame: number;

    public constructor(frames: number, mediaStart: number, mediaPerFrame: number) {
        this.frames = frames;
        this.mediaStart = mediaStart;
        this.mediaPerFrame = mediaPerFrame;
    }
}
```

Add the fields and the internal API to `AlphaSynthBase` (next to `_notPlayedSamples`):

```ts
    private _follow: boolean = false;
    private _followMediaDuration: number = 0;
    private _followMediaTime: number = 0;
    private _followRateCorrection: number = 1;
    private _followChunks: Queue<FollowedChunk> = new Queue<FollowedChunk>();
    private _followCountInEnded: boolean = false;

    /**
     * Receives the samples while following a media clock, with their media time (set by the web worker).
     * Without it the samples go to {@link output} without media time.
     * @internal
     */
    public mediaSampleOutput: IMediaSampleOutput | null = null;

    /**
     * Whether the synthesizer renders on a media's time axis ({@link followMedia}).
     * @internal
     */
    public get isFollowingMedia(): boolean {
        return this._follow;
    }

    /**
     * Makes the synthesizer render on the media's time axis: the media decides the position through the sync
     * points, and every chunk carries its media time. The own loop and finish handling is off meanwhile.
     * @internal
     */
    public followMedia(enabled: boolean, mediaDuration: number, syncPoints: BackingTrackSyncPoint[]): void {
        this._follow = enabled;
        this._followMediaDuration = mediaDuration;
        this._followRateCorrection = 1;
        this.sequencer.mainUpdateSyncPoints(syncPoints);
    }

    /**
     * Jumps to the given media time: the buffers are reset and the song state (programs, controllers) is
     * processed up to there, as for a seek.
     * @internal
     */
    public seekToMediaTime(mediaTime: number): void {
        if (this.sequencer.isPlayingOneTimeMidi) {
            this._stopOneTimeMidi();
        }
        this._followMediaTime = mediaTime;
        this._followChunks.clear();
        this._followCountInEnded = false;
        this.synthesizer.noteOffAll(true);
        const midiTime = this.sequencer.mainMidiTimeFromMediaTime(mediaTime, this._followMediaDuration);
        this.timePosition = Math.max(0, midiTime) / this.sequencer.playbackSpeed;
        this._notPlayedSamples = 0;
        this.output.resetSamples();
    }

    /**
     * Sets how fast media time advances against the synthesizer's own clock (about 0.98 to 1.02).
     * @internal
     */
    public setRateCorrection(factor: number): void {
        this._followRateCorrection = factor;
    }
```

Change `updatePlaybackSpeed` (G-1):

```diff
     protected updatePlaybackSpeed(value: number) {
         const oldSpeed: number = this.sequencer.playbackSpeed;
         this.sequencer.playbackSpeed = value;
+        if (this._follow) {
+            // the position is the media's, and a speed change doesn't move it (spike 11 §1)
+            return;
+        }
         this.timePosition = this.timePosition * (oldSpeed / value);
     }
```

Branch `onSampleRequest` and add the rendering method:

```diff
     protected onSampleRequest() {
+        if (this._follow && this.state === PlayerState.Playing) {
+            this._onFollowSampleRequest();
+            return;
+        }
         if (
```

```ts
    private _onFollowSampleRequest(): void {
        const microBufferMs = (SynthConstants.MicroBufferSize / this.synthesizer.outSampleRate) * 1000;
        const isCountIn = this.sequencer.isPlayingCountIn;
        const mediaStep = microBufferMs * this.sequencer.playbackSpeed * this._followRateCorrection;
        const mediaStart = this._followMediaTime;
        let samples: Float32Array = new Float32Array(
            SynthConstants.MicroBufferSize * SynthConstants.MicroBufferCount * SynthConstants.AudioChannels
        );
        let bufferPos: number = 0;

        for (let i = 0; i < SynthConstants.MicroBufferCount; i++) {
            if (isCountIn) {
                // the count-in runs on the synthesizer's own clock: the media waits for it
                this.sequencer.fillMidiEventQueue();
            } else {
                const nextMediaTime = this._followMediaTime + mediaStep;
                this.sequencer.fillMidiEventQueueUntil(
                    this.sequencer.mainMidiTimeFromMediaTime(nextMediaTime, this._followMediaDuration)
                );
                this._followMediaTime = nextMediaTime;
            }
            const synthesizedEvents = this.synthesizer.synthesize(samples, bufferPos, SynthConstants.MicroBufferSize);
            bufferPos += SynthConstants.MicroBufferSize * SynthConstants.AudioChannels;
            for (const e of synthesizedEvents) {
                if (this.midiEventsPlayedFilterSet.has(e.event.type)) {
                    this.playedEventsQueue.enqueue(e);
                }
            }
            if (isCountIn && this.sequencer.isFinished) {
                // the count-in ends here; the song continues in the next chunk, on the media's axis,
                // in the same stream (no buffer reset at the boundary, §4)
                this.sequencer.resetCountIn();
                this.synthesizer.setupMetronomeChannel(this.sequencer.metronomeChannel, this.metronomeVolume);
                this._followCountInEnded = true;
                break;
            }
        }

        if (bufferPos < samples.length) {
            samples = samples.subarray(0, bufferPos);
        }
        const chunk = new MediaSampleChunk();
        if (!isCountIn) {
            chunk.mediaStart = mediaStart;
            chunk.mediaPerFrame = mediaStep / SynthConstants.MicroBufferSize;
            chunk.countInEnd = this._followCountInEnded;
            this._followCountInEnded = false;
        }
        this._followChunks.enqueue(
            new FollowedChunk(bufferPos / SynthConstants.AudioChannels, chunk.mediaStart, chunk.mediaPerFrame)
        );
        this._notPlayedSamples += samples.length;
        if (this.mediaSampleOutput) {
            this.mediaSampleOutput.addMediaSamples(samples, chunk);
        } else {
            this.output.addSamples(samples);
        }
    }
```

Branch `_onSamplesPlayed` and add the played-position method:

```diff
     private _onSamplesPlayed(sampleCount: number): void {
         if (sampleCount === 0) {
             return;
         }
+        if (this._follow) {
+            this._onFollowSamplesPlayed(sampleCount);
+            return;
+        }
         const playedMillis: number = (sampleCount / this.synthesizer.outSampleRate) * 1000;
```

```ts
    private _onFollowSamplesPlayed(frameCount: number): void {
        this._notPlayedSamples -= frameCount * SynthConstants.AudioChannels;
        let remaining = frameCount;
        let playedMediaTime = -1;
        while (remaining > 0 && !this._followChunks.isEmpty) {
            const chunk = this._followChunks.peek()!;
            const take = Math.min(remaining, chunk.frames - chunk.consumed);
            chunk.consumed += take;
            remaining -= take;
            if (chunk.mediaStart >= 0) {
                playedMediaTime = chunk.mediaStart + chunk.consumed * chunk.mediaPerFrame;
            }
            if (chunk.consumed >= chunk.frames) {
                this._followChunks.dequeue();
            }
        }
        if (playedMediaTime >= 0) {
            const midiTime = this.sequencer.mainMidiTimeFromMediaTime(playedMediaTime, this._followMediaDuration);
            this.updateTimePosition(Math.max(0, midiTime) / this.sequencer.playbackSpeed, false);
        }
        // no checkForFinish: while following, the combined player owns the song end and the loop wrap (§6.2)
    }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run test/audio/FollowMedia.test.ts`
Expected: PASS (all tests of both describes).

- [ ] **Step 7: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/synth packages/alphatab/test/audio
git commit -m "feat(synth): follow a media clock: render on the media's time axis with stamped chunks (#2397)"
git push
```

---

### Task 4: Count-in while following

**Files:**
- Modify: `packages/alphatab/src/synth/AlphaSynth.ts` (`play()`, new `countInStarted` event)
- Modify: `packages/alphatab/test/audio/FollowMedia.test.ts`

**Interfaces:**
- Consumes (Tasks 2, 3): `mainSyncBpmAt`, `startCountIn(bpm)`, the follow rendering (which already ends the count-in
  in-stream and marks the first song chunk `countInEnd`).
- Produces (used by Task 5): `AlphaSynthBase.countInStarted: IEventEmitterOfT<number>` (the count-in's length in ms of
  real time, fired only while following).

§2 and §4: one bar in the time signature at the start position, at the tempo of the sync point active there (else
the score's tempo), rendered on the synth's own clock and then the song in the same stream. In mixed mode this is
what fixes today's count-in freeze and rewind (§8). Non-mixed modes stay as they are; their fix is separate work.

- [ ] **Step 1: Write the failing tests**

Add to the `FollowMediaSynthTests` describe in `FollowMedia.test.ts`:

```ts
    it('count-in-renders-before-the-song-in-one-stream', async () => {
        const { midi, syncPoints } = await loadSyncPointSong();
        const target = syncPoints[2].syncTime;
        const { output, synthesizer, synth } = createFollowingSynth(midi, syncPoints, 1, target);
        const bpm = createSequencer(midi, (await loadSyncPointSong()).syncPoints, 1).sequencer.mainSyncBpmAt(target);
        // the time signature at the start position, as the synthesizer saw it during the seek
        const beats = synthesizer.timeSignatureNumerator;
        const beatMs = (60000 / bpm) * (4 / synthesizer.timeSignatureDenominator);
        const lengths: number[] = [];
        synth.countInStarted.on(l => lengths.push(l));
        synth.countInVolume = 1;
        const resets = output.resetCount;

        synth.play();
        while (output.stampedChunks.length === 0) {
            output.request();
        }

        expect(lengths.length).toBe(1);
        expect(lengths[0]).toBeCloseTo(beats * beatMs, 6); // one bar at the sync point's tempo (§2)
        const countInFrames = output.chunks.filter(c => c.mediaStart < 0).reduce((s, c) => s + c.frames, 0);
        expect(countInFrames).toBeGreaterThanOrEqual((lengths[0] / 1000) * 44100);
        expect(countInFrames).toBeLessThanOrEqual((lengths[0] / 1000) * 44100 + SynthConstants.MicroBufferSize);
        const first = output.stampedChunks[0];
        expect(first.countInEnd).toBe(true);
        expect(first.mediaStart).toBe(target);
        expect(output.resetCount).toBe(resets); // no buffer reset at the boundary
    });

    it('count-in-clicks-one-bar-in-the-time-signature', () => {
        const midi = loadTexSong(`
            \\tempo 100
            \\ts 3 4
            .
            C4 * 3 | C4 * 3 | C4 * 3
        `);
        const { output, synthesizer, synth } = createFollowingSynth(midi, [], 1, 0);
        const lengths: number[] = [];
        synth.countInStarted.on(l => lengths.push(l));
        synth.countInVolume = 1;
        synth.play();
        while (output.stampedChunks.length === 0) {
            output.request();
        }
        const countInMicroBuffers = output.microBufferEnds().filter(e => e < 0).length;
        const countInClicks = synthesizer.events.filter(
            e => e.synthEvent.isMetronome && e.microBuffer < countInMicroBuffers
        );
        expect(countInClicks.length).toBe(3);
        expect(lengths[0]).toBeCloseTo(3 * 600, 6); // the score's tempo without sync points
    });

    it('count-in-started-fires-only-while-following', () => {
        const midi = loadTexSong(`
            \\tempo 120
            .
            C4 * 4
        `);
        const output = new FollowTestOutput();
        const synth = new AlphaSynthBase(output, new RecordingAudioSynthesizer(), 500);
        synth.loadMidiFile(midi);
        const lengths: number[] = [];
        synth.countInStarted.on(l => lengths.push(l));
        synth.countInVolume = 1;
        synth.play();
        expect(lengths.length).toBe(0);
    });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/FollowMedia.test.ts`
Expected: FAIL — `countInStarted` is undefined.

- [ ] **Step 3: Implement**

In `AlphaSynthBase` add the event (next to `midiEventsPlayed`):

```ts
    /**
     * Fired when a count-in starts while following a media clock, with its length in milliseconds of real time.
     * @internal
     */
    public readonly countInStarted: IEventEmitterOfT<number> = new EventEmitterOfT<number>();
```

and change the count-in start in `play()`:

```diff
         if (this._countInVolume > 0) {
             Logger.debug('AlphaSynth', 'Starting countin');
-            this.sequencer.startCountIn();
+            // following a media clock: the count-in plays at the media's tempo at the start position (§2)
+            this.sequencer.startCountIn(this._follow ? this.sequencer.mainSyncBpmAt(this._followMediaTime) : 0);
             this.synthesizer.setupMetronomeChannel(this.sequencer.metronomeChannel, this._countInVolume);
             this.updateTimePosition(0, true);
+            if (this._follow) {
+                (this.countInStarted as EventEmitterOfT<number>).trigger(this.sequencer.currentEndTime);
+            }
         }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/audio/FollowMedia.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/synth/AlphaSynth.ts packages/alphatab/test/audio/FollowMedia.test.ts
git commit -m "feat(synth): count-in at the media's tempo in one stream while following (#2397)"
git push
```

---

### Task 5: Worker protocol and the worker's failure signal

**Files:**
- Create: `packages/alphatab/src/platform/javascript/MediaSynthTypes.ts`
- Modify: `packages/alphatab/src/platform/worker/AlphaTabWorkerProtocol.ts`
- Modify: `packages/alphatab/src/platform/worker/AlphaSynthWorkerSynthOutput.ts`
- Modify: `packages/alphatab/src/platform/worker/AlphaSynthWebWorker.ts`
- Modify: `packages/alphatab/src/platform/worker/AlphaSynthWebWorkerApi.ts`
- Create: `packages/alphatab/test/audio/MediaWorkerProtocol.test.ts`

**Interfaces:**
- Consumes (Tasks 3, 4): `followMedia`, `seekToMediaTime`, `setRateCorrection`, `mediaSampleOutput`,
  `countInStarted`, `MediaSampleChunk`.
- Produces (used by Tasks 7, 15–20): `MediaSynthTypes.ts` (all of "Shared interfaces" for the web side);
  `AlphaSynthWebWorkerApi` implements `IMediaSynth` and has
  `mediaSampleOutput: IMediaSampleOutput | null` (set by `BrowserUiFacade` when mixing).

§5: new main → worker messages `alphaSynth.followMedia`, `alphaSynth.seekToMediaTime`, `alphaSynth.setRateCorrection`;
`alphaSynth.output.addSamples` gets `mediaStart?`, `mediaPerFrame?`, `countInEnd?`; worker → main
`alphaSynth.countInStarted`; worklet → main `alphaSynth.output.mediaTimestamp` and `alphaSynth.output.countInEnd`
(Task 7 sends them); main → worklet `alphaSynth.output.hold` / `alphaSynth.output.resume` (keep-alive, Task 7).
F-8 (spike 10 §1): a worker whose script fails to load reports nothing today, because only `message` is listened to.
The new `error` listener raises `workerFailed`. Only the combined player acts on it, so synth-only mode keeps today's
behavior.

- [ ] **Step 1: Create the web types**

Create `packages/alphatab/src/platform/javascript/MediaSynthTypes.ts`:

```ts
import type { IEventEmitterOfT } from '@coderline/alphatab/EventEmitter';
import type { BackingTrackSyncPoint, IAlphaSynth } from '@coderline/alphatab/synth/IAlphaSynth';
import type { IMediaSampleOutput } from '@coderline/alphatab/synth/MediaSampleOutput';

/**
 * "At context frame `frame` the AudioWorklet outputs media time `mediaTime`" (spec §5).
 * @target web
 * @internal
 */
export class MediaTimestampEventArgs {
    public readonly frame: number;
    public readonly mediaTime: number;

    public constructor(frame: number, mediaTime: number) {
        this.frame = frame;
        this.mediaTime = mediaTime;
    }
}

/**
 * The synthesizer's web output while it follows a media clock (implemented by AlphaSynthAudioWorkletOutput).
 * @target web
 * @internal
 */
export interface IMediaFollowingOutput extends IMediaSampleOutput {
    readonly mediaTimestamp: IEventEmitterOfT<MediaTimestampEventArgs>;
    /**
     * The context frame at which the count-in ends (refined while it is buffered).
     */
    readonly countInEnd: IEventEmitterOfT<number>;
    readonly workletFailed: IEventEmitterOfT<Error>;
    readonly workletNode: AudioNode | null;
    /**
     * Keep the worklet between plays: pause holds it silently, play resumes it (spike finding F7).
     */
    keepAlive: boolean;
    /**
     * Where the worklet's output goes; the context's destination when null.
     */
    destinationNode: AudioNode | null;
    /**
     * Creates the worklet now, held silent until the first play.
     */
    warmUp(): void;
}

/**
 * A synthesizer that can follow a media clock (implemented by AlphaSynthWebWorkerApi).
 * @target web
 * @internal
 */
export interface IMediaSynth extends IAlphaSynth {
    followMedia(enabled: boolean, mediaDuration: number, syncPoints: BackingTrackSyncPoint[]): void;
    seekToMediaTime(mediaTime: number): void;
    setRateCorrection(factor: number): void;
    /**
     * Fired when a count-in starts while following, with its length in milliseconds of real time.
     */
    readonly countInStarted: IEventEmitterOfT<number>;
    /**
     * Fired when the synthesizer's worker failed (for example its script could not be loaded).
     */
    readonly workerFailed: IEventEmitterOfT<Error>;
}

/**
 * The audio graph that mixes the media and the synthesizer (implemented by WebAudioMixGraph).
 * @target web
 * @internal
 */
export interface IMediaMixGraph {
    masterGain: number;
    mediaGain: number;
    synthGain: number;
    /**
     * AudioContext.currentTime, in seconds.
     */
    readonly currentTime: number;
    readonly sampleRate: number;
    readonly baseLatencyMs: number;
    readonly isRunning: boolean;
    /**
     * Runs the action once the AudioContext runs (now, if it does).
     */
    whenRunning(action: () => void): void;
    /**
     * For the sync lab's diagnostics only.
     */
    readonly context: AudioContext | null;
    readonly mediaSourceNode: AudioNode | null;
    readonly masterGainNode: GainNode | null;
}

/**
 * Time and timers for the combined player (real: BrowserMediaTimer; tests: a fake).
 * @target web
 * @internal
 */
export interface IMediaTimer {
    /**
     * Milliseconds, monotonic.
     */
    now(): number;
    setTimeout(action: () => void, ms: number): number;
    clearTimeout(id: number): void;
    /**
     * Busy-waits until `done()` or `maxMs` passed (the last few ms of the count-in hand-off, gap G-5).
     */
    spinUntil(done: () => boolean, maxMs: number): void;
}

/**
 * Measures the media's time-stretch latency at a speed (spec §6.4).
 * @target web
 * @internal
 */
export interface IMediaLatencyProbe {
    measure(speed: number): Promise<number>;
}

/**
 * @target web
 * @internal
 */
export class BrowserMediaTimer implements IMediaTimer {
    public now(): number {
        return performance.now();
    }

    public setTimeout(action: () => void, ms: number): number {
        return window.setTimeout(action, ms);
    }

    public clearTimeout(id: number): void {
        window.clearTimeout(id);
    }

    public spinUntil(done: () => boolean, maxMs: number): void {
        const until = performance.now() + maxMs;
        while (!done() && performance.now() < until) {
            // busy-wait on purpose: spike 6 measured the count-in hand-off this way (0.2–4.8 ms late)
        }
    }
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/alphatab/test/audio/MediaWorkerProtocol.test.ts`:

```ts
/**
 * The worker protocol for following a media clock (spec §5).
 * @target web
 */
import { describe, expect, it } from 'vitest';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { LogLevel } from '@coderline/alphatab/LogLevel';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import type {
    IAlphaSynthWorker,
    IAlphaSynthWorkerMessage,
    IAlphaTabWorkerGlobalScope
} from '@coderline/alphatab/platform/worker/AlphaTabWorkerProtocol';
import { AlphaSynthWebWorker } from '@coderline/alphatab/platform/worker/AlphaSynthWebWorker';
import { AlphaSynthWebWorkerApi } from '@coderline/alphatab/platform/worker/AlphaSynthWebWorkerApi';
import { Settings } from '@coderline/alphatab/Settings';
import type { IMediaSampleOutput, MediaSampleChunk } from '@coderline/alphatab/synth/MediaSampleOutput';
import { TestOutput } from 'test/audio/TestOutput';

class FakeWorkerScope implements IAlphaTabWorkerGlobalScope<IAlphaSynthWorkerMessage> {
    public readonly posted: IAlphaSynthWorkerMessage[] = [];
    private readonly _handlers: ((ev: MessageEvent<IAlphaSynthWorkerMessage>) => void)[] = [];

    public postMessage(message: IAlphaSynthWorkerMessage): void {
        this.posted.push(message);
    }
    public addEventListener(_event: 'message', handler: (ev: MessageEvent<IAlphaSynthWorkerMessage>) => void): void {
        this._handlers.push(handler);
    }
    public removeEventListener(): void {}
    public send(message: IAlphaSynthWorkerMessage): void {
        for (const handler of [...this._handlers]) {
            handler({ data: message } as MessageEvent<IAlphaSynthWorkerMessage>);
        }
    }
    public last(cmd: string): IAlphaSynthWorkerMessage | undefined {
        return [...this.posted].reverse().find(m => m.cmd === cmd);
    }
}

class FakeSynthWorker implements IAlphaSynthWorker {
    public readonly posted: IAlphaSynthWorkerMessage[] = [];
    private readonly _errorHandlers: ((ev: ErrorEvent) => void)[] = [];

    public postMessage(message: IAlphaSynthWorkerMessage): void {
        this.posted.push(message);
    }
    public addEventListener(event: 'message' | 'error', handler: (ev: never) => void): void {
        if (event === 'error') {
            this._errorHandlers.push(handler as (ev: ErrorEvent) => void);
        }
    }
    public removeEventListener(): void {}
    public terminate(): void {}
    public fail(message: string): void {
        for (const handler of this._errorHandlers) {
            handler({ message } as ErrorEvent);
        }
    }
}

class RecordingMediaOutput implements IMediaSampleOutput {
    public readonly chunks: MediaSampleChunk[] = [];
    public addMediaSamples(_samples: Float32Array, chunk: MediaSampleChunk): void {
        this.chunks.push(chunk);
    }
}

function texMidi(): MidiFile {
    const score = ScoreLoader.loadAlphaTex(`
        \\tempo 120
        .
        C4 * 4 | C4 * 4
    `);
    const midi = new MidiFile();
    new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(midi)).generate();
    return midi;
}

function startWorker(): FakeWorkerScope {
    const scope = new FakeWorkerScope();
    new AlphaSynthWebWorker(scope);
    scope.send({ cmd: 'alphaSynth.initialize', sampleRate: 44100, logLevel: LogLevel.None, bufferTimeInMilliseconds: 500 });
    scope.send({ cmd: 'alphaSynth.loadMidi', midi: JsonConverter.midiFileToJsObject(texMidi()) });
    return scope;
}

describe('MediaWorkerProtocolTests', () => {
    it('worker-renders-stamped-chunks-while-following', () => {
        const scope = startWorker();
        scope.send({ cmd: 'alphaSynth.followMedia', enabled: true, mediaDuration: 10000, syncPoints: [] });
        scope.send({ cmd: 'alphaSynth.seekToMediaTime', mediaTime: 1000 });
        scope.send({ cmd: 'alphaSynth.setRateCorrection', factor: 1.01 });
        scope.send({ cmd: 'alphaSynth.play' });
        scope.send({ cmd: 'alphaSynth.output.sampleRequest' });

        const added = scope.last('alphaSynth.output.addSamples') as { mediaStart?: number; mediaPerFrame?: number };
        expect(added.mediaStart).toBe(1000);
        expect(added.mediaPerFrame).toBeCloseTo((1000 / 44100) * 1.01, 12);
    });

    it('worker-posts-count-in-started', () => {
        const scope = startWorker();
        scope.send({ cmd: 'alphaSynth.followMedia', enabled: true, mediaDuration: 10000, syncPoints: [] });
        scope.send({ cmd: 'alphaSynth.seekToMediaTime', mediaTime: 1000 });
        scope.send({ cmd: 'alphaSynth.setCountInVolume', value: 1 });
        scope.send({ cmd: 'alphaSynth.play' });

        const started = scope.last('alphaSynth.countInStarted') as { lengthMs: number };
        expect(started.lengthMs).toBeCloseTo(4 * 500, 6); // one bar of 4/4 at 120 BPM
        scope.send({ cmd: 'alphaSynth.output.sampleRequest' });
        const added = scope.last('alphaSynth.output.addSamples') as { mediaStart?: number };
        expect(added.mediaStart).toBe(-1); // count-in samples are not on the media's axis
    });

    it('main-side-sends-the-follow-commands', () => {
        const worker = new FakeSynthWorker();
        const api = new AlphaSynthWebWorkerApi(new TestOutput(), new Settings(), worker);
        api.followMedia(true, 42000, []);
        api.seekToMediaTime(500);
        api.setRateCorrection(0.99);
        expect(worker.posted.slice(-3)).toEqual([
            { cmd: 'alphaSynth.followMedia', enabled: true, mediaDuration: 42000, syncPoints: [] },
            { cmd: 'alphaSynth.seekToMediaTime', mediaTime: 500 },
            { cmd: 'alphaSynth.setRateCorrection', factor: 0.99 }
        ]);
    });

    it('main-side-routes-stamped-samples-to-the-media-output', () => {
        const output = new TestOutput();
        const api = new AlphaSynthWebWorkerApi(output, new Settings(), new FakeSynthWorker());
        const media = new RecordingMediaOutput();
        api.mediaSampleOutput = media;

        api.handleWorkerMessage({
            data: { cmd: 'alphaSynth.output.addSamples', samples: new Float32Array(4), mediaStart: 250, mediaPerFrame: 0.5, countInEnd: true }
        } as MessageEvent<IAlphaSynthWorkerMessage>);
        expect(media.chunks.length).toBe(1);
        expect(media.chunks[0].mediaStart).toBe(250);
        expect(media.chunks[0].mediaPerFrame).toBe(0.5);
        expect(media.chunks[0].countInEnd).toBe(true);
        expect(output.sampleCount).toBe(0);

        api.handleWorkerMessage({
            data: { cmd: 'alphaSynth.output.addSamples', samples: new Float32Array(4) }
        } as MessageEvent<IAlphaSynthWorkerMessage>);
        expect(output.sampleCount).toBe(4);
    });

    it('count-in-started-reaches-the-main-side', () => {
        const api = new AlphaSynthWebWorkerApi(new TestOutput(), new Settings(), new FakeSynthWorker());
        const lengths: number[] = [];
        api.countInStarted.on(l => lengths.push(l));
        api.handleWorkerMessage({ data: { cmd: 'alphaSynth.countInStarted', lengthMs: 1800 } } as MessageEvent<IAlphaSynthWorkerMessage>);
        expect(lengths).toEqual([1800]);
    });

    it('a-worker-that-fails-raises-worker-failed', () => {
        const worker = new FakeSynthWorker();
        const api = new AlphaSynthWebWorkerApi(new TestOutput(), new Settings(), worker);
        const errors: Error[] = [];
        api.workerFailed.on(e => errors.push(e));
        worker.fail('alphaTab.worker.mjs: 404');
        expect(errors.length).toBe(1);
        expect(errors[0].message).toContain('404');
    });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaWorkerProtocol.test.ts`
Expected: FAIL (typecheck errors on the new message shapes, missing `followMedia`, `workerFailed`).

- [ ] **Step 4: Extend the protocol**

In `packages/alphatab/src/platform/worker/AlphaTabWorkerProtocol.ts` add
`import type { BackingTrackSyncPoint } from '@coderline/alphatab/synth/IAlphaSynth';` and extend the union and
the worker interface:

```diff
     | { cmd: 'alphaSynth.applyTranspositionPitches'; transpositionPitches: Map<number, number> }
+    | {
+          cmd: 'alphaSynth.followMedia';
+          enabled: boolean;
+          mediaDuration: number;
+          syncPoints: BackingTrackSyncPoint[];
+      }
+    | { cmd: 'alphaSynth.seekToMediaTime'; mediaTime: number }
+    | { cmd: 'alphaSynth.setRateCorrection'; factor: number }
@@
     | { cmd: 'alphaSynth.playbackRangeChanged'; playbackRange: PlaybackRange | null }
+    | { cmd: 'alphaSynth.countInStarted'; lengthMs: number }
@@
-    | { cmd: 'alphaSynth.output.addSamples'; samples: Float32Array }
+    | {
+          cmd: 'alphaSynth.output.addSamples';
+          samples: Float32Array;
+          mediaStart?: number;
+          mediaPerFrame?: number;
+          countInEnd?: boolean;
+      }
+    | { cmd: 'alphaSynth.output.mediaTimestamp'; frame: number; mediaTime: number }
+    | { cmd: 'alphaSynth.output.countInEnd'; frame: number }
+    | { cmd: 'alphaSynth.output.hold' }
+    | { cmd: 'alphaSynth.output.resume' }
     | { cmd: 'alphaSynth.output.play' }
```

```diff
-export interface IAlphaSynthWorker extends IAlphaTabWorker<IAlphaSynthWorkerMessage> {}
+export interface IAlphaSynthWorker extends IAlphaTabWorker<IAlphaSynthWorkerMessage> {
+    addEventListener(event: 'message', handler: (ev: MessageEvent<IAlphaSynthWorkerMessage>) => void): void;
+    /**
+     * The worker failed, for example because its script could not be loaded (spike 10 §1).
+     */
+    addEventListener(event: 'error', handler: (ev: ErrorEvent) => void): void;
+}
```

(If Biome's `noEmptyInterface` was the reason for `{}` before, this change removes the empty body anyway.)

- [ ] **Step 5: Worker side**

`AlphaSynthWorkerSynthOutput.ts` — implement the stamped samples:

```diff
-export class AlphaSynthWorkerSynthOutput implements ISynthOutput {
+export class AlphaSynthWorkerSynthOutput implements ISynthOutput, IMediaSampleOutput {
@@
+    public addMediaSamples(samples: Float32Array, chunk: MediaSampleChunk): void {
+        this._main.postMessage({
+            cmd: 'alphaSynth.output.addSamples',
+            samples: Environment.prepareForPostMessage(samples),
+            mediaStart: chunk.mediaStart,
+            mediaPerFrame: chunk.mediaPerFrame,
+            countInEnd: chunk.countInEnd
+        });
+    }
```

(with `import type { IMediaSampleOutput, MediaSampleChunk } from '@coderline/alphatab/synth/MediaSampleOutput';`)

`AlphaSynthWebWorker.ts` — keep the output, wire the event and the new commands:

```diff
             case 'alphaSynth.initialize':
                 AlphaSynthWorkerSynthOutput.preferredSampleRate = data.sampleRate;
                 Logger.logLevel = data.logLevel;
-                this._player = new AlphaSynth(
-                    new AlphaSynthWorkerSynthOutput(this._main),
-                    data.bufferTimeInMilliseconds
-                );
+                {
+                    const output = new AlphaSynthWorkerSynthOutput(this._main);
+                    this._player = new AlphaSynth(output, data.bufferTimeInMilliseconds);
+                    this._player.mediaSampleOutput = output;
+                }
                 this._player.positionChanged.on(e => this.onPositionChanged(e));
@@
                 this._player.playbackRangeChanged.on(e => this.onPlaybackRangeChanged(e));
+                this._player.countInStarted.on(lengthMs =>
+                    this._main.postMessage({ cmd: 'alphaSynth.countInStarted', lengthMs })
+                );
                 this._main.postMessage({
                     cmd: 'alphaSynth.ready'
                 });
 
                 break;
+            case 'alphaSynth.followMedia':
+                this._player.followMedia(data.enabled, data.mediaDuration, data.syncPoints);
+                break;
+            case 'alphaSynth.seekToMediaTime':
+                this._player.seekToMediaTime(data.mediaTime);
+                break;
+            case 'alphaSynth.setRateCorrection':
+                this._player.setRateCorrection(data.factor);
+                break;
```

- [ ] **Step 6: Main side**

`AlphaSynthWebWorkerApi.ts`:

```diff
-export class AlphaSynthWebWorkerApi implements IAlphaSynth {
+export class AlphaSynthWebWorkerApi implements IMediaSynth {
     private _synth!: IAlphaSynthWorker;
     private _output: ISynthOutput;
+
+    /**
+     * Receives the stamped samples while mixing with media (the AudioWorklet output); set by BrowserUiFacade.
+     * Without it stamped samples go to the output like any other samples.
+     * @internal
+     */
+    public mediaSampleOutput: IMediaSampleOutput | null = null;
```

In the constructor, after the `message` listener:

```diff
         this._synth.addEventListener('message', e => this.handleWorkerMessage(e));
+        // F-8 (spike 10 §1): a worker whose script fails to load only fires 'error'
+        this._synth.addEventListener('error', e => this._onWorkerError(e));
```

New members:

```ts
    public followMedia(enabled: boolean, mediaDuration: number, syncPoints: BackingTrackSyncPoint[]): void {
        this._synth.postMessage({
            cmd: 'alphaSynth.followMedia',
            enabled,
            mediaDuration,
            syncPoints: Environment.prepareForPostMessage(syncPoints)
        });
    }

    public seekToMediaTime(mediaTime: number): void {
        this._synth.postMessage({ cmd: 'alphaSynth.seekToMediaTime', mediaTime });
    }

    public setRateCorrection(factor: number): void {
        this._synth.postMessage({ cmd: 'alphaSynth.setRateCorrection', factor });
    }

    private _onWorkerError(e: ErrorEvent): void {
        // only the combined player acts on this; synth-only mode keeps today's behavior
        (this.workerFailed as EventEmitterOfT<Error>).trigger(
            new Error(`The alphaSynth worker failed: ${e.message ?? 'unknown error'}`)
        );
    }

    readonly countInStarted: IEventEmitterOfT<number> = new EventEmitterOfT<number>();
    readonly workerFailed: IEventEmitterOfT<Error> = new EventEmitterOfT<Error>();
```

In `handleWorkerMessage`:

```diff
-            case 'alphaSynth.output.addSamples':
-                this._output.addSamples(data.samples);
-                break;
+            case 'alphaSynth.output.addSamples': {
+                const mediaOutput = this.mediaSampleOutput;
+                if (mediaOutput && data.mediaStart !== undefined) {
+                    const chunk = new MediaSampleChunk();
+                    chunk.mediaStart = data.mediaStart;
+                    chunk.mediaPerFrame = data.mediaPerFrame ?? 0;
+                    chunk.countInEnd = data.countInEnd === true;
+                    mediaOutput.addMediaSamples(data.samples, chunk);
+                } else {
+                    this._output.addSamples(data.samples);
+                }
+                break;
+            }
+            case 'alphaSynth.countInStarted':
+                (this.countInStarted as EventEmitterOfT<number>).trigger(data.lengthMs);
+                break;
```

Imports: `MediaSampleChunk, type IMediaSampleOutput` from `@coderline/alphatab/synth/MediaSampleOutput`;
`type IMediaSynth` from `@coderline/alphatab/platform/javascript/MediaSynthTypes`.

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaWorkerProtocol.test.ts`
Expected: PASS (6 tests). If `toEqual` on the posted `syncPoints` fails because `prepareForPostMessage` returns a
copy in Node, compare `cmd`, `enabled` and `mediaDuration` field by field instead.

- [ ] **Step 8: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform packages/alphatab/test/audio/MediaWorkerProtocol.test.ts
git commit -m "feat(worker): protocol for following a media clock; report a failing synth worker (#2397)"
git push
```

---

