---
lap: 1
---

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

- **Execution method (chosen 2026-10-10):** subagent-driven (superpowers:subagent-driven-development). A fresh
  implementer and a fresh reviewer per task, then a whole-branch review. The main session runs the decision gates.
  Implementation starts only after the plan review (spec-triage-loop:doc-review-loop) is done.
- **Branch.** Task 1 creates `feat/2397-synth-with-media` from `25ef76d3` (the spec's base, where every line
  reference in this plan holds) in its own worktree, and carries `docs/superpowers/` and
  `docs/spikes/issue-2397/` from `spike/2397-sync-options` so the spec, this plan and the evidence travel with the
  code. Those doc commits are dropped if an upstream PR is ever prepared (§11 step 5). The spike branch stays as a
  reference; its `MixSpikePlayer` and `_spike*` code is never copied (§4: "written fresh, with tests").
- **Each task ends green and pushed.** Run the gates named in the task, commit, `git push`. Never
  `git commit --no-verify` / `git push --no-verify`. Never a bare `git stash` (the stash is shared across
  worktrees). Tracked files never contain absolute home-directory paths: use repo-relative paths.
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
   (`keeps-following-after-the-song-ends`) and Task 16 (`the-media-end-stops-both-once`).
2. **Actions in the middle of a handshake**: Pause while the media start is still delayed, Pause or a seek during
   the count-in, a speed change during the count-in. Expected: no media `play()` after a Pause, no second worklet,
   no `stateChanged` from inside the handshake. Tests: Task 16 (`pause-during-the-media-delay-cancels-the-media-start`),
   Task 17 (`pause-during-the-count-in-cancels-the-hand-off`, `a-seek-during-the-count-in-restarts-without-count-in`).
3. **Play before the background probe is done, or while the `AudioContext` is still suspended** (autoplay policy).
   Expected: the start uses the straight-line guess, the probe waits for a running context, and a value that
   lands mid-playback settles without cutting notes (D-1). Tests: Task 10 (`latency-change-settles-without-resync`),
   Task 15 (`probe-waits-for-a-running-context`) and Task 16 (`a-probe-value-during-playback-settles`).
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
`TestMediaOutput.ts`, `MediaSyncFakes.ts` (helpers); `FollowMedia.test.ts`, `MediaWorkerProtocol.test.ts`, `MediaChunkMarkers.test.ts`,
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
            .
            \\ts 3 4
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
            .
            \\ts 3 4
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

## Phase 2 — AudioWorklet output

### Task 6: Chunk markers (pure)

**Files:**
- Create: `packages/alphatab/src/platform/javascript/MediaChunkMarkers.ts`
- Create: `packages/alphatab/test/audio/MediaChunkMarkers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 7's processor): `MediaChunkMarkers` with `push(frames, mediaStart, mediaPerFrame, countInEnd)`,
  `mediaTimeAtReadPosition(): number` (−1 = not stamped), `consume(frames): boolean` (true = every consumed frame was
  stamped), `framesUntilCountInEnd(): number` (−1 = none buffered), `bufferedFrames`, `clear()`.

§5: one marker per **written** chunk, stamped or not, so the markers stay aligned with the circular buffer. (The
spike's version only kept stamped chunks, which drifts out of line as soon as the unstamped count-in samples sit in
the buffer.)

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/MediaChunkMarkers.test.ts`:

```ts
/**
 * @target web
 */
import { describe, expect, it } from 'vitest';
import { MediaChunkMarkers } from '@coderline/alphatab/platform/javascript/MediaChunkMarkers';

describe('MediaChunkMarkersTests', () => {
    it('media-time-at-the-read-position-moves-with-consumed-frames', () => {
        const markers = new MediaChunkMarkers();
        markers.push(100, 1000, 0.5, false);
        markers.push(100, 1050, 0.5, false);
        expect(markers.mediaTimeAtReadPosition()).toBe(1000);
        expect(markers.consume(40)).toBe(true);
        expect(markers.mediaTimeAtReadPosition()).toBe(1020);
        expect(markers.consume(80)).toBe(true); // crosses into the second chunk
        expect(markers.mediaTimeAtReadPosition()).toBe(1060);
        expect(markers.bufferedFrames).toBe(80);
    });

    it('unstamped-chunks-keep-the-markers-aligned', () => {
        const markers = new MediaChunkMarkers();
        markers.push(128, -1, 0, false); // count-in
        markers.push(128, 2000, 0.25, true); // the song, from the count-in's end
        expect(markers.mediaTimeAtReadPosition()).toBe(-1);
        expect(markers.consume(128)).toBe(false);
        expect(markers.mediaTimeAtReadPosition()).toBe(2000);
        expect(markers.consume(64)).toBe(true);
        expect(markers.mediaTimeAtReadPosition()).toBe(2016);
    });

    it('a-block-across-an-unstamped-chunk-is-not-stamped', () => {
        const markers = new MediaChunkMarkers();
        markers.push(64, -1, 0, false);
        markers.push(64, 500, 1, true);
        expect(markers.consume(128)).toBe(false);
    });

    it('frames-until-the-count-in-end', () => {
        const markers = new MediaChunkMarkers();
        expect(markers.framesUntilCountInEnd()).toBe(-1);
        markers.push(300, -1, 0, false);
        markers.push(200, 1000, 0.5, true);
        expect(markers.framesUntilCountInEnd()).toBe(300);
        markers.consume(128);
        expect(markers.framesUntilCountInEnd()).toBe(172);
        markers.consume(200); // the boundary has been read
        expect(markers.framesUntilCountInEnd()).toBe(-1);
    });

    it('clear-forgets-everything', () => {
        const markers = new MediaChunkMarkers();
        markers.push(100, 1000, 0.5, true);
        markers.clear();
        expect(markers.bufferedFrames).toBe(0);
        expect(markers.mediaTimeAtReadPosition()).toBe(-1);
        expect(markers.framesUntilCountInEnd()).toBe(-1);
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaChunkMarkers.test.ts`
Expected: FAIL — cannot resolve `MediaChunkMarkers`.

- [ ] **Step 3: Implement**

Create `packages/alphatab/src/platform/javascript/MediaChunkMarkers.ts`:

```ts
/**
 * @target web
 * @internal
 */
class MediaChunkMarker {
    public readonly frames: number;
    public consumed: number = 0;
    public readonly mediaStart: number;
    public readonly mediaPerFrame: number;
    public readonly countInEnd: boolean;

    public constructor(frames: number, mediaStart: number, mediaPerFrame: number, countInEnd: boolean) {
        this.frames = frames;
        this.mediaStart = mediaStart;
        this.mediaPerFrame = mediaPerFrame;
        this.countInEnd = countInEnd;
    }
}

/**
 * The media time of the samples buffered in the AudioWorklet: one marker per written chunk, in write order, so
 * the markers stay aligned with the circular sample buffer (spec §5).
 * @target web
 * @internal
 */
export class MediaChunkMarkers {
    private _markers: MediaChunkMarker[] = [];

    public get bufferedFrames(): number {
        let frames = 0;
        for (const marker of this._markers) {
            frames += marker.frames - marker.consumed;
        }
        return frames;
    }

    /**
     * Records a written chunk. A negative `mediaStart` marks samples that are not on the media's time axis.
     */
    public push(frames: number, mediaStart: number, mediaPerFrame: number, countInEnd: boolean): void {
        if (frames > 0) {
            this._markers.push(new MediaChunkMarker(frames, mediaStart, mediaPerFrame, countInEnd));
        }
    }

    /**
     * The media time of the next frame to be read, or -1 when it is not stamped or nothing is buffered.
     */
    public mediaTimeAtReadPosition(): number {
        if (this._markers.length === 0) {
            return -1;
        }
        const marker = this._markers[0];
        return marker.mediaStart < 0 ? -1 : marker.mediaStart + marker.consumed * marker.mediaPerFrame;
    }

    /**
     * The frames until the first frame of the chunk that starts after the count-in, or -1 when none is buffered.
     */
    public framesUntilCountInEnd(): number {
        let frames = 0;
        for (const marker of this._markers) {
            if (marker.countInEnd && marker.consumed === 0) {
                return frames;
            }
            frames += marker.frames - marker.consumed;
        }
        return -1;
    }

    /**
     * Consumes read frames.
     * @returns Whether every consumed frame came from a stamped chunk.
     */
    public consume(frames: number): boolean {
        let remaining = frames;
        let allStamped = true;
        while (remaining > 0 && this._markers.length > 0) {
            const marker = this._markers[0];
            const take = Math.min(remaining, marker.frames - marker.consumed);
            if (marker.mediaStart < 0) {
                allStamped = false;
            }
            marker.consumed += take;
            remaining -= take;
            if (marker.consumed >= marker.frames) {
                this._markers.shift();
            }
        }
        return allStamped && remaining === 0;
    }

    public clear(): void {
        this._markers = [];
    }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaChunkMarkers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform/javascript/MediaChunkMarkers.ts packages/alphatab/test/audio/MediaChunkMarkers.test.ts
git commit -m "feat(web): media-time markers aligned with the worklet's sample buffer (#2397)"
git push
```

---

### Task 7: Worklet — stamps, count-in end, keep-alive, request accounting, failure event

**Files:**
- Modify: `packages/alphatab/src/platform/javascript/AlphaSynthAudioWorkletOutput.ts` (the processor in
  `AlphaSynthWebWorklet.init()` and the `AlphaSynthAudioWorkletOutput` class)
- Create: `packages/alphatab/test/audio/AudioWorkletOutputMedia.test.ts`

**Interfaces:**
- Consumes: `MediaChunkMarkers` (Task 6); `MediaSampleChunk` (Task 3); `MediaTimestampEventArgs`,
  `IMediaFollowingOutput` (Task 5); the protocol messages (Task 5).
- Produces (used by Tasks 15–20): `AlphaSynthAudioWorkletOutput implements IMediaFollowingOutput`, plus
  `audioContext: AudioContext | null` (internal getter).

§5's three AudioWorklet changes, plus F-8's failure event:

| Change | Why |
|---|---|
| Chunk markers record written frames; a `mediaTimestamp` about every 50 ms, only when the block came entirely from stamped chunks; `countInEnd` when the boundary chunk is written, refined every ~50 ms until it is read | exact "media time at `currentFrame`"; the media start is scheduled before the count-in ends |
| Keep-alive (mixing only): `hold` = silent, no requests, buffer and markers cleared, incoming samples dropped; `resume`; `warmUp()` creates the node early | rebuilding the worklet on every Play made the first click 100–117 ms late (spike finding F7) |
| `requestedBufferCount` never below 0, **all modes** | a negative count made the worklet over-request forever: overflow dropped, the synth ran ~1.8× fast (finding F8) |
| `workletFailed` when a worklet operation fails (module load, node creation) | spike 10 §2: today the app hears nothing, the player shows Playing and nothing moves |

`currentFrame` in the AudioWorklet scope: inside `process()` it is the first frame of the block being rendered;
between blocks (in a message handler) it is the first frame of the next block. That is why the count-in end's
base frame differs between the two call sites below.

Today's output reports ready before its worklet loads (spike 10 §2). That is **today's bug**: out of scope, don't
change it. The new `workletFailed` event is only acted on by the combined player.

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/AudioWorkletOutputMedia.test.ts`:

```ts
/**
 * The AudioWorklet output while mixing with media: keep-alive, destination, stamps, failures (spec §5).
 * Web Audio is faked: these tests check the output's own logic, the sync lab checks the real audio.
 * @target web
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlphaSynthAudioWorkletOutput } from '@coderline/alphatab/platform/javascript/AlphaSynthAudioWorkletOutput';
import { BrowserUiFacade } from '@coderline/alphatab/platform/javascript/BrowserUiFacade';
import type { MediaTimestampEventArgs } from '@coderline/alphatab/platform/javascript/MediaSynthTypes';
import { Settings } from '@coderline/alphatab/Settings';
import { MediaSampleChunk } from '@coderline/alphatab/synth/MediaSampleOutput';

class FakePort {
    public readonly posted: { cmd: string }[] = [];
    private readonly _listeners: ((e: MessageEvent) => void)[] = [];
    public postMessage(message: { cmd: string }): void {
        this.posted.push(message);
    }
    public addEventListener(_type: string, listener: (e: MessageEvent) => void): void {
        this._listeners.push(listener);
    }
    public removeEventListener(_type: string, listener: (e: MessageEvent) => void): void {
        const index = this._listeners.indexOf(listener);
        if (index >= 0) {
            this._listeners.splice(index, 1);
        }
    }
    public start(): void {}
    public emit(data: unknown): void {
        for (const listener of [...this._listeners]) {
            listener({ data } as MessageEvent);
        }
    }
    public commands(): string[] {
        return this.posted.map(m => m.cmd);
    }
}

class FakeWorkletNode {
    public static created: FakeWorkletNode[] = [];
    public readonly port: FakePort = new FakePort();
    public readonly connectedTo: unknown[] = [];
    public disconnected: boolean = false;
    public constructor(_context: unknown, _name: string, _options: unknown) {
        FakeWorkletNode.created.push(this);
    }
    public connect(node: unknown): void {
        this.connectedTo.push(node);
    }
    public disconnect(): void {
        this.disconnected = true;
    }
}

class FakeAudioContext {
    public state: string = 'running';
    public sampleRate: number = 48000;
    public currentTime: number = 0;
    public readonly destination = { name: 'destination' };
    public createBuffer(): unknown {
        return {};
    }
    public createBufferSource(): unknown {
        return { buffer: null, loop: false, start() {}, stop() {}, connect() {}, disconnect() {} };
    }
    public resume(): Promise<void> {
        return Promise.resolve();
    }
    public close(): Promise<void> {
        return Promise.resolve();
    }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const globals = globalThis as unknown as Record<string, unknown>;

function setGlobal(name: string, value: unknown) {
    if (value === undefined) {
        delete globals[name];
    } else {
        globals[name] = value;
    }
}

describe('AudioWorkletOutputMediaTests', () => {
    let savedContext: unknown;
    let savedNode: unknown;
    let savedLoad: typeof BrowserUiFacade.createAlphaSynthAudioWorklet;

    beforeEach(() => {
        savedContext = globals.AudioContext;
        savedNode = globals.AudioWorkletNode;
        savedLoad = BrowserUiFacade.createAlphaSynthAudioWorklet;
        setGlobal('AudioContext', FakeAudioContext);
        setGlobal('AudioWorkletNode', FakeWorkletNode);
        BrowserUiFacade.createAlphaSynthAudioWorklet = () => Promise.resolve();
        FakeWorkletNode.created = [];
    });

    afterEach(() => {
        setGlobal('AudioContext', savedContext);
        setGlobal('AudioWorkletNode', savedNode);
        BrowserUiFacade.createAlphaSynthAudioWorklet = savedLoad;
    });

    function openOutput(): AlphaSynthAudioWorkletOutput {
        const output = new AlphaSynthAudioWorkletOutput(new Settings());
        output.open(500);
        return output;
    }

    it('keep-alive-holds-and-resumes-one-node', async () => {
        const output = openOutput();
        output.keepAlive = true;
        output.warmUp();
        await flush();
        expect(FakeWorkletNode.created.length).toBe(1);
        const port = FakeWorkletNode.created[0].port;

        output.play();
        await flush();
        output.pause();
        await flush();
        output.play();
        await flush();

        expect(FakeWorkletNode.created.length).toBe(1);
        expect(port.commands()).toEqual([
            'alphaSynth.output.hold',
            'alphaSynth.output.resume',
            'alphaSynth.output.hold',
            'alphaSynth.output.resume'
        ]);
    });

    it('without-keep-alive-pause-tears-the-node-down-as-today', async () => {
        const output = openOutput();
        output.play();
        await flush();
        output.pause();
        await flush();
        expect(FakeWorkletNode.created[0].disconnected).toBe(true);
        expect(FakeWorkletNode.created[0].port.commands()).toContain('alphaSynth.output.stop');
        output.play();
        await flush();
        expect(FakeWorkletNode.created.length).toBe(2);
    });

    it('connects-to-the-destination-node', async () => {
        const output = openOutput();
        const synthGain = { name: 'synthGain' } as unknown as AudioNode;
        output.destinationNode = synthGain;
        output.keepAlive = true;
        output.warmUp();
        await flush();
        expect(FakeWorkletNode.created[0].connectedTo).toEqual([synthGain]);
        expect(output.workletNode).toBe(FakeWorkletNode.created[0]);
    });

    it('worklet-messages-become-events', async () => {
        const output = openOutput();
        output.keepAlive = true;
        output.warmUp();
        await flush();
        const stamps: MediaTimestampEventArgs[] = [];
        const ends: number[] = [];
        output.mediaTimestamp.on(e => stamps.push(e));
        output.countInEnd.on(f => ends.push(f));
        const port = FakeWorkletNode.created[0].port;
        port.emit({ cmd: 'alphaSynth.output.mediaTimestamp', frame: 4800, mediaTime: 1234.5 });
        port.emit({ cmd: 'alphaSynth.output.countInEnd', frame: 96000 });
        expect(stamps.map(s => [s.frame, s.mediaTime])).toEqual([[4800, 1234.5]]);
        expect(ends).toEqual([96000]);
    });

    it('stamped-samples-carry-their-media-time', async () => {
        const output = openOutput();
        output.play();
        await flush();
        const chunk = new MediaSampleChunk();
        chunk.mediaStart = 100;
        chunk.mediaPerFrame = 0.02;
        output.addMediaSamples(new Float32Array(8), chunk);
        const posted = FakeWorkletNode.created[0].port.posted;
        expect(posted[posted.length - 1]).toMatchObject({
            cmd: 'alphaSynth.output.addSamples',
            mediaStart: 100,
            mediaPerFrame: 0.02,
            countInEnd: false
        });
    });

    it('a-failed-module-load-raises-worklet-failed', async () => {
        BrowserUiFacade.createAlphaSynthAudioWorklet = () => Promise.reject(new Error('worklet module 404'));
        const output = openOutput();
        const errors: Error[] = [];
        output.workletFailed.on(e => errors.push(e));
        output.play();
        await flush();
        expect(errors.length).toBe(1);
        expect(errors[0].message).toContain('404');
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/AudioWorkletOutputMedia.test.ts`
Expected: FAIL — `keepAlive`, `warmUp`, `mediaTimestamp`, `workletFailed` don't exist.

- [ ] **Step 3: The processor**

In `AlphaSynthWebWorklet.init()` (top of `AlphaSynthAudioWorkletOutput.ts`), declare the scope global next to
`sampleRate`:

```ts
/**
 * @target web
 * @internal
 */
declare let currentFrame: number;
```

Import `MediaChunkMarkers` at the top of the file. In the processor class add the fields:

```diff
                 private _requestedBufferCount: number = 0;
                 private _isStopped = false;
+                private _markers: MediaChunkMarkers = new MediaChunkMarkers();
+                private _framesSinceReport: number = 0;
+                private _isHeld: boolean = false;
```

Replace the processor's `_handleMessage`:

```ts
                private _handleMessage(e: MessageEvent<IAlphaSynthWorkerMessage>) {
                    const data = e.data;
                    const cmd = data.cmd;
                    switch (cmd) {
                        case 'alphaSynth.output.addSamples': {
                            // never below 0: a negative count over-requests forever, the overflow is dropped
                            // and the synth runs fast (spike finding F8)
                            this._requestedBufferCount = Math.max(0, this._requestedBufferCount - 1);
                            if (this._isHeld) {
                                break;
                            }
                            const f: Float32Array = data.samples;
                            const written = this._circularBuffer.write(f, 0, f.length);
                            this._markers.push(
                                written / SynthConstants.AudioChannels,
                                data.mediaStart ?? -1,
                                data.mediaPerFrame ?? 0,
                                data.countInEnd === true
                            );
                            if (data.countInEnd === true) {
                                // between blocks currentFrame is the next block's first frame
                                this._reportCountInEnd(currentFrame);
                            }
                            break;
                        }
                        case 'alphaSynth.output.resetSamples':
                            this._circularBuffer.clear();
                            this._markers.clear();
                            break;
                        case 'alphaSynth.output.stop':
                            this._isStopped = true;
                            break;
                        case 'alphaSynth.output.hold':
                            // kept alive while paused (mixing mode): silent, no requests
                            this._isHeld = true;
                            this._circularBuffer.clear();
                            this._markers.clear();
                            break;
                        case 'alphaSynth.output.resume':
                            this._isHeld = false;
                            break;
                    }
                }
```

In `process()`, after the `if (!left || !right)` check, hold:

```ts
                    if (this._isHeld) {
                        left.fill(0);
                        right.fill(0);
                        return true;
                    }
```

and around the buffer read:

```diff
+                    const mediaTime = this._markers.mediaTimeAtReadPosition();
                     const samplesFromBuffer = this._circularBuffer.read(
                         buffer,
                         0,
                         Math.min(buffer.length, this._circularBuffer.count)
                     );
+                    const frames = samplesFromBuffer / SynthConstants.AudioChannels;
+                    const blockStamped = this._markers.consume(frames) && frames === left.length;
@@
                     this.port.postMessage({
                         cmd: 'alphaSynth.output.samplesPlayed',
                         samples: samplesFromBuffer / SynthConstants.AudioChannels
                     });
+                    this._reportMediaTime(mediaTime, blockStamped, left.length);
                     this._requestBuffers();
```

New processor methods:

```ts
                private _reportMediaTime(mediaTime: number, blockStamped: boolean, blockFrames: number): void {
                    // about every 50 ms: "at this context frame I output this media time" (spec §5)
                    this._framesSinceReport += blockFrames;
                    if (this._framesSinceReport < sampleRate / 20) {
                        return;
                    }
                    this._framesSinceReport = 0;
                    if (mediaTime >= 0 && blockStamped) {
                        this.port.postMessage({
                            cmd: 'alphaSynth.output.mediaTimestamp',
                            frame: currentFrame,
                            mediaTime: mediaTime
                        });
                    }
                    // refine the count-in end while it is still buffered (an underrun moves it);
                    // in process() the next block starts after this one
                    this._reportCountInEnd(currentFrame + blockFrames);
                }

                private _reportCountInEnd(nextBlockFrame: number): void {
                    const frames = this._markers.framesUntilCountInEnd();
                    if (frames >= 0) {
                        this.port.postMessage({ cmd: 'alphaSynth.output.countInEnd', frame: nextBlockFrame + frames });
                    }
                }
```

- [ ] **Step 4: The output class**

```diff
-export class AlphaSynthAudioWorkletOutput extends AlphaSynthWebAudioOutputBase {
+export class AlphaSynthAudioWorkletOutput extends AlphaSynthWebAudioOutputBase implements IMediaFollowingOutput {
     private _worklet: AudioWorkletNode<IAlphaSynthWorkerMessage> | null = null;
+    private _isWarm: boolean = false;
+
+    /**
+     * Keep the worklet between plays (mixing mode): pause holds it silently, play resumes it.
+     * @internal
+     */
+    public keepAlive: boolean = false;
+
+    /**
+     * Where the worklet's output goes (mixing mode: the synth's gain); the context's destination when null.
+     * @internal
+     */
+    public destinationNode: AudioNode | null = null;
+
+    /** @internal */
+    public readonly mediaTimestamp: IEventEmitterOfT<MediaTimestampEventArgs> =
+        new EventEmitterOfT<MediaTimestampEventArgs>();
+    /** @internal */
+    public readonly countInEnd: IEventEmitterOfT<number> = new EventEmitterOfT<number>();
+    /** @internal */
+    public readonly workletFailed: IEventEmitterOfT<Error> = new EventEmitterOfT<Error>();
+
+    /** @internal */
+    public get workletNode(): AudioNode | null {
+        return this._worklet;
+    }
+
+    /**
+     * The AudioContext the synthesizer plays into; the combined player routes the media into it too.
+     * @internal
+     */
+    public get audioContext(): AudioContext | null {
+        return this.context;
+    }
+
+    /**
+     * Creates the worklet now and holds it silent until the first play (warm start, spike finding F7).
+     * @internal
+     */
+    public warmUp(): void {
+        const ctx = this.context;
+        if (!ctx || this._isWarm) {
+            return;
+        }
+        this._isWarm = true;
+        this._enqueue(async () => {
+            if (this._worklet) {
+                return;
+            }
+            await this._start(ctx, []);
+            // _start() assigned it; re-read past the narrowing above
+            const worklet = this._worklet as AudioWorkletNode<IAlphaSynthWorkerMessage> | null;
+            worklet?.port.postMessage({ cmd: 'alphaSynth.output.hold' });
+        });
+    }
```

`pause()` and `destroy()`:

```diff
     public override pause(): void {
         this._pendingEvents = undefined;
+        if (this.keepAlive) {
+            this._enqueue(() => {
+                this._worklet?.port.postMessage({ cmd: 'alphaSynth.output.hold' });
+            });
+            return;
+        }
         this._enqueue(() => this._stop());
     }
 
     public override destroy(): void {
+        this.keepAlive = false;
         // a pending worklet load must not delay the destroy
         this._destroyed.abort();
```

`_enqueue` raises the failure:

```diff
     private _enqueue(operation: () => void | Promise<void>): void {
         this._operations = this._operations.then(operation).catch(e => {
             Logger.error('WebAudio', `Audio Worklet operation failed: reason=${e}`);
+            // only the combined player acts on this (F-8); synth-only mode keeps today's behavior
+            (this.workletFailed as EventEmitterOfT<Error>).trigger(e instanceof Error ? e : new Error(String(e)));
         });
     }
```

`_start` resumes a kept node instead of building a second one, and connects to the destination node:

```ts
    private async _start(ctx: AudioContext, pendingEvents: IAlphaSynthWorkerMessage[]): Promise<void> {
        let worklet = this._worklet;
        if (worklet) {
            // kept alive while paused (mixing mode): resume it before the samples arrive
            worklet.port.postMessage({ cmd: 'alphaSynth.output.resume' });
        } else {
            if (!(await this._loadWorklet(ctx))) {
                // destroyed while loading
                return;
            }

            // create a worklet node which will replace the silence with the generated audio
            worklet = new AudioWorkletNode(ctx, 'alphatab', {
                numberOfOutputs: 1,
                outputChannelCount: [2],
                processorOptions: {
                    bufferTimeInMilliseconds: this._bufferTimeInMilliseconds
                }
            }) as AudioWorkletNode<IAlphaSynthWorkerMessage>;
            this._worklet = worklet;
            worklet.port.addEventListener('message', this._boundHandleMessage);
            worklet.port.start();

            // created and started together: base pause() must only ever see a started source
            this.createSource(ctx);
            this.source!.start(0);
            this.source!.connect(worklet);
            worklet.connect(this.destinationNode ?? ctx.destination);
        }

        for (const e of pendingEvents) {
            worklet.port.postMessage(e);
        }
        if (this._pendingEvents === pendingEvents) {
            this._pendingEvents = undefined;
        }
    }
```

New messages in the main-side `_handleMessage`, and the stamped samples:

```diff
             case 'alphaSynth.output.sampleRequest':
                 this.onSampleRequest();
                 break;
+            case 'alphaSynth.output.mediaTimestamp':
+                (this.mediaTimestamp as EventEmitterOfT<MediaTimestampEventArgs>).trigger(
+                    new MediaTimestampEventArgs(data.frame, data.mediaTime)
+                );
+                break;
+            case 'alphaSynth.output.countInEnd':
+                (this.countInEnd as EventEmitterOfT<number>).trigger(data.frame);
+                break;
         }
```

```ts
    public addMediaSamples(samples: Float32Array, chunk: MediaSampleChunk): void {
        this._postWorkerMessage({
            cmd: 'alphaSynth.output.addSamples',
            samples: Environment.prepareForPostMessage(samples),
            mediaStart: chunk.mediaStart,
            mediaPerFrame: chunk.mediaPerFrame,
            countInEnd: chunk.countInEnd
        });
    }
```

Imports: `EventEmitterOfT, type IEventEmitterOfT` from `@coderline/alphatab/EventEmitter`; `MediaChunkMarkers`;
`MediaTimestampEventArgs, type IMediaFollowingOutput` from `MediaSynthTypes`; `type MediaSampleChunk` from
`@coderline/alphatab/synth/MediaSampleOutput`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run test/audio/AudioWorkletOutputMedia.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform/javascript/AlphaSynthAudioWorkletOutput.ts packages/alphatab/test/audio/AudioWorkletOutputMedia.test.ts
git commit -m "feat(web): worklet media stamps, count-in end, keep-alive; request count never negative (#2397)"
git push
```

---

## Phase 3 — Sync logic (pure, web)

### Task 8: `PerSpeedValues` — the straight-line guess (F-9a)

**Files:**
- Create: `packages/alphatab/src/platform/javascript/PerSpeedValues.ts`
- Create: `packages/alphatab/test/audio/PerSpeedValues.test.ts`

**Interfaces:**
- Produces (used by Tasks 9–12, 15): `PerSpeedValues` with `get(speed)`, `set(speed, value)`, `has(speed)`,
  `delete(speed)`, `size`, `toRecord()`, static `key(speed)`.

F-9a (both apps; our design's problem; spiked: spike 11 §2; confidence Medium): a speed with no value of its own
(no learned start lead, media-start latency or probe value yet) uses a straight line between the nearest speeds that
have one. Spike 11: the first start re-synced in 0 of 6 starts with the guess, against 5 of 6 with 0.

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/PerSpeedValues.test.ts`:

```ts
/**
 * @target web
 */
import { describe, expect, it } from 'vitest';
import { PerSpeedValues } from '@coderline/alphatab/platform/javascript/PerSpeedValues';

describe('PerSpeedValuesTests', () => {
    it('nothing-learned-is-0', () => {
        expect(new PerSpeedValues().get(0.8)).toBe(0);
    });

    it('a-speed-own-value-wins', () => {
        const values = new PerSpeedValues();
        values.set(0.5, -36);
        values.set(1, 5.7);
        expect(values.get(0.5)).toBe(-36);
    });

    it('straight-line-between-learned-speeds', () => {
        // spike 11 §2: learned start leads 0.5x -36, 0.75x -25.4, 1x +5.7 ms
        const values = new PerSpeedValues();
        values.set(0.5, -36);
        values.set(0.75, -25.4);
        values.set(1, 5.7);
        expect(values.get(0.625)).toBeCloseTo(-30.7, 6);
        expect(values.get(0.875)).toBeCloseTo(-9.85, 6);
    });

    it('nearest-value-outside-the-learned-speeds', () => {
        const values = new PerSpeedValues();
        values.set(0.5, -36);
        values.set(1, 5.7);
        expect(values.get(0.25)).toBe(-36);
        expect(values.get(1.5)).toBe(5.7);
    });

    it('guess-stays-within-spike-5-error-for-probe-values', () => {
        // spec §6.4: probe values 1x 0, 0.5x 60, 0.75x 27, 1.25x -4, 1.5x -4 ms; measured at unprobed speeds
        const values = new PerSpeedValues();
        values.set(1, 0);
        values.set(0.5, 60);
        values.set(0.75, 27);
        values.set(1.25, -4);
        values.set(1.5, -4);
        const measured: [number, number][] = [
            [0.6, 54],
            [0.83, 20],
            [0.9, 18],
            [1.1, -4]
        ];
        for (const [speed, latency] of measured) {
            expect(Math.abs(values.get(speed) - latency)).toBeLessThanOrEqual(7.3);
        }
    });

    it('speed-keys-ignore-float-noise', () => {
        const values = new PerSpeedValues();
        values.set(0.1 + 0.2, 5);
        expect(values.has(0.3)).toBe(true);
        expect(values.get(0.3)).toBe(5);
        values.delete(0.3);
        expect(values.size).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/PerSpeedValues.test.ts`
Expected: FAIL — cannot resolve `PerSpeedValues`.

- [ ] **Step 3: Implement**

Create `packages/alphatab/src/platform/javascript/PerSpeedValues.ts`:

```ts
/**
 * A value per playback speed (a start lead, a media-start latency, a media latency). A speed without a value of
 * its own gets a straight-line guess between the nearest speeds that have one; outside them, the nearest value;
 * with none, 0 (spec §6.4, F-9a).
 * @target web
 * @internal
 */
export class PerSpeedValues {
    private _values: Map<number, number> = new Map<number, number>();

    /**
     * Speeds are keyed to 4 decimals: 1-BPM steps (about 0.007x) stay apart, float noise doesn't.
     */
    public static key(speed: number): number {
        return Math.round(speed * 10000) / 10000;
    }

    public get size(): number {
        return this._values.size;
    }

    public has(speed: number): boolean {
        return this._values.has(PerSpeedValues.key(speed));
    }

    public set(speed: number, value: number): void {
        this._values.set(PerSpeedValues.key(speed), value);
    }

    public delete(speed: number): void {
        this._values.delete(PerSpeedValues.key(speed));
    }

    public get(speed: number): number {
        const key = PerSpeedValues.key(speed);
        const own = this._values.get(key);
        if (own !== undefined) {
            return own;
        }
        if (this._values.size === 0) {
            return 0;
        }
        const speeds = Array.from(this._values.keys()).sort((a, b) => a - b);
        if (key <= speeds[0]) {
            return this._values.get(speeds[0])!;
        }
        const last = speeds[speeds.length - 1];
        if (key >= last) {
            return this._values.get(last)!;
        }
        let i = 0;
        while (speeds[i + 1] < key) {
            i++;
        }
        const a = speeds[i];
        const b = speeds[i + 1];
        const valueA = this._values.get(a)!;
        const valueB = this._values.get(b)!;
        return valueA + ((key - a) / (b - a)) * (valueB - valueA);
    }

    /**
     * The values by speed, rounded to 0.1 (diagnostics).
     */
    public toRecord(): Record<string, number> {
        const record: Record<string, number> = {};
        for (const [speed, value] of this._values) {
            record[String(speed)] = Math.round(value * 10) / 10;
        }
        return record;
    }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/audio/PerSpeedValues.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform/javascript/PerSpeedValues.ts packages/alphatab/test/audio/PerSpeedValues.test.ts
git commit -m "feat(web): per-speed values with a straight-line guess for unlearned speeds (#2397, F-9a)"
git push
```

---

### Task 9: `MediaSyncController` — readings, nudge, re-sync, thresholds (F-3)

**Files:**
- Create: `packages/alphatab/src/platform/javascript/MediaSyncController.ts`
- Create: `packages/alphatab/test/audio/MediaSyncController.test.ts`

**Interfaces:**
- Consumes: `PerSpeedValues` (Task 8).
- Produces (used by Tasks 10, 15–19): `MediaSyncConstants`, `IMediaSyncSynth`, `IMediaSyncClock`, `IMediaSyncTime`,
  `MediaSyncStats` (`resyncTimes`, `driftLog`, `resyncLeadMs`), `MediaSyncDriftEntry`, `MediaSyncController` with
  `startedAfterHandOff(speed, learnMediaStartLatency)`, `stopped()`, `resync()`, `speedChanged(speed)`,
  `latencyChanged()`, `onStamp(frame, synthMediaTime)`, `settleThreshold(speed)`, `baseLatencyMs`, `speed`,
  `correction`, `isActive`, `isSettling`, `startLeads`, `mediaStartLatencies`.

The rules (§6.2): act only on two consecutive readings that agree within 3 ms (their mean). Settle for 1.5 s after
a play, seek or speed change. Re-sync while settling above 12 ms at 1× and 15 ms elsewhere, and above 120 ms once
locked. Nudge `correction = 1 − clamp(EMA(drift) / 3000 ms, ±2 %)` with EMA factor 0.3; while settling at 1× the
gain is 300 ms (spike 4: 0 re-syncs in 30 starts). Re-sync lead learned from the first agreed reading after each
re-sync (0–100 ms). **F-3** (both; our design's problem; not spiked; Low): the 1× settle threshold is
max(12 ms, 2 × `baseLatency` + 1 ms). That equals 12 ms on every machine measured so far (Chrome on macOS:
`baseLatency` ≤ 5.3 ms); Task 23 runs a higher one (D-2). **G-2:** stamps are ignored for 200 ms after a re-sync.
**Speed change** (§6.2, spike 11 §1, High): always re-sync, because every change puts Chrome's media 15–43 ms behind
the synth.

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/MediaSyncController.test.ts`:

```ts
/**
 * The sync rules (spec §6.2), fed with readings.
 * @target web
 */
import { describe, expect, it } from 'vitest';
import {
    type IMediaSyncClock,
    type IMediaSyncSynth,
    type IMediaSyncTime,
    MediaSyncController
} from '@coderline/alphatab/platform/javascript/MediaSyncController';

class FakeSyncSynth implements IMediaSyncSynth {
    public readonly seeks: number[] = [];
    public readonly corrections: number[] = [];
    public seekToMediaTime(mediaTime: number): void {
        this.seeks.push(mediaTime);
    }
    public setRateCorrection(factor: number): void {
        this.corrections.push(factor);
    }
}

/**
 * Media time 10000 ms at frame 0, 48 frames per ms; "now" is 12345 ms.
 */
class FakeSyncClock implements IMediaSyncClock {
    public valid: boolean = true;
    public now: number = 12345;
    public mediaTimeAt(frame: number): number {
        return this.valid ? 10000 + frame / 48 : Number.NaN;
    }
    public mediaTimeNow(): number {
        return this.valid ? this.now : Number.NaN;
    }
}

class FakeSyncTime implements IMediaSyncTime {
    public t: number = 0;
    public now(): number {
        return this.t;
    }
}

function setup() {
    const synth = new FakeSyncSynth();
    const clock = new FakeSyncClock();
    const time = new FakeSyncTime();
    const controller = new MediaSyncController(synth, clock, time);
    let frame = 0;
    // one worklet stamp every 50 ms whose synth media time is `drift` ms off the media
    const stamp = (drift: number) => {
        time.t += 50;
        frame += 2400;
        controller.onStamp(frame, clock.mediaTimeAt(frame) + drift);
    };
    return { synth, clock, time, controller, stamp };
}

function settled(speed = 1) {
    const s = setup();
    s.controller.startedAfterHandOff(speed, false);
    s.time.t += 2000;
    return s;
}

describe('MediaSyncControllerTests', () => {
    it('acts-only-on-two-readings-that-agree', () => {
        const s = settled();
        s.stamp(200);
        s.stamp(150);
        expect(s.synth.seeks).toEqual([]);
        s.stamp(151); // 150 and 151 agree: mean 150.5 > 120
        expect(s.synth.seeks).toEqual([12345 + 10]); // the media now + the initial re-sync lead
    });

    it('settle-threshold-is-12-ms-at-1x-and-15-elsewhere', () => {
        const { controller } = setup();
        expect(controller.settleThreshold(1)).toBe(12);
        expect(controller.settleThreshold(0.5)).toBe(15);
        expect(controller.settleThreshold(1.5)).toBe(15);
    });

    it('settle-threshold-at-1x-grows-with-the-base-latency', () => {
        // F-3: max(12, 2 x baseLatency + 1)
        const { controller } = setup();
        controller.baseLatencyMs = 2.7;
        expect(controller.settleThreshold(1)).toBe(12);
        controller.baseLatencyMs = 8;
        expect(controller.settleThreshold(1)).toBe(17);
        expect(controller.settleThreshold(0.5)).toBe(15);
    });

    it('re-syncs-above-the-settle-threshold-while-settling', () => {
        const atOne = setup();
        atOne.controller.startedAfterHandOff(1, false);
        atOne.stamp(13);
        atOne.stamp(13.5); // 13.25 > 12
        expect(atOne.synth.seeks.length).toBe(1);

        const atHalf = setup();
        atHalf.controller.startedAfterHandOff(0.5, false);
        atHalf.stamp(14);
        atHalf.stamp(14.5); // 14.25 < 15
        expect(atHalf.synth.seeks.length).toBe(0);
    });

    it('locked-threshold-is-120-ms', () => {
        const s = settled();
        s.stamp(100);
        s.stamp(101);
        expect(s.synth.seeks.length).toBe(0);
    });

    it('nudge-slows-a-synth-that-is-ahead', () => {
        const s = settled();
        s.stamp(30);
        expect(s.synth.corrections[s.synth.corrections.length - 1]).toBeCloseTo(1 - 30 / 3000, 9);
        expect(s.controller.correction).toBeCloseTo(0.99, 9);
    });

    it('nudge-is-clamped-to-2-percent', () => {
        const s = settled();
        s.stamp(100);
        expect(s.controller.correction).toBeCloseTo(0.98, 9);
        const behind = settled();
        behind.stamp(-100);
        expect(behind.controller.correction).toBeCloseTo(1.02, 9);
    });

    it('settling-nudge-at-1x-is-faster', () => {
        const atOne = setup();
        atOne.controller.startedAfterHandOff(1, false);
        atOne.stamp(3); // one reading while settling: wait
        expect(atOne.synth.corrections).toEqual([]);
        atOne.stamp(3);
        expect(atOne.controller.correction).toBeCloseTo(1 - 3 / 300, 9);

        const atHalf = setup();
        atHalf.controller.startedAfterHandOff(0.5, false);
        atHalf.stamp(3);
        atHalf.stamp(3);
        expect(atHalf.controller.correction).toBeCloseTo(1 - 3 / 3000, 9);
    });

    it('ignores-readings-for-200-ms-after-a-re-sync', () => {
        // G-2: stamps rendered before the jump can still arrive
        const s = settled();
        s.controller.resync();
        const corrections = s.synth.corrections.length;
        s.stamp(500);
        s.stamp(500);
        s.stamp(500);
        expect(s.synth.seeks.length).toBe(1);
        expect(s.synth.corrections.length).toBe(corrections);
    });

    it('learns-the-re-sync-lead-from-the-first-agreed-reading', () => {
        const s = settled();
        s.controller.resync();
        s.time.t += 150;
        s.stamp(4); // t = resync + 200: read again
        s.stamp(4); // agreed +4: the synth came out 4 ms ahead
        expect(s.controller.stats.resyncLeadMs).toBe(6);
        s.controller.resync();
        expect(s.synth.seeks[s.synth.seeks.length - 1]).toBe(12345 + 6);
    });

    it('a-jumpy-clock-must-not-re-sync', () => {
        const s = settled();
        for (let i = 0; i < 6; i++) {
            s.stamp(i % 2 === 0 ? 130 : 10);
        }
        expect(s.synth.seeks).toEqual([]);
    });

    it('re-syncs-later-when-the-media-gives-no-time', () => {
        const s = settled();
        s.clock.valid = false;
        s.controller.resync();
        expect(s.synth.seeks).toEqual([]);
        s.clock.valid = true;
        s.stamp(0);
        expect(s.synth.seeks).toEqual([12345 + 10]);
    });

    it('speed-change-re-syncs-and-settles', () => {
        // spike 11 §1: every change puts Chrome's media 15-43 ms behind the synth
        const s = settled();
        s.controller.speedChanged(0.75);
        expect(s.synth.seeks).toEqual([12345 + 10 * 0.75]);
        expect(s.controller.isSettling).toBe(true);
        expect(s.controller.speed).toBe(0.75);
    });

    it('stopped-ignores-stamps', () => {
        const s = settled();
        s.controller.stopped();
        s.stamp(500);
        s.stamp(500);
        expect(s.synth.seeks).toEqual([]);
        expect(s.controller.isActive).toBe(false);
    });

    it('drift-log-stays-off-unless-turned-on', () => {
        const s = settled();
        s.stamp(5);
        expect(s.controller.stats.driftLog).toBe(null);
        s.controller.stats.driftLog = [];
        s.stamp(5);
        expect(s.controller.stats.driftLog.length).toBe(1);
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaSyncController.test.ts`
Expected: FAIL — cannot resolve `MediaSyncController`.

- [ ] **Step 3: Implement**

Create `packages/alphatab/src/platform/javascript/MediaSyncController.ts`:

```ts
import { PerSpeedValues } from '@coderline/alphatab/platform/javascript/PerSpeedValues';

/**
 * The sync rules' values (spec §6.2) and the spike values the spec doesn't list (gaps G-2 to G-5).
 * @target web
 * @internal
 */
export class MediaSyncConstants {
    /** Act only on two consecutive readings that agree within this (their mean is used). */
    public static readonly AgreementMs: number = 3;
    public static readonly SettleDurationMs: number = 1500;
    /** At 1×: above two of Chrome's 5.3 ms <audio> start steps. F-3 raises it with the base latency. */
    public static readonly SettleResyncThresholdAt1xMs: number = 12;
    /** At other speeds: the time-stretch jitter. */
    public static readonly SettleResyncThresholdMs: number = 15;
    public static readonly LockedResyncThresholdMs: number = 120;
    public static readonly NudgeGainMs: number = 3000;
    /** While settling at 1×: small offsets are closed by a faster nudge, not a re-sync (spike 4). */
    public static readonly SettleNudgeGainAt1xMs: number = 300;
    public static readonly NudgeMaxCorrection: number = 0.02;
    public static readonly NudgeEmaFactor: number = 0.3;
    public static readonly MinCorrectionChange: number = 0.0002;
    public static readonly ResyncLeadInitialMs: number = 10;
    public static readonly ResyncLeadMaxMs: number = 100;
    /** G-2: stamps rendered before a re-sync can still arrive; ignore them for this long. */
    public static readonly IgnoreAfterResyncMs: number = 200;
    /** G-4: the clamps of the learned values. */
    public static readonly StartLeadMinMs: number = -50;
    public static readonly StartLeadMaxMs: number = 150;
    public static readonly MediaStartLatencyMinMs: number = -50;
    public static readonly MediaStartLatencyMaxMs: number = 250;
    /** At speeds other than 1× both start this much media time before the target (spikes 4 and 6). */
    public static readonly PreRollMs: number = 60;
    /** F-14 (decision D-3): the count-in's media pre-roll below 1× (spike 6). */
    public static readonly CountInPreRollBelow1xMs: number = 120;
    /** The media starts anyway when the count-in's end hasn't come by its length plus this (§6.2). */
    public static readonly CountInTimeLimitExtraMs: number = 250;
    /** G-5: the hand-off timer fires this early, then waits on the audio clock for at most HandOffSpinMaxMs. */
    public static readonly HandOffEarlyMs: number = 12;
    public static readonly HandOffSpinMaxMs: number = 30;
    /** G-3: the loop-wrap timer fires this much media time before the range end. */
    public static readonly LoopWrapLeadMs: number = 15;
    /** R-2 safety net: after its play() the media must run within this. */
    public static readonly MediaStartCheckMs: number = 500;
}

/**
 * What the controller tells the synthesizer.
 * @target web
 * @internal
 */
export interface IMediaSyncSynth {
    seekToMediaTime(mediaTime: number): void;
    setRateCorrection(factor: number): void;
}

/**
 * The media clock as the controller reads it (spec §6.3).
 * @target web
 * @internal
 */
export interface IMediaSyncClock {
    /**
     * The media time (ms) heard at the given context frame, or NaN while the media gives no reliable time
     * (paused, seeking, stalled).
     */
    mediaTimeAt(frame: number): number;
    /**
     * The media time (ms) heard now, or NaN (as above).
     */
    mediaTimeNow(): number;
}

/**
 * @target web
 * @internal
 */
export interface IMediaSyncTime {
    /**
     * Milliseconds, monotonic.
     */
    now(): number;
}

/**
 * One reading, for the sync lab.
 * @target web
 * @internal
 */
export class MediaSyncDriftEntry {
    public readonly time: number;
    public readonly drift: number;
    public readonly correction: number;
    public readonly action: string;

    public constructor(time: number, drift: number, correction: number, action: string) {
        this.time = time;
        this.drift = drift;
        this.correction = correction;
        this.action = action;
    }
}

/**
 * @target web
 * @internal
 */
export class MediaSyncStats {
    public readonly resyncTimes: number[] = [];
    /**
     * Off (null) unless the sync lab turns it on: it grows with every reading.
     */
    public driftLog: MediaSyncDriftEntry[] | null = null;
    public resyncLeadMs: number = MediaSyncConstants.ResyncLeadInitialMs;
}

/**
 * Keeps the synthesizer on the media's clock (spec §6.2): compares the worklet's stamps with the media clock,
 * nudges the synthesizer's rate, re-syncs above a threshold, learns the start values, and plans the handshakes.
 * Pure logic.
 * @target web
 * @internal
 */
export class MediaSyncController {
    public readonly startLeads: PerSpeedValues = new PerSpeedValues();
    public readonly mediaStartLatencies: PerSpeedValues = new PerSpeedValues();
    public readonly stats: MediaSyncStats = new MediaSyncStats();

    /**
     * The AudioContext's base latency in ms; the settle threshold at 1× grows with it (F-3).
     */
    public baseLatencyMs: number = 0;

    private readonly _synth: IMediaSyncSynth;
    private readonly _clock: IMediaSyncClock;
    private readonly _time: IMediaSyncTime;
    private _speed: number = 1;
    private _active: boolean = false;
    private _window: number[] = [];
    private _ema: number = Number.NaN;
    private _correction: number = 1;
    private _resyncLead: number = MediaSyncConstants.ResyncLeadInitialMs;
    private _settleUntil: number = 0;
    private _ignoreUntil: number = 0;
    private _resyncPending: boolean = false;
    private _learnResyncLead: boolean = false;
    private _learnMediaStartLatency: boolean = false;

    public constructor(synth: IMediaSyncSynth, clock: IMediaSyncClock, time: IMediaSyncTime) {
        this._synth = synth;
        this._clock = clock;
        this._time = time;
    }

    public get speed(): number {
        return this._speed;
    }

    public get correction(): number {
        return this._correction;
    }

    public get isActive(): boolean {
        return this._active;
    }

    public get isSettling(): boolean {
        return this._time.now() < this._settleUntil;
    }

    /**
     * The re-sync threshold while settling (ms).
     */
    public settleThreshold(speed: number): number {
        if (speed === 1) {
            return Math.max(MediaSyncConstants.SettleResyncThresholdAt1xMs, 2 * this.baseLatencyMs + 1);
        }
        return MediaSyncConstants.SettleResyncThresholdMs;
    }

    /**
     * The media started after a count-in, by itself (external media) or after an external seek: act on the
     * stamps, settling first. With `learnMediaStartLatency` the first agreed reading tunes when the media's
     * play() is issued next time at this speed.
     */
    public startedAfterHandOff(speed: number, learnMediaStartLatency: boolean): void {
        this._begin(speed);
        this._learnMediaStartLatency = learnMediaStartLatency;
    }

    public stopped(): void {
        this._active = false;
        this._clearReadings();
        this._resyncPending = false;
    }

    /**
     * Speed change while playing: re-sync and settle (§6.2).
     */
    public speedChanged(speed: number): void {
        this._speed = speed;
        if (!this._active) {
            return;
        }
        this._settleUntil = this._time.now() + MediaSyncConstants.SettleDurationMs;
        this.resync();
    }

    /**
     * A measured media latency replaced the guess for the current speed while playing (F-9a, decision D-1):
     * settle; the drift rules re-sync only if the agreed drift then exceeds the settle threshold.
     */
    public latencyChanged(): void {
        if (!this._active) {
            return;
        }
        this._settleUntil = this._time.now() + MediaSyncConstants.SettleDurationMs;
        this._clearReadings();
    }

    /**
     * Moves the synthesizer to the media's time now (plus the learned re-sync lead). Waits for the next reading
     * when the media gives no time yet.
     */
    public resync(): void {
        const mediaTime = this._clock.mediaTimeNow();
        if (Number.isNaN(mediaTime)) {
            this._resyncPending = true;
            return;
        }
        this._resyncPending = false;
        this._clearReadings();
        this._synth.seekToMediaTime(mediaTime + this._resyncLead * this._speed);
        const now = this._time.now();
        this._ignoreUntil = now + MediaSyncConstants.IgnoreAfterResyncMs;
        this._learnResyncLead = true;
        this.stats.resyncTimes.push(now);
    }

    /**
     * A worklet stamp: at context frame `frame` the synthesizer outputs media time `synthMediaTime`.
     */
    public onStamp(frame: number, synthMediaTime: number): void {
        if (!this._active) {
            return;
        }
        const now = this._time.now();
        if (now < this._ignoreUntil) {
            return;
        }
        const mediaAtFrame = this._clock.mediaTimeAt(frame);
        if (Number.isNaN(mediaAtFrame)) {
            return;
        }
        if (this._resyncPending) {
            this.resync();
            return;
        }

        const speed = this._speed;
        const drift = synthMediaTime - mediaAtFrame;
        const settling = now < this._settleUntil;
        const window = this._window;
        window.push(drift);
        if (window.length > 3) {
            window.shift();
        }
        const agreed = this._agreed();
        const hasAgreed = !Number.isNaN(agreed);
        let action = '';

        if (this._learnResyncLead && hasAgreed) {
            this._learnResyncLead = false;
            this._resyncLead = MediaSyncController._clamp(
                this._resyncLead - agreed / speed,
                0,
                MediaSyncConstants.ResyncLeadMaxMs
            );
            this.stats.resyncLeadMs = this._resyncLead;
        }

        const threshold = settling ? this.settleThreshold(speed) : MediaSyncConstants.LockedResyncThresholdMs;
        if (hasAgreed && Math.abs(agreed) > threshold) {
            action = 'resync';
            this.resync();
        } else if (!hasAgreed && settling) {
            action = 'wait';
        } else {
            action = this._nudge(drift, settling && speed === 1);
        }
        this.stats.driftLog?.push(new MediaSyncDriftEntry(now, drift, this._correction, action));
    }

    private _begin(speed: number): void {
        this._speed = speed;
        this._active = true;
        this._clearReadings();
        this._resyncPending = false;
        this._learnResyncLead = false;
        this._learnMediaStartLatency = false;
        this._ignoreUntil = 0;
        this._settleUntil = this._time.now() + MediaSyncConstants.SettleDurationMs;
        // followMedia() resets the synthesizer's correction at every start
        this._correction = 1;
    }

    private _clearReadings(): void {
        this._window = [];
        this._ema = Number.NaN;
    }

    private _agreed(): number {
        const window = this._window;
        const n = window.length;
        if (n < 2 || Math.abs(window[n - 1] - window[n - 2]) >= MediaSyncConstants.AgreementMs) {
            return Number.NaN;
        }
        return (window[n - 1] + window[n - 2]) / 2;
    }

    private _nudge(drift: number, fast: boolean): string {
        this._ema = Number.isNaN(this._ema)
            ? drift
            : this._ema + (drift - this._ema) * MediaSyncConstants.NudgeEmaFactor;
        const gain = fast ? MediaSyncConstants.SettleNudgeGainAt1xMs : MediaSyncConstants.NudgeGainMs;
        const max = MediaSyncConstants.NudgeMaxCorrection;
        const correction = 1 - MediaSyncController._clamp(this._ema / gain, -max, max);
        if (Math.abs(correction - this._correction) <= MediaSyncConstants.MinCorrectionChange) {
            return '';
        }
        this._correction = correction;
        this._synth.setRateCorrection(correction);
        return 'nudge';
    }

    private static _clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaSyncController.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform/javascript/MediaSyncController.ts packages/alphatab/test/audio/MediaSyncController.test.ts
git commit -m "feat(web): media sync controller: agreement, nudge, re-sync, thresholds (#2397)"
git push
```

---

### Task 10: `MediaSyncController` — start handshake, learning, count-in hand-off (F-9a, F-14)

**Files:**
- Modify: `packages/alphatab/src/platform/javascript/MediaSyncController.ts`
- Modify: `packages/alphatab/test/audio/MediaSyncController.test.ts`

**Interfaces:**
- Consumes: Task 9's controller and constants; `PerSpeedValues`.
- Produces (used by Tasks 16–19): `MediaStartPlan` (`speed`, `target`, `mediaSeekTo`, `synthSeekTo`, `mediaDelayMs`,
  `catchUpGapMs`); `planStart(target, speed, mediaLatencyMs)`; `started(plan, learnStartLead)`;
  `handOffPlayTime(countInEndFrame, sampleRate, speed, preRollMediaMs)`; `static preRoll(speed, countIn)`.

The start handshake (§6.2), one learned start lead L per speed (the straight-line guess before it is learned, F-9a).
L > 0 means the synth is the slower one, so the media start is delayed by L. L < 0 means the synth starts |L|
earlier in the song.

- At 1×, the synth starts **at** the target and never past it. A positive media latency is caught up by the settle
  nudge, so the threshold allows that gap until the drift is within 2 ms.
- At other speeds both start 60 ms of media time early, and the synth starts where the media will be heard
  (latency applied).
- L is learned from the median of the first three readings after Play. If a re-sync comes first, it is learned from
  that reading instead.
- Count-in hand-off: `play()` at `countInEndFrame / sampleRate − (mediaStartLatency(speed) + preRoll / speed)`. The
  media-start latency is learned from the first agreed reading.

**F-14** (both; our design's problem; spiked in spike 6 with an emulated count-in; Medium): the count-in pre-roll
below 1× is 120 ms (0.5× downbeat +4.5…+13.9 ms; 60 ms gave +7.2…+20.5 ms). Decision D-3 re-measures it with the
real count-in.

- [ ] **Step 1: Write the failing tests**

Add to `MediaSyncController.test.ts` (import `MediaStartPlan` too):

```ts
describe('MediaSyncControllerStartTests', () => {
    it('start-at-1x-is-at-the-target-never-past-it', () => {
        const { controller } = setup();
        let plan = controller.planStart(5000, 1, 0);
        expect([plan.mediaSeekTo, plan.synthSeekTo, plan.mediaDelayMs, plan.catchUpGapMs]).toEqual([5000, 5000, 0, 0]);

        plan = controller.planStart(5000, 1, 3); // a positive latency at 1x: caught up, never pre-rolled past
        expect([plan.synthSeekTo, plan.catchUpGapMs]).toEqual([5000, 3]);

        controller.startLeads.set(1, 8); // the synth is slower: delay the media
        plan = controller.planStart(5000, 1, 0);
        expect([plan.synthSeekTo, plan.mediaDelayMs]).toEqual([5000, 8]);

        controller.startLeads.set(1, -6); // the media is slower: the synth starts earlier in the song
        plan = controller.planStart(5000, 1, 0);
        expect([plan.synthSeekTo, plan.mediaDelayMs]).toEqual([4994, 0]);
    });

    it('start-at-other-speeds-pre-rolls-and-starts-the-synth-where-the-media-is-heard', () => {
        const { controller } = setup();
        let plan = controller.planStart(5000, 0.5, 60); // spec §6.4: 0.5x latency 60 ms
        expect(plan.mediaSeekTo).toBe(4940);
        expect(plan.synthSeekTo).toBe(4940 + 60 * 0.5);
        expect(plan.synthSeekTo).toBeLessThan(5000);
        plan = controller.planStart(5000, 1.5, -4);
        expect(plan.mediaSeekTo).toBe(4940);
        expect(plan.synthSeekTo).toBeCloseTo(4940 - 6, 9);
    });

    it('an-unlearned-speed-uses-the-straight-line-guess', () => {
        // F-9a, spike 11 §2
        const { controller } = setup();
        controller.startLeads.set(0.5, -36);
        controller.startLeads.set(0.75, -25.4);
        controller.startLeads.set(1, 5.7);
        const plan = controller.planStart(5000, 0.625, 0);
        expect(plan.synthSeekTo).toBeCloseTo(4940 - 30.7 * 0.625, 6);
        expect(plan.mediaDelayMs).toBe(0);
    });

    it('learns-the-start-lead-from-the-median-of-the-first-three-readings', () => {
        const s = setup();
        s.controller.started(s.controller.planStart(5000, 1, 0), true);
        s.stamp(-4);
        s.stamp(-6);
        expect(s.synth.corrections).toEqual([]); // waiting for three readings
        s.stamp(-5); // median -5: the synth started 5 ms behind
        expect(s.controller.startLeads.get(1)).toBe(5);
    });

    it('start-lead-is-per-speed-and-clamped', () => {
        const s = setup();
        s.controller.started(s.controller.planStart(5000, 0.5, 0), true);
        s.stamp(-14);
        s.stamp(-14.5);
        s.stamp(-14.2);
        expect(s.controller.startLeads.get(0.5)).toBeCloseTo(14.2 / 0.5, 9);
        expect(s.controller.startLeads.has(1)).toBe(false);

        const far = setup();
        far.controller.started(far.controller.planStart(5000, 0.5, 0), true);
        far.stamp(-200);
        far.stamp(-201);
        expect(far.controller.startLeads.get(0.5)).toBe(150); // G-4 clamp
    });

    it('a-re-sync-before-three-readings-learns-from-the-agreed-offset', () => {
        const s = setup();
        s.controller.started(s.controller.planStart(5000, 1, 0), true);
        s.stamp(20);
        s.stamp(21); // 20.5 > 12 while settling
        expect(s.synth.seeks.length).toBe(1);
        expect(s.controller.startLeads.get(1)).toBeCloseTo(-20.5, 9);
    });

    it('the-catch-up-gap-raises-the-settle-threshold-until-caught-up', () => {
        const s = setup();
        s.controller.started(s.controller.planStart(5000, 1, 10), false); // gap 10 ms
        s.stamp(-15);
        s.stamp(-15.5); // |-15.25| < 12 + 10: nudge (speed up), no re-sync
        expect(s.synth.seeks).toEqual([]);
        expect(s.controller.correction).toBeGreaterThan(1);
        s.stamp(-1);
        s.stamp(-1.5); // caught up (within 2 ms): the gap no longer counts
        s.stamp(-13);
        s.stamp(-13.5); // 13.25 > 12
        expect(s.synth.seeks.length).toBe(1);
    });

    it('the-media-delay-is-ignored-until-the-media-starts', () => {
        const s = setup();
        s.controller.startLeads.set(1, 100);
        s.controller.started(s.controller.planStart(5000, 1, 0), false);
        s.stamp(500);
        s.stamp(500); // within the 100 ms media delay
        expect(s.synth.seeks).toEqual([]);
    });

    it('learns-the-media-start-latency-after-a-hand-off', () => {
        const s = setup();
        s.controller.startedAfterHandOff(1, true);
        s.stamp(7);
        s.stamp(8); // the media started 7.5 ms late: issue play() earlier next time
        expect(s.controller.mediaStartLatencies.get(1)).toBe(7.5);

        const fast = setup();
        fast.controller.startedAfterHandOff(1.5, true);
        fast.stamp(3);
        fast.stamp(3);
        expect(fast.controller.mediaStartLatencies.get(1.5)).toBeCloseTo(2, 9);
    });

    it('hand-off-play-time-subtracts-the-latency-and-the-pre-roll', () => {
        const { controller } = setup();
        controller.mediaStartLatencies.set(0.5, 20);
        expect(controller.handOffPlayTime(96000, 48000, 0.5, 120)).toBeCloseTo(2 - (20 + 240) / 1000, 12);
    });

    it('pre-roll-rules', () => {
        expect(MediaSyncController.preRoll(1, true)).toBe(0);
        expect(MediaSyncController.preRoll(1, false)).toBe(0);
        expect(MediaSyncController.preRoll(1.5, true)).toBe(60);
        expect(MediaSyncController.preRoll(1.25, false)).toBe(60);
        expect(MediaSyncController.preRoll(0.5, false)).toBe(60);
        expect(MediaSyncController.preRoll(0.5, true)).toBe(120); // F-14 (D-3)
    });

    it('latency-change-settles-without-resync', () => {
        // F-9a probe part (D-1)
        const s = settled();
        s.controller.latencyChanged();
        expect(s.controller.isSettling).toBe(true);
        expect(s.synth.seeks).toEqual([]);
    });

    it('a-start-resets-the-correction', () => {
        const s = settled();
        s.stamp(30);
        expect(s.controller.correction).toBeLessThan(1);
        s.controller.started(s.controller.planStart(5000, 1, 0), false);
        expect(s.controller.correction).toBe(1);
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaSyncController.test.ts`
Expected: FAIL — `planStart is not a function`.

- [ ] **Step 3: Implement**

Add the plan class to `MediaSyncController.ts`:

```ts
/**
 * Where to start the media and the synthesizer so that a start at `target` is heard together (§6.2).
 * @target web
 * @internal
 */
export class MediaStartPlan {
    public speed: number = 1;
    /** Where playback is meant to be heard from (media ms). */
    public target: number = 0;
    /** Where the media starts: the target, or PreRollMs earlier at speeds other than 1×. */
    public mediaSeekTo: number = 0;
    /** Where the synthesizer starts (media ms). */
    public synthSeekTo: number = 0;
    /** Delay the media's play() by this: the synthesizer is the slower one. */
    public mediaDelayMs: number = 0;
    /** At 1×: the synthesizer starts this far behind (a positive media latency); the settle nudge catches up. */
    public catchUpGapMs: number = 0;
}
```

New fields in `MediaSyncController`:

```ts
    private _learnStartLead: boolean = false;
    private _catchUpGap: number = 0;
    private _catchUpUntil: number = 0;
```

New methods:

```ts
    /**
     * Plans a start at media time `target` (§6.2 start handshake).
     * @param mediaLatencyMs The media's time-stretch latency at this speed (probe value or guess), real ms.
     */
    public planStart(target: number, speed: number, mediaLatencyMs: number): MediaStartPlan {
        const plan = new MediaStartPlan();
        plan.speed = speed;
        plan.target = target;
        const latency = mediaLatencyMs * speed;
        let synthBase: number;
        if (speed === 1) {
            // the synth starts at the target, never past it: a positive latency is caught up by the settle nudge
            plan.mediaSeekTo = target;
            synthBase = target + Math.min(0, latency);
            plan.catchUpGapMs = Math.max(0, latency);
        } else {
            // Chrome's time-stretch distorts the first tens of ms above and below 1×: both start early, and the
            // synth where the media will be heard (spikes 4 and 6)
            plan.mediaSeekTo = target - MediaSyncConstants.PreRollMs;
            synthBase = plan.mediaSeekTo + latency;
        }
        // learned per speed; the straight-line guess before that (F-9a)
        const lead = this.startLeads.get(speed);
        plan.synthSeekTo = synthBase + Math.min(0, lead) * speed;
        plan.mediaDelayMs = Math.max(0, lead);
        return plan;
    }

    /**
     * Both were told to play as planned: settle, and learn this speed's start lead from the first readings.
     */
    public started(plan: MediaStartPlan, learnStartLead: boolean): void {
        this._begin(plan.speed);
        this._learnStartLead = learnStartLead;
        this._catchUpGap = plan.catchUpGapMs;
        this._catchUpUntil = plan.catchUpGapMs > 0 ? this._settleUntil : 0;
        // while the media start is delayed its readings mean nothing
        this._ignoreUntil = this._time.now() + plan.mediaDelayMs;
    }

    /**
     * The context time (s) at which to issue the media's play() so it is heard from the count-in's end (§6.2).
     */
    public handOffPlayTime(countInEndFrame: number, sampleRate: number, speed: number, preRollMediaMs: number): number {
        return countInEndFrame / sampleRate - (this.mediaStartLatencies.get(speed) + preRollMediaMs / speed) / 1000;
    }

    /**
     * The media pre-roll (media ms) for a start at `speed`.
     */
    public static preRoll(speed: number, countIn: boolean): number {
        if (speed === 1) {
            return 0;
        }
        if (countIn && speed < 1) {
            return MediaSyncConstants.CountInPreRollBelow1xMs;
        }
        return MediaSyncConstants.PreRollMs;
    }

    private _learnStart(speed: number, offset: number): void {
        const current = this.startLeads.get(speed);
        this.startLeads.set(
            speed,
            MediaSyncController._clamp(
                current - (offset + this._catchUpGap) / speed,
                MediaSyncConstants.StartLeadMinMs,
                MediaSyncConstants.StartLeadMaxMs
            )
        );
    }
```

`_begin` resets the new state:

```diff
         this._learnMediaStartLatency = false;
+        this._learnStartLead = false;
+        this._catchUpGap = 0;
+        this._catchUpUntil = 0;
         this._ignoreUntil = 0;
```

`onStamp` learns and honors the catch-up gap:

```diff
         let action = '';
 
+        if (this._learnMediaStartLatency && hasAgreed) {
+            // the media started agreed/speed ms late (synth ahead): issue its play() that much earlier next time
+            this._learnMediaStartLatency = false;
+            this.mediaStartLatencies.set(
+                speed,
+                MediaSyncController._clamp(
+                    this.mediaStartLatencies.get(speed) + agreed / speed,
+                    MediaSyncConstants.MediaStartLatencyMinMs,
+                    MediaSyncConstants.MediaStartLatencyMaxMs
+                )
+            );
+        }
+        if (this._learnStartLead && window.length >= 3) {
+            // this speed's start lead: the median of the first three readings after Play
+            this._learnStartLead = false;
+            this._learnStart(speed, [...window].sort((a, b) => a - b)[1]);
+        }
         if (this._learnResyncLead && hasAgreed) {
@@
-        const threshold = settling ? this.settleThreshold(speed) : MediaSyncConstants.LockedResyncThresholdMs;
+        const catchingUp = this._catchUpGap > 0 && now < this._catchUpUntil;
+        if (catchingUp && hasAgreed && Math.abs(agreed) < 2) {
+            this._catchUpUntil = 0;
+        }
+        const threshold = settling
+            ? this.settleThreshold(speed) + (catchingUp ? this._catchUpGap : 0)
+            : MediaSyncConstants.LockedResyncThresholdMs;
         if (hasAgreed && Math.abs(agreed) > threshold) {
+            if (this._learnStartLead) {
+                // the start itself was off: learn it before the re-sync clears the readings
+                this._learnStartLead = false;
+                this._learnStart(speed, agreed);
+            }
             action = 'resync';
             this.resync();
         } else if (!hasAgreed && settling) {
             action = 'wait';
+        } else if (this._learnStartLead) {
+            action = 'wait';
         } else {
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaSyncController.test.ts`
Expected: PASS (both describes).

- [ ] **Step 5: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform/javascript/MediaSyncController.ts packages/alphatab/test/audio/MediaSyncController.test.ts
git commit -m "feat(web): start handshake planning, per-speed learning, count-in hand-off timing (#2397, F-9a, F-14)"
git push
```

---

### Task 11: Media clocks (F-11 offset, F-17 stall, F-6 started-by-media)

**Files:**
- Create: `packages/alphatab/src/platform/javascript/MediaClock.ts`
- Create: `packages/alphatab/test/audio/MediaClock.test.ts`
- Modify: `docs/superpowers/specs/2026-10-07-synth-with-media-design.md` (§6.3: sign and unit of the offset, F-11;
  the external clock's time axis, G-6)

**Interfaces:**
- Consumes: `IMediaSyncClock` (Task 9), `PerSpeedValues` (Task 8).
- Produces (used by Tasks 15–20): `IMediaClock` (see "Shared interfaces"); `IBackingTrackClockSource`,
  `AudioElementClockSource`, `BackingTrackMediaClock(source, latencies, offsetMs: () => number)`;
  `IExternalClockSource`, `ExternalMediaClock(source, offsetMs)` with `addSample(positionMs)`,
  `setPlaying(playing)`, `notePausedPosition(position)`, `restartFit()`, `expectJumpTo(target)`, `isStalled`,
  `movedSincePause()`.

§6.3: backing track `mediaTimeAt(frame) = currentTime·1000 − (ctx.currentTime − frame/sampleRate)·1000·speed +
latency(speed)·speed`. External media: a robust line over the last ~2 s of `updatePosition()` calls. Theil–Sen, as
spike 9 §4 measured: it gave one re-sync after a stall, where least squares gave a second one the other way. Both
clocks then subtract the offset.

- **F-11** (alphaTabWebsite; our design's problem; arithmetic only; High): the offset is
  `mediaSyncOffsetInMilliseconds × speed`. A positive value makes the synth play later, and the unit is ms of real
  time.
- **F-17** (alphaTabWebsite; modeled in spike 9 §4; Medium): the same position for ≥ 100 ms after the media has
  moved is a stall. A trigger on the raw samples doesn't lag (a trigger on the fitted line fired 0.3–0.6 s late).
- **F-6** (alphaTabWebsite; not spiked; Low): an update ≤ 100 ms old whose position differs from the paused
  position means the media started itself. **G-6:** samples are stamped with the context time being heard, and
  the clock is read at `frame / sampleRate`.

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/MediaClock.test.ts`:

```ts
/**
 * The media clocks (spec §6.3).
 * @target web
 */
import { describe, expect, it } from 'vitest';
import {
    BackingTrackMediaClock,
    ExternalMediaClock,
    type IBackingTrackClockSource,
    type IExternalClockSource
} from '@coderline/alphatab/platform/javascript/MediaClock';
import { PerSpeedValues } from '@coderline/alphatab/platform/javascript/PerSpeedValues';

class FakeElementSource implements IBackingTrackClockSource {
    public mediaCurrentTime: number = 10; // s
    public mediaPaused: boolean = false;
    public mediaSeeking: boolean = false;
    public contextTime: number = 2; // s
    public sampleRate: number = 48000;
    private _seeked: (() => void)[] = [];
    public onceSeeked(action: () => void): void {
        this._seeked.push(action);
    }
    public finishSeek(): void {
        this.mediaSeeking = false;
        for (const action of this._seeked.splice(0)) {
            action();
        }
    }
}

class FakeHeardTime implements IExternalClockSource {
    public heard: number = 0; // s
    public sampleRate: number = 48000;
    public heardContextTime(): number {
        return this.heard;
    }
}

describe('BackingTrackMediaClockTests', () => {
    it('media-time-at-a-frame', () => {
        const source = new FakeElementSource();
        const clock = new BackingTrackMediaClock(source, new PerSpeedValues(), () => 0);
        // the frame 0.1 s before the context's current time, at 1x
        expect(clock.mediaTimeAt((2 - 0.1) * 48000)).toBeCloseTo(10000 - 100, 9);
        clock.speed = 0.5;
        expect(clock.mediaTimeAt((2 - 0.1) * 48000)).toBeCloseTo(10000 - 50, 9);
        expect(clock.mediaTimeNow()).toBeCloseTo(10000, 9);
    });

    it('adds-the-latency-times-the-speed', () => {
        const latencies = new PerSpeedValues();
        latencies.set(0.5, 60);
        const clock = new BackingTrackMediaClock(new FakeElementSource(), latencies, () => 0);
        clock.speed = 0.5;
        expect(clock.mediaTimeNow()).toBeCloseTo(10000 + 30, 9);
    });

    it('subtracts-the-offset-times-the-speed', () => {
        // F-11: + = the synth plays later; ms of real time at any speed
        let offset = 20;
        const clock = new BackingTrackMediaClock(new FakeElementSource(), new PerSpeedValues(), () => offset);
        expect(clock.mediaTimeNow()).toBeCloseTo(10000 - 20, 9);
        clock.speed = 2;
        expect(clock.mediaTimeNow()).toBeCloseTo(10000 - 40, 9);
        offset = -10;
        expect(clock.mediaTimeNow()).toBeCloseTo(10000 + 20, 9);
    });

    it('no-time-while-paused-or-seeking', () => {
        const source = new FakeElementSource();
        const clock = new BackingTrackMediaClock(source, new PerSpeedValues(), () => 0);
        source.mediaPaused = true;
        expect(clock.mediaTimeNow()).toBeNaN();
        source.mediaPaused = false;
        source.mediaSeeking = true;
        expect(clock.mediaTimeNow()).toBeNaN();
        expect(clock.isSeeking).toBe(true);
        expect(clock.position).toBe(10000);
    });

    it('when-seeked-runs-now-or-after-the-seek', () => {
        const source = new FakeElementSource();
        const clock = new BackingTrackMediaClock(source, new PerSpeedValues(), () => 0);
        const ran: string[] = [];
        clock.whenSeeked(() => ran.push('now'));
        source.mediaSeeking = true;
        clock.whenSeeked(() => ran.push('later'));
        expect(ran).toEqual(['now']);
        source.finishSeek();
        expect(ran).toEqual(['now', 'later']);
    });
});

describe('ExternalMediaClockTests', () => {
    function feed(clock: ExternalMediaClock, time: FakeHeardTime, from: number, to: number, position: (t: number) => number) {
        for (let t = from; t <= to + 1e-9; t += 0.05) {
            time.heard = t;
            clock.addSample(position(t));
        }
    }

    it('fits-a-line-that-one-late-update-does-not-bend', () => {
        const time = new FakeHeardTime();
        const clock = new ExternalMediaClock(time, () => 0);
        clock.setPlaying(true);
        feed(clock, time, 0, 1, t => 5000 + (Math.abs(t - 0.5) < 1e-6 ? t * 1000 - 40 : t * 1000));
        expect(clock.mediaTimeAt(1.05 * 48000)).toBeCloseTo(5000 + 1050, 0);
    });

    it('no-time-before-three-samples-over-100-ms', () => {
        const time = new FakeHeardTime();
        const clock = new ExternalMediaClock(time, () => 0);
        clock.setPlaying(true);
        feed(clock, time, 0, 0.05, t => t * 1000);
        expect(clock.mediaTimeNow()).toBeNaN();
        feed(clock, time, 0.1, 0.1, t => t * 1000);
        expect(clock.mediaTimeNow()).toBeCloseTo(100, 6);
    });

    it('no-time-while-the-media-does-not-move', () => {
        const time = new FakeHeardTime();
        const clock = new ExternalMediaClock(time, () => 0);
        clock.setPlaying(true);
        feed(clock, time, 0, 0.5, () => 3000); // play() issued, the video hasn't started yet
        expect(clock.mediaTimeNow()).toBeNaN();
        expect(clock.isStalled).toBe(false); // no stall before it has moved
    });

    it('a-stall-is-the-same-position-for-100-ms-after-moving', () => {
        // F-17
        const time = new FakeHeardTime();
        const clock = new ExternalMediaClock(time, () => 0);
        clock.setPlaying(true);
        feed(clock, time, 0, 1, t => t * 1000);
        expect(clock.isStalled).toBe(false);
        feed(clock, time, 1.05, 1.1, () => 1000); // frozen for 100 ms
        expect(clock.isStalled).toBe(true);
        expect(clock.mediaTimeNow()).toBeNaN();
        time.heard = 1.15;
        clock.addSample(1050);
        expect(clock.isStalled).toBe(false);
    });

    it('subtracts-the-offset-times-the-speed', () => {
        const time = new FakeHeardTime();
        const clock = new ExternalMediaClock(time, () => 20);
        clock.speed = 2;
        clock.setPlaying(true);
        feed(clock, time, 0, 1, t => t * 2000);
        expect(clock.mediaTimeAt(1 * 48000)).toBeCloseTo(2000 - 40, 6);
    });

    it('moved-since-pause-tells-a-start-inside-the-media', () => {
        // F-6
        const time = new FakeHeardTime();
        const clock = new ExternalMediaClock(time, () => 0);
        time.heard = 1;
        clock.addSample(1000); // paused at 1000
        expect(clock.movedSincePause()).toBe(false);
        time.heard = 1.3;
        clock.addSample(1220); // the user pressed play in the video: it reached the app ~220 ms later
        expect(clock.movedSincePause()).toBe(true);
        time.heard = 1.5; // 200 ms later the update is too old to tell
        expect(clock.movedSincePause()).toBe(false);
    });

    it('a-seek-while-paused-is-not-a-start', () => {
        const time = new FakeHeardTime();
        const clock = new ExternalMediaClock(time, () => 0);
        time.heard = 1;
        clock.addSample(1000);
        clock.notePausedPosition(9000); // alphaTab seeked the paused media
        time.heard = 1.05;
        clock.addSample(9000);
        expect(clock.movedSincePause()).toBe(false);
    });

    it('expect-jump-ignores-updates-from-before-the-seek', () => {
        const time = new FakeHeardTime();
        const clock = new ExternalMediaClock(time, () => 0);
        clock.setPlaying(true);
        feed(clock, time, 0, 1, t => t * 1000);
        clock.expectJumpTo(20000);
        expect(clock.isSeeking).toBe(true);
        feed(clock, time, 1.05, 1.1, t => t * 1000); // still the old position
        expect(clock.isSeeking).toBe(true);
        feed(clock, time, 1.15, 1.3, t => 20000 + (t - 1.15) * 1000);
        expect(clock.isSeeking).toBe(false);
        expect(clock.mediaTimeAt(1.3 * 48000)).toBeCloseTo(20150, 6);
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaClock.test.ts`
Expected: FAIL — cannot resolve `MediaClock`.

- [ ] **Step 3: Implement**

Create `packages/alphatab/src/platform/javascript/MediaClock.ts`:

```ts
import type { IMediaSyncClock } from '@coderline/alphatab/platform/javascript/MediaSyncController';
import type { PerSpeedValues } from '@coderline/alphatab/platform/javascript/PerSpeedValues';

/**
 * A media clock as the combined player uses it (spec §6.3).
 * @target web
 * @internal
 */
export interface IMediaClock extends IMediaSyncClock {
    /**
     * The media's position (ms) as the media reports it: no latency, no offset.
     */
    readonly position: number;
    readonly isSeeking: boolean;
    speed: number;
    /**
     * Runs the action once the media's current seek is done (now when it isn't seeking).
     */
    whenSeeked(action: () => void): void;
}

/**
 * What the backing-track clock reads.
 * @target web
 * @internal
 */
export interface IBackingTrackClockSource {
    /** <audio>.currentTime, s */
    readonly mediaCurrentTime: number;
    readonly mediaPaused: boolean;
    readonly mediaSeeking: boolean;
    /** AudioContext.currentTime, s */
    readonly contextTime: number;
    readonly sampleRate: number;
    onceSeeked(action: () => void): void;
}

/**
 * @target web
 * @internal
 */
export class AudioElementClockSource implements IBackingTrackClockSource {
    private readonly _element: HTMLAudioElement;
    private readonly _context: AudioContext;

    public constructor(element: HTMLAudioElement, context: AudioContext) {
        this._element = element;
        this._context = context;
    }

    public get mediaCurrentTime(): number {
        return this._element.currentTime;
    }
    public get mediaPaused(): boolean {
        return this._element.paused;
    }
    public get mediaSeeking(): boolean {
        return this._element.seeking;
    }
    public get contextTime(): number {
        return this._context.currentTime;
    }
    public get sampleRate(): number {
        return this._context.sampleRate;
    }
    public onceSeeked(action: () => void): void {
        this._element.addEventListener('seeked', () => action(), { once: true });
    }
}

/**
 * The backing track's clock: the routed <audio> and the synthesizer share one AudioContext (spec §6.3).
 * @target web
 * @internal
 */
export class BackingTrackMediaClock implements IMediaClock {
    public speed: number = 1;
    private readonly _source: IBackingTrackClockSource;
    private readonly _latencies: PerSpeedValues;
    private readonly _offsetMs: () => number;

    /**
     * @param latencies The media's time-stretch latency per speed (the probe's values).
     * @param offsetMs mediaSyncOffsetInMilliseconds, read live.
     */
    public constructor(source: IBackingTrackClockSource, latencies: PerSpeedValues, offsetMs: () => number) {
        this._source = source;
        this._latencies = latencies;
        this._offsetMs = offsetMs;
    }

    public get position(): number {
        return this._source.mediaCurrentTime * 1000;
    }

    public get isSeeking(): boolean {
        return this._source.mediaSeeking;
    }

    public whenSeeked(action: () => void): void {
        if (this._source.mediaSeeking) {
            this._source.onceSeeked(action);
        } else {
            action();
        }
    }

    public mediaTimeAt(frame: number): number {
        const source = this._source;
        if (source.mediaPaused || source.mediaSeeking) {
            return Number.NaN;
        }
        const speed = this.speed;
        return (
            source.mediaCurrentTime * 1000 -
            (source.contextTime - frame / source.sampleRate) * 1000 * speed +
            this._latencies.get(speed) * speed -
            // F-11: + = the synthesizer plays later; ms of real time
            this._offsetMs() * speed
        );
    }

    public mediaTimeNow(): number {
        return this.mediaTimeAt(this._source.contextTime * this._source.sampleRate);
    }
}

/**
 * The time axis of the external media clock (implemented by WebAudioMixGraph).
 * @target web
 * @internal
 */
export interface IExternalClockSource {
    /**
     * The AudioContext time (s) of the audio being heard now (getOutputTimestamp; gap G-6).
     */
    heardContextTime(): number;
    readonly sampleRate: number;
}

/**
 * @target web
 * @internal
 */
class ExternalClockSample {
    public readonly time: number;
    public readonly position: number;

    public constructor(time: number, position: number) {
        this.time = time;
        this.position = position;
    }
}

/**
 * The external media's clock (spec §6.3): a robust line through the last ~2 s of updatePosition() calls,
 * stamped with the context time being heard and read at the moment a synthesizer frame is heard. Best-effort.
 * @target web
 * @internal
 */
export class ExternalMediaClock implements IMediaClock {
    public static readonly FitWindowS: number = 2;
    public static readonly MinFitSpanS: number = 0.1;
    /** F-17: the same position this long while playing is a stall. */
    public static readonly StallMs: number = 100;
    /** F-6: an update at most this old that shows the media moved since the pause: the media started itself. */
    public static readonly MovedWithinMs: number = 100;
    public static readonly MovedToleranceMs: number = 5;
    /** After a seek, updates further than this from the target still show the old position. */
    public static readonly JumpToleranceMs: number = 500;
    /** The fitted rate must be within this fraction of the speed for the media to count as playing. */
    public static readonly RateTolerance: number = 0.5;

    public speed: number = 1;
    private readonly _source: IExternalClockSource;
    private readonly _offsetMs: () => number;
    private _samples: ExternalClockSample[] = [];
    private _slope: number = 0;
    private _intercept: number = 0;
    private _fitValid: boolean = false;
    private _playing: boolean = false;
    private _lastPosition: number = Number.NaN;
    private _lastChangeAt: number = 0;
    private _lastSampleAt: number = Number.NEGATIVE_INFINITY;
    private _sawMovement: boolean = false;
    private _positionAtPause: number = Number.NaN;
    private _jumpTarget: number = Number.NaN;

    public constructor(source: IExternalClockSource, offsetMs: () => number) {
        this._source = source;
        this._offsetMs = offsetMs;
    }

    /**
     * An updatePosition() call: the media's position now (ms).
     */
    public addSample(positionMs: number): void {
        if (!Number.isNaN(this._jumpTarget)) {
            if (Math.abs(positionMs - this._jumpTarget) > ExternalMediaClock.JumpToleranceMs) {
                return;
            }
            this._jumpTarget = Number.NaN;
        }
        const time = this._source.heardContextTime();
        if (Number.isNaN(this._positionAtPause) && !this._playing) {
            this._positionAtPause = positionMs;
        }
        if (positionMs !== this._lastPosition) {
            if (this._playing && !Number.isNaN(this._lastPosition)) {
                this._sawMovement = true;
            }
            this._lastPosition = positionMs;
            this._lastChangeAt = time;
        }
        this._lastSampleAt = time;
        this._samples.push(new ExternalClockSample(time, positionMs));
        while (this._samples.length > 0 && this._samples[0].time < time - ExternalMediaClock.FitWindowS) {
            this._samples.shift();
        }
        this._fit();
    }

    public get position(): number {
        return Number.isNaN(this._lastPosition) ? 0 : this._lastPosition;
    }

    public get isSeeking(): boolean {
        return !Number.isNaN(this._jumpTarget);
    }

    public whenSeeked(action: () => void): void {
        // an external seek can't be awaited here; the combined player waits for the first update after it
        action();
    }

    /**
     * Whether the combined player has the media playing.
     */
    public setPlaying(playing: boolean): void {
        if (playing === this._playing) {
            return;
        }
        this._playing = playing;
        this._sawMovement = false;
        if (playing) {
            // fit the playing media only: the updates from while it was paused would bend the line
            this._samples = this._samples.slice(-1);
            this._fit();
        } else {
            this._positionAtPause = this._lastPosition;
        }
    }

    /**
     * alphaTab seeked the paused media: its new position is not a start.
     */
    public notePausedPosition(position: number): void {
        this._positionAtPause = position;
    }

    /**
     * Drops the fitted line (after a stall, a seek or a speed change).
     */
    public restartFit(): void {
        this._samples = [];
        this._fitValid = false;
    }

    /**
     * After a seek to `target`: ignore updates that still show the old position, then fit anew.
     */
    public expectJumpTo(target: number): void {
        this._jumpTarget = target;
        this.restartFit();
    }

    /**
     * F-17: playing, moved since the start, and the same position for StallMs or longer.
     */
    public get isStalled(): boolean {
        return (
            this._playing &&
            this._sawMovement &&
            (this._lastSampleAt - this._lastChangeAt) * 1000 >= ExternalMediaClock.StallMs
        );
    }

    /**
     * F-6: a recent update shows the media moved since it was last paused (play was pressed inside the media).
     */
    public movedSincePause(): boolean {
        if (Number.isNaN(this._positionAtPause) || Number.isNaN(this._lastPosition)) {
            return false;
        }
        const ageMs = (this._source.heardContextTime() - this._lastSampleAt) * 1000;
        return (
            ageMs <= ExternalMediaClock.MovedWithinMs &&
            Math.abs(this._lastPosition - this._positionAtPause) > ExternalMediaClock.MovedToleranceMs
        );
    }

    public mediaTimeAt(frame: number): number {
        if (!this._playing || !this._fitValid || this.isStalled) {
            return Number.NaN;
        }
        // G-6: frame / sampleRate is the frame's heard context time, the axis the samples are stamped on
        return this._intercept + this._slope * (frame / this._source.sampleRate) - this._offsetMs() * this.speed;
    }

    public mediaTimeNow(): number {
        return this.mediaTimeAt(this._source.heardContextTime() * this._source.sampleRate);
    }

    private _fit(): void {
        const samples = this._samples;
        const n = samples.length;
        this._fitValid = false;
        // (the small margin keeps 3 updates 50 ms apart valid despite float rounding)
        if (n < 3 || samples[n - 1].time - samples[0].time < ExternalMediaClock.MinFitSpanS - 1e-6) {
            return;
        }
        // Theil–Sen: the median of the pairwise slopes; one late update doesn't bend it (spike 9 §4)
        const slopes: number[] = [];
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const dt = samples[j].time - samples[i].time;
                if (dt > 1e-6) {
                    slopes.push((samples[j].position - samples[i].position) / dt);
                }
            }
        }
        if (slopes.length === 0) {
            return;
        }
        const slope = ExternalMediaClock._median(slopes);
        const expected = 1000 * this.speed;
        if (Math.abs(slope - expected) > expected * ExternalMediaClock.RateTolerance) {
            // not playing (yet), or a stall inside the window
            return;
        }
        this._slope = slope;
        this._intercept = ExternalMediaClock._median(samples.map(s => s.position - slope * s.time));
        this._fitValid = true;
    }

    private static _median(values: number[]): number {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = sorted.length >> 1;
        return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaClock.test.ts`
Expected: PASS (13 tests). If `fits-a-line-that-one-late-update-does-not-bend` misses by more than 0.5 ms, check
that the late sample is the only one changed (`Math.abs(t - 0.5) < 1e-6` must match exactly one step of the loop).

- [ ] **Step 5: State the offset's sign and unit in the spec (F-11, G-6)**

In `docs/superpowers/specs/2026-10-07-synth-with-media-design.md` §6.3, replace the sentence under the table.

**Before:**
> `mediaSyncOffsetInMilliseconds` is applied to both clocks as a final user adjustment (e.g. Bluetooth).

**After:**
> Both clocks subtract `mediaSyncOffsetInMilliseconds × speed` as a final user adjustment (e.g. Bluetooth): a
> positive value makes the synth play later, in milliseconds of real time at any speed (F-11). The external clock
> stamps each `updatePosition()` sample with the context time being heard (`getOutputTimestamp()`) and is read at
> frame time `F / sampleRate`; that is the moment frame F is heard, so `outputLatency` is not added again.

- [ ] **Step 6: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform/javascript/MediaClock.ts packages/alphatab/test/audio/MediaClock.test.ts docs/superpowers/specs/2026-10-07-synth-with-media-design.md
git commit -m "feat(web): backing-track and external media clocks; offset sign and unit (#2397, F-11, F-17, F-6)"
git push
```

---

### Task 12: Latency probe

**Files:**
- Create: `packages/alphatab/src/platform/javascript/MediaLatencyProbe.ts`
- Modify: `packages/alphatab/src/platform/javascript/AlphaSynthAudioWorkletOutput.ts` (register the
  `alphatab-probe-tap` processor in `AlphaSynthWebWorklet.init()`)
- Modify: `packages/alphatab/src/platform/worker/AlphaTabWorkerProtocol.ts` (`alphaSynth.probe.onset`)
- Create: `packages/alphatab/test/audio/MediaLatencyProbe.test.ts`
- Modify: `docs/superpowers/specs/2026-10-07-synth-with-media-design.md` (§13, G-7)

**Interfaces:**
- Consumes: `PerSpeedValues` (Task 8), `IMediaLatencyProbe` (Task 5).
- Produces (used by Tasks 15, 20, 21): `MediaLatencyProbe implements IMediaLatencyProbe` with
  `constructor(context, loadWorkletModule: () => Promise<void>, lengthS?, spacingS?)`, `measure(speed)`; statics
  `cache: PerSpeedValues`
  (per page session), `backgroundSpeeds = [1, 0.5, 0.75, 1.25, 1.5]`, `createProbeWav(sampleRate, lengthS, spacingS)`,
  `latencyFromOnsets(onsets, polls, beepTimes, speed)`; `ProbeWav`, `ProbePoll`.

§6.4: a generated WAV with 2 kHz beeps plays in a hidden `<audio>` at the target speed and is routed into the
synth's AudioContext, into a tap that is never heard. The latency is the median of (currentTime reaching a beep −
the beep being heard). The probe's tap is registered in alphaTab's own worklet module, so it needs no Blob URL
(CSP- and bundler-safe). The spec's ~1 s probe with 125 ms spacing is **untested**: the spike used 4 s with 250 ms
spacing, and Task 22 compares the two.

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/MediaLatencyProbe.test.ts`:

```ts
/**
 * The latency probe's pure parts (spec §6.4); the measurement itself runs in the sync lab.
 * @target web
 */
import { describe, expect, it } from 'vitest';
import { MediaLatencyProbe, ProbePoll } from '@coderline/alphatab/platform/javascript/MediaLatencyProbe';

describe('MediaLatencyProbeTests', () => {
    it('creates-a-1-second-wav-with-a-beep-every-125-ms', () => {
        const wav = MediaLatencyProbe.createProbeWav(48000, 1, 0.125);
        const view = new DataView(wav.bytes.buffer, wav.bytes.byteOffset, wav.bytes.byteLength);
        const text = (offset: number) => String.fromCharCode(...wav.bytes.subarray(offset, offset + 4));
        expect(text(0)).toBe('RIFF');
        expect(text(8)).toBe('WAVE');
        expect(view.getUint32(24, true)).toBe(48000);
        expect(view.getUint32(40, true)).toBe(48000 * 2); // 1 s of 16-bit mono
        expect(wav.beepTimes).toEqual([0.125, 0.25, 0.375, 0.5, 0.625, 0.75]);
        const sampleAt = (s: number) => view.getInt16(44 + Math.round(s * 48000) * 2 + 2 * 10, true);
        expect(Math.abs(sampleAt(0.25))).toBeGreaterThan(0); // inside a beep
        expect(sampleAt(0.3)).toBe(0); // between beeps
    });

    for (const [speed, latency] of [
        [0.5, 60],
        [1.5, -4],
        [1, 0]
    ]) {
        it(`latency-from-onsets-${speed}x`, () => {
            const beepTimes = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75];
            // the media starts at context time 1 s; a beep is heard `latency` real ms before currentTime reaches it
            const polls: ProbePoll[] = [];
            for (let ctx = 1; ctx < 1 + 1 / speed + 0.2; ctx += 0.004) {
                polls.push(new ProbePoll((ctx - 1) * speed, ctx));
            }
            const onsets = beepTimes.map(b => 1 + (b - (latency / 1000) * speed) / speed);
            onsets[0] += 0.2; // the first beep carries the start transient: skipped
            expect(MediaLatencyProbe.latencyFromOnsets(onsets, polls, beepTimes, speed)).toBeCloseTo(latency, 6);
        });
    }

    it('no-onsets-is-0', () => {
        expect(MediaLatencyProbe.latencyFromOnsets([], [], [0.125], 1)).toBe(0);
    });

    it('background-speeds-and-a-session-cache', () => {
        expect(MediaLatencyProbe.backgroundSpeeds).toEqual([1, 0.5, 0.75, 1.25, 1.5]);
        expect(MediaLatencyProbe.cache).toBe(MediaLatencyProbe.cache);
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaLatencyProbe.test.ts`
Expected: FAIL — cannot resolve `MediaLatencyProbe`.

- [ ] **Step 3: Register the tap processor and its message**

Protocol (`AlphaTabWorkerProtocol.ts`), next to the other output messages:

```ts
    | { cmd: 'alphaSynth.probe.onset'; frame: number }
```

In `AlphaSynthWebWorklet` add the tap's values and register the processor at the end of `init()`:

```ts
    /**
     * The latency probe's tap: a sample above this starts a beep (spec §6.4).
     */
    public static readonly ProbeTapThreshold: number = 0.25;
    /**
     * Frames to wait after an onset (50 ms at 48 kHz): one onset per beep, also at 2×.
     */
    public static readonly ProbeTapCooldownFrames: number = 2400;
```

```ts
        registerProcessor(
            'alphatab-probe-tap',
            class AlphaSynthProbeTapProcessor extends AudioWorkletProcessor {
                private _cooldown: number = 0;

                public override process(
                    inputs: Float32Array[][],
                    _outputs: Float32Array[][],
                    _parameters: Record<string, Float32Array>
                ): boolean {
                    const channel = inputs.length > 0 && inputs[0].length > 0 ? inputs[0][0] : undefined;
                    if (channel) {
                        for (let i = 0; i < channel.length; i++) {
                            if (this._cooldown > 0) {
                                this._cooldown--;
                                continue;
                            }
                            if (Math.abs(channel[i]) > AlphaSynthWebWorklet.ProbeTapThreshold) {
                                this.port.postMessage({ cmd: 'alphaSynth.probe.onset', frame: currentFrame + i });
                                this._cooldown = AlphaSynthWebWorklet.ProbeTapCooldownFrames;
                            }
                        }
                    }
                    // the outputs stay zero: the tap is connected so it is processed, and is never heard (G-7)
                    return true;
                }
            }
        );
```

- [ ] **Step 4: Implement the probe**

Create `packages/alphatab/src/platform/javascript/MediaLatencyProbe.ts`:

```ts
import type { IMediaLatencyProbe } from '@coderline/alphatab/platform/javascript/MediaSynthTypes';
import { PerSpeedValues } from '@coderline/alphatab/platform/javascript/PerSpeedValues';
import type { IAlphaSynthWorkerMessage } from '@coderline/alphatab/platform/worker/AlphaTabWorkerProtocol';

/**
 * @target web
 * @internal
 */
export class ProbeWav {
    public readonly bytes: Uint8Array;
    /** The beeps' positions in the WAV, s. */
    public readonly beepTimes: number[];

    public constructor(bytes: Uint8Array, beepTimes: number[]) {
        this.bytes = bytes;
        this.beepTimes = beepTimes;
    }
}

/**
 * The probe <audio>'s currentTime and the AudioContext's time, read together (both s).
 * @target web
 * @internal
 */
export class ProbePoll {
    public readonly mediaTime: number;
    public readonly contextTime: number;

    public constructor(mediaTime: number, contextTime: number) {
        this.mediaTime = mediaTime;
        this.contextTime = contextTime;
    }
}

/**
 * Measures how much earlier a time-stretched <audio> is heard than its currentTime says, per speed (spec §6.4).
 * @target web
 * @internal
 */
export class MediaLatencyProbe implements IMediaLatencyProbe {
    /**
     * Measured values, cached for the page session (one per speed).
     */
    public static readonly cache: PerSpeedValues = new PerSpeedValues();
    /**
     * Measured in the background after load; other speeds on first use.
     */
    public static readonly backgroundSpeeds: number[] = [1, 0.5, 0.75, 1.25, 1.5];
    public static readonly SampleRate: number = 48000;
    /** Spec §6.4: ~1 s with a beep every 125 ms (untested; the spike used 4 s / 250 ms, Task 22 compares). */
    public static readonly LengthS: number = 1;
    public static readonly SpacingS: number = 0.125;
    private static readonly _beepFrequency: number = 2000;
    private static readonly _beepS: number = 0.003;
    private static readonly _pollMs: number = 4;

    private readonly _context: AudioContext;
    private readonly _loadWorkletModule: () => Promise<void>;
    private readonly _lengthS: number;
    private readonly _spacingS: number;
    private _wav: ProbeWav | null = null;
    private _url: string = '';

    /**
     * @param loadWorkletModule Loads alphaTab's worklet module (which registers the probe's tap) into the context.
     * @param lengthS The probe's length; the sync lab passes the spike's 4 s to compare (Task 22).
     * @param spacingS The beeps' spacing; the sync lab passes the spike's 0.25 s to compare.
     */
    public constructor(
        context: AudioContext,
        loadWorkletModule: () => Promise<void>,
        lengthS: number = MediaLatencyProbe.LengthS,
        spacingS: number = MediaLatencyProbe.SpacingS
    ) {
        this._context = context;
        this._loadWorkletModule = loadWorkletModule;
        this._lengthS = lengthS;
        this._spacingS = spacingS;
    }

    public static createProbeWav(sampleRate: number, lengthS: number, spacingS: number): ProbeWav {
        const pcm = new Int16Array(Math.round(sampleRate * lengthS));
        const beepTimes: number[] = [];
        const beepFrames = Math.round(sampleRate * MediaLatencyProbe._beepS);
        for (let i = 1; i * spacingS < lengthS - 0.2; i++) {
            const time = i * spacingS;
            beepTimes.push(time);
            const start = Math.round(time * sampleRate);
            for (let k = 0; k < beepFrames; k++) {
                pcm[start + k] = Math.round(
                    Math.sin((2 * Math.PI * MediaLatencyProbe._beepFrequency * k) / sampleRate) * 0.6 * 32767
                );
            }
        }
        const buffer = new ArrayBuffer(44 + pcm.length * 2);
        const view = new DataView(buffer);
        const text = (offset: number, value: string) => {
            for (let i = 0; i < value.length; i++) {
                view.setUint8(offset + i, value.charCodeAt(i));
            }
        };
        text(0, 'RIFF');
        view.setUint32(4, 36 + pcm.length * 2, true);
        text(8, 'WAVE');
        text(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        text(36, 'data');
        view.setUint32(40, pcm.length * 2, true);
        new Int16Array(buffer, 44).set(pcm);
        return new ProbeWav(new Uint8Array(buffer), beepTimes);
    }

    /**
     * The median of (currentTime reaching a beep − the beep being heard), real ms. The first beep carries the
     * start transient and is skipped. No onsets: 0.
     */
    public static latencyFromOnsets(onsets: number[], polls: ProbePoll[], beepTimes: number[], speed: number): number {
        const offsets: number[] = [];
        for (const onset of onsets) {
            for (let i = 1; i < polls.length; i++) {
                const a = polls[i - 1];
                const b = polls[i];
                if (a.contextTime <= onset && b.contextTime > onset) {
                    const mediaAt =
                        a.mediaTime +
                        ((onset - a.contextTime) / (b.contextTime - a.contextTime)) * (b.mediaTime - a.mediaTime);
                    let beep = beepTimes[0];
                    for (const time of beepTimes) {
                        if (Math.abs(time - mediaAt) < Math.abs(beep - mediaAt)) {
                            beep = time;
                        }
                    }
                    offsets.push(((beep - mediaAt) / speed) * 1000);
                    break;
                }
            }
        }
        offsets.shift();
        if (offsets.length === 0) {
            return 0;
        }
        offsets.sort((x, y) => x - y);
        return offsets[Math.floor(offsets.length / 2)];
    }

    public async measure(speed: number): Promise<number> {
        const context = this._context;
        await this._loadWorkletModule();
        if (!this._wav) {
            this._wav = MediaLatencyProbe.createProbeWav(MediaLatencyProbe.SampleRate, this._lengthS, this._spacingS);
            this._url = URL.createObjectURL(new Blob([this._wav.bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }));
        }
        const wav = this._wav;
        const element = new Audio(this._url);
        element.preload = 'auto';
        element.playbackRate = speed;
        await new Promise<void>(resolve => element.addEventListener('canplaythrough', () => resolve(), { once: true }));

        const source = context.createMediaElementSource(element);
        const tap = new AudioWorkletNode(context, 'alphatab-probe-tap');
        const onsets: number[] = [];
        tap.port.onmessage = (e: MessageEvent<IAlphaSynthWorkerMessage>) => {
            if (e.data.cmd === 'alphaSynth.probe.onset') {
                onsets.push(e.data.frame / context.sampleRate);
            }
        };
        source.connect(tap);
        // connected so it is processed; it outputs silence (G-7)
        tap.connect(context.destination);

        const polls: ProbePoll[] = [];
        const lastBeep = wav.beepTimes[wav.beepTimes.length - 1];
        try {
            await element.play();
            while (element.currentTime < lastBeep + 0.1 && !element.ended) {
                polls.push(new ProbePoll(element.currentTime, context.currentTime));
                await new Promise(resolve => setTimeout(resolve, MediaLatencyProbe._pollMs));
            }
        } finally {
            element.pause();
            source.disconnect();
            tap.disconnect();
        }
        return MediaLatencyProbe.latencyFromOnsets(onsets, polls, wav.beepTimes, speed);
    }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaLatencyProbe.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Fix the §13 wording (G-7)**

In the spec's §13 table, row "Hidden probe playback in the background", replace "Silent (never connected to the
destination)" with "Silent (its tap outputs silence; it is connected so that it is processed)".

- [ ] **Step 7: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform packages/alphatab/test/audio/MediaLatencyProbe.test.ts docs/superpowers/specs/2026-10-07-synth-with-media-design.md
git commit -m "feat(web): media latency probe with a tap in alphaTab's own worklet (#2397)"
git push
```

---

## Phase 4 — The combined player

### Task 13: Volumes on `IAlphaSynth` — `backingTrackVolume`, `synthVolume` (FYI-3 / D-6)

**Files:**
- Modify: `packages/alphatab/src/synth/IAlphaSynth.ts`
- Modify: `packages/alphatab/src/synth/AlphaSynth.ts` (`AlphaSynthBase`)
- Modify: `packages/alphatab/src/synth/BackingTrackPlayer.ts`
- Modify: `packages/alphatab/src/synth/ExternalMediaPlayer.ts`
- Modify: `packages/alphatab/src/synth/AlphaSynthWrapper.ts`
- Modify: `packages/alphatab/src/platform/worker/AlphaSynthWebWorkerApi.ts`
- Modify: `packages/alphatab/src/AlphaTabApiBase.ts`
- Create: `packages/alphatab/test/audio/TestMediaOutput.ts`
- Create: `packages/alphatab/test/audio/MediaVolumes.test.ts`

**Interfaces:**
- Produces (used by Tasks 15, 19, 20): `IAlphaSynth.backingTrackVolume: number`, `IAlphaSynth.synthVolume: number`;
  `AlphaTabApiBase.backingTrackVolume`, `AlphaTabApiBase.synthVolume`; protected `BackingTrackPlayer.applyMediaVolume()`;
  test helpers `TestMediaOutput` (a backing-track output with `currentTime`, `isPlaying`, `seekTimes`, `advance(ms)`)
  and `TestMediaHandler` (an external-media handler that records `seekTimes`, `plays`, `pauses`).

§7: `backingTrackVolume` scales the backing track's own level (`masterVolume` still scales both). It works without
mixing too: `BackingTrackPlayer` applies `masterVolume × backingTrackVolume` to its `<audio>`. `ExternalMediaPlayer`
ignores it, and its handler keeps getting `masterVolume` alone. Otherwise an app that writes its player's volume
back into `masterVolume` drives both toward 0 (spike 9 §3: 239 `volumechange` events, master ~1e-110). Adding
members to `IAlphaSynth` is a minor break for third-party implementations (§7).

- [ ] **Step 0: STOP — decision gate D-6 (FYI-3): does `synthVolume` stay public?**

Settle this before any code, ideally during the plan review. Put it to the person as `[Q-D6]`:

- **Scenario:** in notation-hero you want the metronome louder than the recording, so you call one of the levels.
- **Option 1 — keep `synthVolume` public (as §7 says; implemented default).** Apps raise the synth directly.
  The limiter (Task 14) keeps raised levels from clipping. Cost: one more public member to document, for both apps.
  Confidence High; nothing to spike (an API shape).
- **Option 2 — drop it.** Apps lower `backingTrackVolume` and raise `masterVolume`, which gives the same mix:
  `synth = master`, `media = master × backingTrackVolume`. Cost: two calls for one intent, and `masterVolume` above 1
  leans on the limiter. Confidence High; nothing to spike.

If the answer is Option 2, leave out every `synthVolume` line in this task and in Tasks 15 and 20, and edit spec §2
("Public additions") and §7 in the same commit.

- [ ] **Step 1: Write the test helpers**

Create `packages/alphatab/test/audio/TestMediaOutput.ts`:

```ts
import {
    EventEmitter,
    EventEmitterOfT,
    type IEventEmitter,
    type IEventEmitterOfT
} from '@coderline/alphatab/EventEmitter';
import type { BackingTrack } from '@coderline/alphatab/model/BackingTrack';
import type { IBackingTrackSynthOutput } from '@coderline/alphatab/synth/BackingTrackPlayer';
import type { IExternalMediaHandler } from '@coderline/alphatab/synth/ExternalMediaPlayer';
import type { ISynthOutputDevice } from '@coderline/alphatab/synth/ISynthOutput';

/**
 * A backing-track output whose media moves only when the test advances it.
 * @internal
 */
export class TestMediaOutput implements IBackingTrackSynthOutput {
    /**
     * The media's position, ms.
     */
    public currentTime: number = 0;
    public isPlaying: boolean = false;
    public readonly seekTimes: number[] = [];
    public backingTrackDuration: number = 42000;
    public playbackRate: number = 1;
    public masterVolume: number = 1;
    public readonly sampleRate: number = 44100;

    public seekTo(time: number): void {
        this.seekTimes.push(time);
        this.currentTime = time;
    }

    public loadBackingTrack(_backingTrack: BackingTrack): void {}

    public open(_bufferTimeInMilliseconds: number): void {
        (this.ready as EventEmitter).trigger();
    }

    public play(): void {
        this.isPlaying = true;
    }

    public pause(): void {
        this.isPlaying = false;
    }

    public destroy(): void {}
    public addSamples(_samples: Float32Array): void {}
    public resetSamples(): void {}
    public activate(): void {}

    /**
     * The media moves forward and reports its position, as the <audio> does every 50 ms.
     */
    public advance(ms: number): void {
        if (this.isPlaying) {
            this.currentTime += ms * this.playbackRate;
            (this.timeUpdate as EventEmitterOfT<number>).trigger(this.currentTime);
        }
    }

    public readonly timeUpdate: IEventEmitterOfT<number> = new EventEmitterOfT<number>();
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

/**
 * An external-media handler that records what alphaTab asks of it.
 * @internal
 */
export class TestMediaHandler implements IExternalMediaHandler {
    public backingTrackDuration: number = 42000;
    public playbackRate: number = 1;
    public masterVolume: number = 1;
    public readonly seekTimes: number[] = [];
    public plays: number = 0;
    public pauses: number = 0;

    public seekTo(time: number): void {
        this.seekTimes.push(time);
    }

    public play(): void {
        this.plays++;
    }

    public pause(): void {
        this.pauses++;
    }
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/alphatab/test/audio/MediaVolumes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AlphaSynth } from '@coderline/alphatab/synth/AlphaSynth';
import { AlphaSynthWrapper } from '@coderline/alphatab/synth/AlphaSynthWrapper';
import { BackingTrackPlayer } from '@coderline/alphatab/synth/BackingTrackPlayer';
import { ExternalMediaPlayer, type IExternalMediaSynthOutput } from '@coderline/alphatab/synth/ExternalMediaPlayer';
import { TestMediaHandler, TestMediaOutput } from 'test/audio/TestMediaOutput';
import { TestOutput } from 'test/audio/TestOutput';

describe('MediaVolumesTests', () => {
    it('backing-track-player-applies-master-times-backing-track-volume', () => {
        const output = new TestMediaOutput();
        const player = new BackingTrackPlayer(output, 500);
        player.masterVolume = 0.8;
        player.backingTrackVolume = 0.35;
        expect(output.masterVolume).toBeCloseTo(0.28, 9);
        player.masterVolume = 1;
        expect(output.masterVolume).toBeCloseTo(0.35, 9);
    });

    it('external-media-handler-keeps-master-volume-alone', () => {
        // §7, spike 9 §3
        const player = new ExternalMediaPlayer(500);
        const handler = new TestMediaHandler();
        (player.output as IExternalMediaSynthOutput).handler = handler;
        player.masterVolume = 0.8;
        player.backingTrackVolume = 0.35;
        expect(handler.masterVolume).toBeCloseTo(0.8, 9);
    });

    it('a-synthesizer-alone-keeps-both-and-ignores-them', () => {
        const synth = new AlphaSynth(new TestOutput(), 500);
        synth.masterVolume = 0.5;
        synth.backingTrackVolume = 0.35;
        synth.synthVolume = 2;
        expect(synth.masterVolume).toBeCloseTo(0.5, 9);
        expect(synth.backingTrackVolume).toBeCloseTo(0.35, 9);
        expect(synth.synthVolume).toBe(2);
    });

    it('volumes-are-clamped-at-0', () => {
        const player = new BackingTrackPlayer(new TestMediaOutput(), 500);
        player.backingTrackVolume = -1;
        player.synthVolume = -1;
        expect(player.backingTrackVolume).toBe(0);
        expect(player.synthVolume).toBe(0);
    });

    it('wrapper-remembers-the-media-volumes-across-player-switches', () => {
        const wrapper = new AlphaSynthWrapper();
        wrapper.backingTrackVolume = 0.4;
        wrapper.synthVolume = 1.5;
        const output = new TestMediaOutput();
        const player = new BackingTrackPlayer(output, 500);
        wrapper.instance = player;
        expect(player.backingTrackVolume).toBeCloseTo(0.4, 9);
        expect(player.synthVolume).toBeCloseTo(1.5, 9);
        expect(output.masterVolume).toBeCloseTo(0.4, 9);
        wrapper.backingTrackVolume = 0.2;
        expect(output.masterVolume).toBeCloseTo(0.2, 9);
    });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaVolumes.test.ts`
Expected: FAIL — `backingTrackVolume` doesn't exist.

- [ ] **Step 4: Implement**

`IAlphaSynth.ts`, after `masterVolume`:

```ts
    /**
     * Gets or sets the backing track's own level against the synthesizer (range: 0.0-3.0, default 1.0).
     * {@link masterVolume} still scales both. Not applied to external media: set your own player's volume.
     * @since 1.9.0
     */
    backingTrackVolume: number;

    /**
     * Gets or sets the synthesizer's level against the media while it plays along a backing track or external
     * media (range: 0.0-3.0, default 1.0). Ignored otherwise: {@link masterVolume} already scales a lone synthesizer.
     * @since 1.9.0
     */
    synthVolume: number;
```

`AlphaSynthBase` (after `countInVolume`):

```ts
    private _backingTrackVolume: number = 1;
    private _synthVolume: number = 1;

    public get backingTrackVolume(): number {
        return this._backingTrackVolume;
    }

    public set backingTrackVolume(value: number) {
        value = Math.max(value, SynthConstants.MinVolume);
        this._backingTrackVolume = value;
        this.updateBackingTrackVolume(value);
    }

    /**
     * A synthesizer alone has no backing track.
     */
    protected updateBackingTrackVolume(_value: number): void {}

    public get synthVolume(): number {
        return this._synthVolume;
    }

    public set synthVolume(value: number) {
        // a synthesizer alone ignores it: masterVolume already scales it
        this._synthVolume = Math.max(value, SynthConstants.MinVolume);
    }
```

`BackingTrackPlayer.ts`:

```diff
     protected override updateMasterVolume(value: number): void {
         super.updateMasterVolume(value);
-        this._backingTrackOutput.masterVolume = value;
+        this.applyMediaVolume();
+    }
+
+    protected override updateBackingTrackVolume(_value: number): void {
+        this.applyMediaVolume();
+    }
+
+    /**
+     * The media's own volume: masterVolume × backingTrackVolume (§7), so it also works without mixing.
+     */
+    protected applyMediaVolume(): void {
+        this._backingTrackOutput.masterVolume = this.masterVolume * this.backingTrackVolume;
     }
```

`ExternalMediaPlayer.ts`, in the class:

```ts
    /**
     * The handler keeps getting masterVolume alone: an app that writes its player's volume back into
     * masterVolume (alphaTab's external-media sample does, on volumechange) would otherwise drive it toward 0
     * (§7, spike 9 §3).
     */
    protected override applyMediaVolume(): void {
        (this.output as IBackingTrackSynthOutput).masterVolume = this.masterVolume;
    }
```

`AlphaSynthWebWorkerApi.ts`:

```ts
    private _backingTrackVolume: number = 1;
    private _synthVolume: number = 1;

    // a synthesizer alone ignores both: it has no backing track, and masterVolume already scales it
    public get backingTrackVolume(): number {
        return this._backingTrackVolume;
    }

    public set backingTrackVolume(value: number) {
        this._backingTrackVolume = Math.max(value, SynthConstants.MinVolume);
    }

    public get synthVolume(): number {
        return this._synthVolume;
    }

    public set synthVolume(value: number) {
        this._synthVolume = Math.max(value, SynthConstants.MinVolume);
    }
```

`AlphaSynthWrapper.ts` — remember, forward and restore like `masterVolume`:

```diff
     private _masterVolume: number = 1;
+    private _backingTrackVolume: number = 1;
+    private _synthVolume: number = 1;
@@ (both "restore state on new player" blocks)
                 value.masterVolume = this._masterVolume;
+                value.backingTrackVolume = this._backingTrackVolume;
+                value.synthVolume = this._synthVolume;
```

```ts
    public get backingTrackVolume(): number {
        return this._backingTrackVolume;
    }

    public set backingTrackVolume(value: number) {
        value = Math.max(value, SynthConstants.MinVolume);
        this._backingTrackVolume = value;
        if (this._instance) {
            this._instance.backingTrackVolume = value;
        }
    }

    public get synthVolume(): number {
        return this._synthVolume;
    }

    public set synthVolume(value: number) {
        value = Math.max(value, SynthConstants.MinVolume);
        this._synthVolume = value;
        if (this._instance) {
            this._instance.synthVolume = value;
        }
    }
```

`AlphaTabApiBase.ts`, after `masterVolume`:

```ts
    /**
     * The backing track's own level against the synthesizer, as percentage (0-3).
     * @remarks
     * With {@link PlayerSettings.enableSynthesizerWithMedia} the synthesizer plays along a backing track. At the
     * default levels the metronome sits about 8 dB under a mastered recording: lower this to bring the metronome or
     * the synthesized tracks forward (0.35 is about −9 dB). {@link masterVolume} still scales both. Without mixing
     * it scales the backing track alone. Not applied to external media: set your own player's volume there.
     * @category Properties - Player
     * @since 1.9.0
     * @defaultValue `1`
     * @example
     * JavaScript
     * ```js
     * const api = new alphaTab.AlphaTabApi(document.querySelector('#alphaTab'));
     * api.backingTrackVolume = 0.35;
     * ```
     *
     * @example
     * C#
     * ```cs
     * var api = new AlphaTabApi<MyControl>(...);
     * api.BackingTrackVolume = 0.35;
     * ```
     *
     * @example
     * Android
     * ```kotlin
     * val api = AlphaTabApi<MyControl>(...)
     * api.backingTrackVolume = 0.35
     * ```
     */
    public get backingTrackVolume(): number {
        return this._player.backingTrackVolume;
    }

    public set backingTrackVolume(value: number) {
        this._player.backingTrackVolume = value;
    }

    /**
     * The synthesizer's level against the media, as percentage (0-3).
     * @remarks
     * With {@link PlayerSettings.enableSynthesizerWithMedia} the synthesizer plays along a backing track or external
     * media. Raise this to bring the metronome or the synthesized tracks forward; the output limiter keeps raised
     * levels from clipping. Ignored without mixing: {@link masterVolume} already scales a lone synthesizer.
     * @category Properties - Player
     * @since 1.9.0
     * @defaultValue `1`
     * @example
     * JavaScript
     * ```js
     * const api = new alphaTab.AlphaTabApi(document.querySelector('#alphaTab'));
     * api.synthVolume = 2;
     * ```
     *
     * @example
     * C#
     * ```cs
     * var api = new AlphaTabApi<MyControl>(...);
     * api.SynthVolume = 2;
     * ```
     *
     * @example
     * Android
     * ```kotlin
     * val api = AlphaTabApi<MyControl>(...)
     * api.synthVolume = 2
     * ```
     */
    public get synthVolume(): number {
        return this._player.synthVolume;
    }

    public set synthVolume(value: number) {
        this._player.synthVolume = value;
    }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaVolumes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src packages/alphatab/test/audio/TestMediaOutput.ts packages/alphatab/test/audio/MediaVolumes.test.ts
git commit -m "feat(api): backingTrackVolume and synthVolume (#2397)"
git push
```

---

### Task 14: `WebAudioMixGraph` — gains, limiter and trim (F-13)

**Files:**
- Create: `packages/alphatab/src/platform/javascript/WebAudioMixGraph.ts`
- Create: `packages/alphatab/test/audio/WebAudioMixGraph.test.ts`

**Interfaces:**
- Consumes: `IMediaMixGraph` (Task 5), `IExternalClockSource` (Task 11).
- Produces (used by Task 20): `WebAudioMixGraph implements IMediaMixGraph, IExternalClockSource` with
  `constructor(context)`, `connectMediaElement(element)`, `synthInput: AudioNode`, the gains, `heardContextTime()`,
  `whenRunning(action)`, and the limiter values as statics.

§3: `<audio> → mediaGain ┐ ├→ masterGain → limiter → destination; worklet → synthGain ┘`, mixing mode only.
**F-13** (both; our design's problem; spiked in spike 8; High): a limiter at −1 dBFS, ratio 20, knee 0, attack 1 ms,
release 100 ms, followed by a fixed −0.57 dB trim that cancels Web Audio's automatic make-up gain. Spike 8: the worst
case peaked at −0.31 dBFS with `synthVolume` 3, and the recording keeps its own level. The spec's −3 dBFS would
squash a mastered recording's own peaks (spike 5: −2.3 dBFS).

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/WebAudioMixGraph.test.ts`:

```ts
/**
 * The mixing graph's wiring and the limiter's values (F-13); the sound itself is checked with spike 8's script.
 * @target web
 */
import { describe, expect, it } from 'vitest';
import { WebAudioMixGraph } from '@coderline/alphatab/platform/javascript/WebAudioMixGraph';

class FakeParam {
    public value: number = 0;
}

class FakeNode {
    public readonly name: string;
    public readonly connections: FakeNode[] = [];
    public constructor(name: string) {
        this.name = name;
    }
    public connect(node: FakeNode): FakeNode {
        this.connections.push(node);
        return node;
    }
    public disconnect(): void {
        this.connections.length = 0;
    }
}

class FakeGain extends FakeNode {
    public readonly gain: FakeParam = new FakeParam();
    public constructor() {
        super('gain');
        this.gain.value = 1;
    }
}

class FakeCompressor extends FakeNode {
    public readonly threshold: FakeParam = new FakeParam();
    public readonly ratio: FakeParam = new FakeParam();
    public readonly knee: FakeParam = new FakeParam();
    public readonly attack: FakeParam = new FakeParam();
    public readonly release: FakeParam = new FakeParam();
    public constructor() {
        super('compressor');
    }
}

class FakeContext {
    public readonly destination: FakeNode = new FakeNode('destination');
    public sampleRate: number = 48000;
    public currentTime: number = 2;
    public baseLatency: number = 0.0053;
    public outputLatency: number = 0.02;
    public state: string = 'running';
    public mediaSources: number = 0;
    public outputTimestamp: { contextTime: number; performanceTime: number } | undefined = undefined;
    private _listeners: (() => void)[] = [];
    public createGain(): FakeGain {
        return new FakeGain();
    }
    public createDynamicsCompressor(): FakeCompressor {
        return new FakeCompressor();
    }
    public createMediaElementSource(_element: unknown): FakeNode {
        this.mediaSources++;
        return new FakeNode('media');
    }
    public getOutputTimestamp(): { contextTime?: number; performanceTime?: number } {
        return this.outputTimestamp ?? {};
    }
    public addEventListener(_type: string, listener: () => void): void {
        this._listeners.push(listener);
    }
    public removeEventListener(_type: string, listener: () => void): void {
        this._listeners = this._listeners.filter(l => l !== listener);
    }
    public setState(state: string): void {
        this.state = state;
        for (const listener of [...this._listeners]) {
            listener();
        }
    }
}

function create(): { context: FakeContext; graph: WebAudioMixGraph } {
    const context = new FakeContext();
    return { context, graph: new WebAudioMixGraph(context as unknown as AudioContext) };
}

describe('WebAudioMixGraphTests', () => {
    it('limiter-holds-the-spike-8-values', () => {
        const { graph } = create();
        const limiter = graph.limiterNode as unknown as FakeCompressor;
        expect(limiter.threshold.value).toBe(-1);
        expect(limiter.ratio.value).toBe(20);
        expect(limiter.knee.value).toBe(0);
        expect(limiter.attack.value).toBe(0.001);
        expect(limiter.release.value).toBe(0.1);
        expect((graph.trimNode as unknown as FakeGain).gain.value).toBeCloseTo(Math.pow(10, -0.57 / 20), 12);
    });

    it('wires-media-and-synth-through-master-limiter-and-trim', () => {
        const { context, graph } = create();
        const node = (n: unknown) => n as FakeNode;
        expect(node(graph.mediaGainNode).connections).toEqual([graph.masterGainNode]);
        expect(node(graph.synthGainNode).connections).toEqual([graph.masterGainNode]);
        expect(node(graph.masterGainNode).connections).toEqual([graph.limiterNode]);
        expect(node(graph.limiterNode).connections).toEqual([graph.trimNode]);
        expect(node(graph.trimNode).connections).toEqual([context.destination]);
        expect(graph.synthInput).toBe(graph.synthGainNode);
    });

    it('routes-a-media-element-once', () => {
        // createMediaElementSource works once per element (§13)
        const { context, graph } = create();
        const element = {} as HTMLMediaElement;
        graph.connectMediaElement(element);
        graph.connectMediaElement(element);
        expect(context.mediaSources).toBe(1);
        expect((graph.mediaSourceNode as unknown as FakeNode).connections).toEqual([graph.mediaGainNode]);
    });

    it('gains-and-context-values', () => {
        const { graph } = create();
        graph.masterGain = 0.8;
        graph.mediaGain = 0.35;
        graph.synthGain = 2;
        expect((graph.masterGainNode as unknown as FakeGain).gain.value).toBe(0.8);
        expect(graph.mediaGain).toBe(0.35);
        expect(graph.synthGain).toBe(2);
        expect(graph.baseLatencyMs).toBeCloseTo(5.3, 9);
        expect(graph.sampleRate).toBe(48000);
        expect(graph.currentTime).toBe(2);
    });

    it('heard-context-time-uses-the-output-timestamp-else-the-output-latency', () => {
        const { context, graph } = create();
        expect(graph.heardContextTime()).toBeCloseTo(2 - 0.02, 9);
        context.outputTimestamp = { contextTime: 1.9, performanceTime: performance.now() };
        expect(graph.heardContextTime()).toBeCloseTo(1.9, 1);
    });

    it('when-running-waits-for-the-context', () => {
        const { context, graph } = create();
        context.state = 'suspended';
        let ran = 0;
        graph.whenRunning(() => ran++);
        expect(graph.isRunning).toBe(false);
        expect(ran).toBe(0);
        context.setState('running');
        expect(ran).toBe(1);
        graph.whenRunning(() => ran++);
        expect(ran).toBe(2);
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/WebAudioMixGraph.test.ts`
Expected: FAIL — cannot resolve `WebAudioMixGraph`.

- [ ] **Step 3: Implement**

Create `packages/alphatab/src/platform/javascript/WebAudioMixGraph.ts`:

```ts
import type { IExternalClockSource } from '@coderline/alphatab/platform/javascript/MediaClock';
import type { IMediaMixGraph } from '@coderline/alphatab/platform/javascript/MediaSynthTypes';

/**
 * The backing track (or external media) and the synthesizer in one AudioContext (spec §3):
 * media → mediaGain and synth → synthGain, both into masterGain → limiter → trim → destination.
 * @target web
 * @internal
 */
export class WebAudioMixGraph implements IMediaMixGraph, IExternalClockSource {
    // F-13, spike 8: the sum of a mastered recording and the synthesizer stays under 0 dBFS
    public static readonly LimiterThresholdDb: number = -1;
    public static readonly LimiterRatio: number = 20;
    public static readonly LimiterKneeDb: number = 0;
    public static readonly LimiterAttackS: number = 0.001;
    public static readonly LimiterReleaseS: number = 0.1;
    /**
     * Cancels the compressor's automatic make-up gain (spike 8).
     */
    public static readonly TrimDb: number = -0.57;

    public readonly context: AudioContext;
    public readonly mediaGainNode: GainNode;
    public readonly synthGainNode: GainNode;
    public readonly masterGainNode: GainNode;
    public readonly limiterNode: DynamicsCompressorNode;
    public readonly trimNode: GainNode;
    private _mediaSource: MediaElementAudioSourceNode | null = null;

    public constructor(context: AudioContext) {
        this.context = context;
        this.mediaGainNode = context.createGain();
        this.synthGainNode = context.createGain();
        this.masterGainNode = context.createGain();
        this.limiterNode = context.createDynamicsCompressor();
        this.limiterNode.threshold.value = WebAudioMixGraph.LimiterThresholdDb;
        this.limiterNode.ratio.value = WebAudioMixGraph.LimiterRatio;
        this.limiterNode.knee.value = WebAudioMixGraph.LimiterKneeDb;
        this.limiterNode.attack.value = WebAudioMixGraph.LimiterAttackS;
        this.limiterNode.release.value = WebAudioMixGraph.LimiterReleaseS;
        this.trimNode = context.createGain();
        this.trimNode.gain.value = Math.pow(10, WebAudioMixGraph.TrimDb / 20);

        this.mediaGainNode.connect(this.masterGainNode);
        this.synthGainNode.connect(this.masterGainNode);
        this.masterGainNode.connect(this.limiterNode);
        this.limiterNode.connect(this.trimNode);
        this.trimNode.connect(context.destination);
    }

    /**
     * Routes an <audio> into the mix. createMediaElementSource works once per element (§13).
     */
    public connectMediaElement(element: HTMLMediaElement): void {
        if (!this._mediaSource) {
            this._mediaSource = this.context.createMediaElementSource(element);
            this._mediaSource.connect(this.mediaGainNode);
        }
    }

    /**
     * Where the synthesizer's worklet connects.
     */
    public get synthInput(): AudioNode {
        return this.synthGainNode;
    }

    public get mediaSourceNode(): AudioNode | null {
        return this._mediaSource;
    }

    public get masterGain(): number {
        return this.masterGainNode.gain.value;
    }

    public set masterGain(value: number) {
        this.masterGainNode.gain.value = value;
    }

    public get mediaGain(): number {
        return this.mediaGainNode.gain.value;
    }

    public set mediaGain(value: number) {
        this.mediaGainNode.gain.value = value;
    }

    public get synthGain(): number {
        return this.synthGainNode.gain.value;
    }

    public set synthGain(value: number) {
        this.synthGainNode.gain.value = value;
    }

    public get currentTime(): number {
        return this.context.currentTime;
    }

    public get sampleRate(): number {
        return this.context.sampleRate;
    }

    public get baseLatencyMs(): number {
        return (this.context.baseLatency ?? 0) * 1000;
    }

    public get isRunning(): boolean {
        return this.context.state === 'running';
    }

    public whenRunning(action: () => void): void {
        if (this.isRunning) {
            action();
            return;
        }
        const listener = () => {
            if (this.isRunning) {
                this.context.removeEventListener('statechange', listener);
                action();
            }
        };
        this.context.addEventListener('statechange', listener);
    }

    /**
     * The context time (s) of the audio being heard now (gap G-6).
     */
    public heardContextTime(): number {
        const timestamp = this.context.getOutputTimestamp?.();
        if (timestamp && timestamp.contextTime !== undefined && timestamp.performanceTime !== undefined) {
            return timestamp.contextTime + (performance.now() - timestamp.performanceTime) / 1000;
        }
        return this.context.currentTime - (this.context.outputLatency ?? 0);
    }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/audio/WebAudioMixGraph.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform/javascript/WebAudioMixGraph.ts packages/alphatab/test/audio/WebAudioMixGraph.test.ts
git commit -m "feat(web): mixing graph with an output limiter and trim (#2397, F-13)"
git push
```

---

### Task 15: `MediaSynthPlayer` — routing, readiness, media-only fallback, volumes, output, probe schedule

**Files:**
- Create: `packages/alphatab/src/platform/javascript/MediaSynthOutput.ts`
- Create: `packages/alphatab/src/platform/javascript/MediaSynthPlayer.ts`
- Modify: `packages/alphatab/src/synth/BackingTrackPlayer.ts` (internal `seekMediaTo`, `tickToMediaTime`,
  `mediaTimeOfPosition`)
- Modify: `packages/alphatab/src/platform/javascript/AlphaTabApi.ts` (a failed SoundFont download is raised on the
  player instance)
- Create: `packages/alphatab/test/audio/MediaSyncFakes.ts`
- Create: `packages/alphatab/test/audio/MediaSynthPlayer.Routing.test.ts`

**Interfaces:**
- Consumes: `IMediaSynth`, `IMediaFollowingOutput`, `IMediaMixGraph`, `IMediaTimer`, `IMediaLatencyProbe` (Task 5);
  `MediaSyncController` (Tasks 9, 10); `IMediaClock`, `ExternalMediaClock` (Task 11); `MediaLatencyProbe`
  (Task 12); `PerSpeedValues` (Task 8); the volumes (Task 13); `mainTickToMediaTime` (Task 2).
- Produces (used by Tasks 16–21): `MediaSynthPlayerParts`, `MediaSynthPlayer` (with `controller` and
  `diagnostics`), `MediaSynthDiagnostics`, `MediaSynthCountInRecord`, `MediaSynthProbeRecord`, `MediaSynthOutput`;
  on `BackingTrackPlayer` (internal): `seekMediaTo(mediaTime)`, `tickToMediaTime(tick)`, `mediaTimeOfPosition`;
  test helpers `MediaSynthHarness`, `FakeMediaTimer`, `FakeMixGraph`, `FakeMediaSynth`, `FakeFollowingOutput`,
  `FakeBackingClock`, `FakeProbe`, `flush()`.

This task builds the combined `IAlphaSynth` (§6.1) without the handshakes. Here `play()` starts the media alone;
Task 16 adds the synthesizer's start, seek and speed handshakes, Task 17 the count-in, Task 18 the loop wrap,
Task 19 external media. What this task settles:

- **Routing (§6.1):** positions, `finished` and MIDI info come from the media; `midiEventsPlayed` and the
  SoundFont events from the synth. `state` and `stateChanged` belong to the combined player itself: the inner
  players' state changes never reach the app (spike 9 §2).
- **Readiness and the media-only fallback (§6.1, F-8, FYI-4):** without a SoundFont, readiness follows the media
  alone, and the warning says why. The same happens when the worker fails, the worklet fails, or the SoundFont
  fails (including a failed download, now raised on the instance: spike 10 §3). A SoundFont loaded later
  (`api.loadSoundFont()`) ends the fallback: warm-up and probe, and the synth joins from the next Play.
- **Volumes (§6.1):** backing track — `masterGain` (both), `mediaGain` = `backingTrackVolume`,
  `synthGain` = `synthVolume`, while the `<audio>` itself stays at 1. External — the handler gets `masterVolume`
  alone, and `masterGain` scales the synth.
- **`output` (§6.1):** the media output's members pass through (`audioElement`, `handler`, `updatePosition`,
  `timeUpdate`); the device methods come from the synth output, because the media now plays through its
  AudioContext.
- **Probe schedule (§6.4):** 1, 0.5, 0.75, 1.25, 1.5× in the background after ready, one at a time, waiting for a
  running AudioContext. A speed without a value goes to the front. A failure gives 0, cached per session.

- [ ] **Step 1: BackingTrackPlayer helpers**

Add to `BackingTrackPlayer` (all `@internal`):

```ts
    /**
     * Seeks to a time on the media's own axis (the combined player's handshakes).
     * @internal
     */
    public seekMediaTo(mediaTime: number): void {
        this.timePosition = this.sequencer.mainTimePositionFromBackingTrack(
            mediaTime,
            this._backingTrackOutput.backingTrackDuration
        );
    }

    /**
     * The media time at which the main song reaches `tick` (the spec §4 mapping; without sync points the media
     * time is the song time).
     * @internal
     */
    public tickToMediaTime(tick: number): number {
        return this.sequencer.mainTickToMediaTime(tick, this._backingTrackOutput.backingTrackDuration);
    }

    /**
     * The media time this player seeks the media to for its current position.
     * @internal
     */
    public get mediaTimeOfPosition(): number {
        return this.sequencer.mainTimePositionToBackingTrack(
            this.timePosition,
            this._backingTrackOutput.backingTrackDuration
        );
    }
```

- [ ] **Step 2: Raise a failed SoundFont download on the player instance (F-8)**

In `AlphaTabApi.loadSoundFontFromUrl` (`packages/alphatab/src/platform/javascript/AlphaTabApi.ts`):

```diff
         request.onerror = e => {
             Logger.error('AlphaSynth', `Loading failed: ${(e as any).message}`);
-            (player.soundFontLoadFailed as EventEmitterOfT<Error>).trigger(
+            // raised on the instance so a combined player can fall back to the media alone (spike 10 §3);
+            // the wrapper forwards it to the app as before
+            const instance = (player as AlphaSynthWrapper).instance ?? player;
+            (instance.soundFontLoadFailed as EventEmitterOfT<Error>).trigger(
                 new FileLoadError((e as any).message, request)
             );
         };
```

(import `type AlphaSynthWrapper` from `@coderline/alphatab/synth/AlphaSynthWrapper`.)

- [ ] **Step 3: The output passthrough**

Create `packages/alphatab/src/platform/javascript/MediaSynthOutput.ts`:

```ts
import type { IEventEmitter, IEventEmitterOfT } from '@coderline/alphatab/EventEmitter';
import type { BackingTrack } from '@coderline/alphatab/model/BackingTrack';
import type { IAudioElementBackingTrackSynthOutput } from '@coderline/alphatab/platform/javascript/AudioElementBackingTrackSynthOutput';
import type { IBackingTrackSynthOutput } from '@coderline/alphatab/synth/BackingTrackPlayer';
import type { IExternalMediaHandler, IExternalMediaSynthOutput } from '@coderline/alphatab/synth/ExternalMediaPlayer';
import type { ISynthOutput, ISynthOutputDevice } from '@coderline/alphatab/synth/ISynthOutput';

/**
 * MediaSynthPlayer.output (spec §6.1): the media output's members, so `output.audioElement` and an external-media
 * `handler` keep working, with the synthesizer output's device methods, because the media now plays through the
 * synthesizer's AudioContext. The transport members do nothing: each player drives its own output.
 * @target web
 * @internal
 */
export class MediaSynthOutput implements IExternalMediaSynthOutput {
    private readonly _media: IBackingTrackSynthOutput;
    private readonly _synth: ISynthOutput;

    public constructor(media: IBackingTrackSynthOutput, synth: ISynthOutput) {
        this._media = media;
        this._synth = synth;
    }

    /**
     * The backing track's <audio> (undefined for external media).
     */
    public get audioElement(): HTMLAudioElement | undefined {
        return (this._media as Partial<IAudioElementBackingTrackSynthOutput>).audioElement;
    }

    public get handler(): IExternalMediaHandler | undefined {
        return (this._media as Partial<IExternalMediaSynthOutput>).handler;
    }

    public set handler(value: IExternalMediaHandler | undefined) {
        if ('handler' in this._media) {
            (this._media as IExternalMediaSynthOutput).handler = value;
        }
    }

    public updatePosition(currentTime: number): void {
        (this._media as Partial<IExternalMediaSynthOutput>).updatePosition?.(currentTime);
    }

    public get timeUpdate(): IEventEmitterOfT<number> {
        return this._media.timeUpdate;
    }

    public get backingTrackDuration(): number {
        return this._media.backingTrackDuration;
    }

    public get playbackRate(): number {
        return this._media.playbackRate;
    }

    public set playbackRate(value: number) {
        this._media.playbackRate = value;
    }

    public get masterVolume(): number {
        return this._media.masterVolume;
    }

    public set masterVolume(value: number) {
        this._media.masterVolume = value;
    }

    public seekTo(time: number): void {
        this._media.seekTo(time);
    }

    public loadBackingTrack(backingTrack: BackingTrack): void {
        this._media.loadBackingTrack(backingTrack);
    }

    public get sampleRate(): number {
        return this._synth.sampleRate;
    }

    public get ready(): IEventEmitter {
        return this._media.ready;
    }

    public get samplesPlayed(): IEventEmitterOfT<number> {
        return this._synth.samplesPlayed;
    }

    public get sampleRequest(): IEventEmitter {
        return this._synth.sampleRequest;
    }

    public open(_bufferTimeInMilliseconds: number): void {}
    public play(): void {}
    public pause(): void {}
    public destroy(): void {}
    public addSamples(_samples: Float32Array): void {}
    public resetSamples(): void {}

    public activate(): void {
        // resumes the shared AudioContext (a user gesture)
        this._synth.activate();
    }

    public enumerateOutputDevices(): Promise<ISynthOutputDevice[]> {
        return this._synth.enumerateOutputDevices();
    }

    public setOutputDevice(device: ISynthOutputDevice | null): Promise<void> {
        return this._synth.setOutputDevice(device);
    }

    public getOutputDevice(): Promise<ISynthOutputDevice | null> {
        return this._synth.getOutputDevice();
    }
}
```

- [ ] **Step 4: Write the test fakes**

Create `packages/alphatab/test/audio/MediaSyncFakes.ts`:

```ts
/**
 * Fakes for the combined player's parts.
 * @target web
 */
import {
    EventEmitter,
    EventEmitterOfT,
    type IEventEmitter,
    type IEventEmitterOfT
} from '@coderline/alphatab/EventEmitter';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { LogLevel } from '@coderline/alphatab/LogLevel';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import type { MidiEventType } from '@coderline/alphatab/midi/MidiEvent';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import type { Score } from '@coderline/alphatab/model/Score';
import { ExternalMediaClock, type IExternalClockSource, type IMediaClock } from '@coderline/alphatab/platform/javascript/MediaClock';
import {
    MediaTimestampEventArgs,
    type IMediaFollowingOutput,
    type IMediaLatencyProbe,
    type IMediaMixGraph,
    type IMediaSynth,
    type IMediaTimer
} from '@coderline/alphatab/platform/javascript/MediaSynthTypes';
import { MediaSynthPlayer, MediaSynthPlayerParts } from '@coderline/alphatab/platform/javascript/MediaSynthPlayer';
import { PerSpeedValues } from '@coderline/alphatab/platform/javascript/PerSpeedValues';
import { Settings } from '@coderline/alphatab/Settings';
import { BackingTrackPlayer } from '@coderline/alphatab/synth/BackingTrackPlayer';
import { ExternalMediaPlayer, type IExternalMediaSynthOutput } from '@coderline/alphatab/synth/ExternalMediaPlayer';
import type { BackingTrackSyncPoint } from '@coderline/alphatab/synth/IAlphaSynth';
import type { ISynthOutput } from '@coderline/alphatab/synth/ISynthOutput';
import type { MediaSampleChunk } from '@coderline/alphatab/synth/MediaSampleOutput';
import type { MidiEventsPlayedEventArgs } from '@coderline/alphatab/synth/MidiEventsPlayedEventArgs';
import type { PlaybackRange } from '@coderline/alphatab/synth/PlaybackRange';
import type { PlaybackRangeChangedEventArgs } from '@coderline/alphatab/synth/PlaybackRangeChangedEventArgs';
import { PlayerState } from '@coderline/alphatab/synth/PlayerState';
import type { PlayerStateChangedEventArgs } from '@coderline/alphatab/synth/PlayerStateChangedEventArgs';
import { PositionChangedEventArgs } from '@coderline/alphatab/synth/PositionChangedEventArgs';
import { TestMediaHandler, TestMediaOutput } from 'test/audio/TestMediaOutput';
import { TestOutput } from 'test/audio/TestOutput';
import { TestPlatform } from 'test/TestPlatform';

export const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Fake time: timers run when the test advances it.
 */
export class FakeMediaTimer implements IMediaTimer {
    public time: number = 0;
    private _nextId: number = 1;
    private _timers: { id: number; at: number; action: () => void }[] = [];

    public now(): number {
        return this.time;
    }

    public setTimeout(action: () => void, ms: number): number {
        const id = this._nextId++;
        this._timers.push({ id, at: this.time + Math.max(0, ms), action });
        return id;
    }

    public clearTimeout(id: number): void {
        this._timers = this._timers.filter(t => t.id !== id);
    }

    public spinUntil(done: () => boolean, maxMs: number): void {
        const until = this.time + maxMs;
        while (!done() && this.time < until) {
            this.time += 0.1;
        }
    }

    /**
     * Moves time forward, running the timers that come due, in order.
     */
    public advance(ms: number): void {
        const end = this.time + ms;
        for (;;) {
            this._timers.sort((a, b) => a.at - b.at);
            const next = this._timers[0];
            if (!next || next.at > end) {
                break;
            }
            this._timers.shift();
            this.time = Math.max(this.time, next.at);
            next.action();
        }
        this.time = Math.max(this.time, end);
    }

    public get pending(): number {
        return this._timers.length;
    }
}

/**
 * A mixing graph whose clock is the fake timer (context time = timer ms / 1000).
 */
export class FakeMixGraph implements IMediaMixGraph {
    public masterGain: number = 1;
    public mediaGain: number = 1;
    public synthGain: number = 1;
    public sampleRate: number = 48000;
    public baseLatencyMs: number = 0;
    public running: boolean = true;
    public readonly context: AudioContext | null = null;
    public readonly mediaSourceNode: AudioNode | null = null;
    public readonly masterGainNode: GainNode | null = null;
    private readonly _timer: FakeMediaTimer;
    private _whenRunning: (() => void)[] = [];

    public constructor(timer: FakeMediaTimer) {
        this._timer = timer;
    }

    public get currentTime(): number {
        return this._timer.time / 1000;
    }

    public get isRunning(): boolean {
        return this.running;
    }

    public whenRunning(action: () => void): void {
        if (this.running) {
            action();
        } else {
            this._whenRunning.push(action);
        }
    }

    public start(): void {
        this.running = true;
        for (const action of this._whenRunning.splice(0)) {
            action();
        }
    }
}

/**
 * The worker synthesizer as the combined player drives it: records the calls.
 */
export class FakeMediaSynth implements IMediaSynth {
    public readonly calls: string[] = [];
    public readonly seeks: number[] = [];
    public readonly corrections: number[] = [];
    public readonly output: ISynthOutput = new TestOutput();
    public isReady: boolean = false;
    public isReadyForPlayback: boolean = false;
    public state: PlayerState = PlayerState.Paused;
    public logLevel: LogLevel = LogLevel.None;
    public masterVolume: number = 1;
    public metronomeVolume: number = 0;
    public playbackSpeed: number = 1;
    public tickPosition: number = 0;
    public timePosition: number = 0;
    public loadedMidiInfo?: PositionChangedEventArgs = undefined;
    public currentPosition: PositionChangedEventArgs = new PositionChangedEventArgs(0, 0, 0, 0, false, 120, 120);
    public playbackRange: PlaybackRange | null = null;
    public isLooping: boolean = false;
    public countInVolume: number = 0;
    public midiEventsPlayedFilter: MidiEventType[] = [];
    public backingTrackVolume: number = 1;
    public synthVolume: number = 1;

    public followMedia(enabled: boolean, _mediaDuration: number, _syncPoints: BackingTrackSyncPoint[]): void {
        this.calls.push(`followMedia:${enabled}`);
    }
    public seekToMediaTime(mediaTime: number): void {
        this.seeks.push(mediaTime);
        this.calls.push(`seek:${mediaTime}`);
    }
    public setRateCorrection(factor: number): void {
        this.corrections.push(factor);
    }
    public destroy(): void {
        this.calls.push('destroy');
    }
    public play(): boolean {
        this.calls.push(`play:countIn=${this.countInVolume}`);
        this.state = PlayerState.Playing;
        return true;
    }
    public pause(): void {
        this.calls.push('pause');
        this.state = PlayerState.Paused;
    }
    public playPause(): void {}
    public stop(): void {
        this.calls.push('stop');
        this.state = PlayerState.Paused;
    }
    public playOneTimeMidiFile(_midi: MidiFile): void {
        this.calls.push('playOneTimeMidiFile');
    }
    public loadSoundFont(_data: Uint8Array, _append: boolean): void {
        this.calls.push('loadSoundFont');
    }
    public resetSoundFonts(): void {}
    public loadMidiFile(_midi: MidiFile): void {
        this.calls.push('loadMidiFile');
    }
    public loadBackingTrack(_score: Score): void {}
    public updateSyncPoints(_syncPoints: BackingTrackSyncPoint[]): void {}
    public applyTranspositionPitches(_transpositionPitches: Map<number, number>): void {}
    public setChannelTranspositionPitch(_channel: number, _semitones: number): void {}
    public setChannelMute(_channel: number, _mute: boolean): void {}
    public resetChannelStates(): void {}
    public setChannelSolo(_channel: number, _solo: boolean): void {}
    public setChannelVolume(_channel: number, _volume: number): void {}

    public readonly ready: IEventEmitter = new EventEmitter();
    public readonly readyForPlayback: IEventEmitter = new EventEmitter();
    public readonly finished: IEventEmitter = new EventEmitter();
    public readonly soundFontLoaded: IEventEmitter = new EventEmitter();
    public readonly soundFontLoadFailed: IEventEmitterOfT<Error> = new EventEmitterOfT<Error>();
    public readonly midiLoaded: IEventEmitterOfT<PositionChangedEventArgs> = new EventEmitterOfT<PositionChangedEventArgs>();
    public readonly midiLoadFailed: IEventEmitterOfT<Error> = new EventEmitterOfT<Error>();
    public readonly stateChanged: IEventEmitterOfT<PlayerStateChangedEventArgs> =
        new EventEmitterOfT<PlayerStateChangedEventArgs>();
    public readonly positionChanged: IEventEmitterOfT<PositionChangedEventArgs> =
        new EventEmitterOfT<PositionChangedEventArgs>();
    public readonly midiEventsPlayed: IEventEmitterOfT<MidiEventsPlayedEventArgs> =
        new EventEmitterOfT<MidiEventsPlayedEventArgs>();
    public readonly playbackRangeChanged: IEventEmitterOfT<PlaybackRangeChangedEventArgs> =
        new EventEmitterOfT<PlaybackRangeChangedEventArgs>();
    public readonly countInStarted: IEventEmitterOfT<number> = new EventEmitterOfT<number>();
    public readonly workerFailed: IEventEmitterOfT<Error> = new EventEmitterOfT<Error>();

    public becomeReady(): void {
        this.isReady = true;
        (this.ready as EventEmitter).trigger();
    }
    public becomeReadyForPlayback(): void {
        this.isReadyForPlayback = true;
        (this.readyForPlayback as EventEmitter).trigger();
    }
    public startCountIn(lengthMs: number): void {
        (this.countInStarted as EventEmitterOfT<number>).trigger(lengthMs);
    }
    public fail(message: string): void {
        (this.workerFailed as EventEmitterOfT<Error>).trigger(new Error(message));
    }
    public count(prefix: string): number {
        return this.calls.filter(c => c.startsWith(prefix)).length;
    }
    public lastSeek(): number {
        return this.seeks[this.seeks.length - 1];
    }
}

/**
 * The worklet output as the combined player sees it.
 */
export class FakeFollowingOutput implements IMediaFollowingOutput {
    public keepAlive: boolean = false;
    public destinationNode: AudioNode | null = null;
    public readonly workletNode: AudioNode | null = null;
    public warmUps: number = 0;
    public readonly mediaTimestamp: IEventEmitterOfT<MediaTimestampEventArgs> =
        new EventEmitterOfT<MediaTimestampEventArgs>();
    public readonly countInEnd: IEventEmitterOfT<number> = new EventEmitterOfT<number>();
    public readonly workletFailed: IEventEmitterOfT<Error> = new EventEmitterOfT<Error>();

    public warmUp(): void {
        this.warmUps++;
    }
    public addMediaSamples(_samples: Float32Array, _chunk: MediaSampleChunk): void {}
    public stamp(frame: number, mediaTime: number): void {
        (this.mediaTimestamp as EventEmitterOfT<MediaTimestampEventArgs>).trigger(
            new MediaTimestampEventArgs(frame, mediaTime)
        );
    }
    public endCountIn(frame: number): void {
        (this.countInEnd as EventEmitterOfT<number>).trigger(frame);
    }
    public fail(message: string): void {
        (this.workletFailed as EventEmitterOfT<Error>).trigger(new Error(message));
    }
}

/**
 * A backing-track clock on a TestMediaOutput: the media time is its position (plus a latency) while it plays.
 */
export class FakeBackingClock implements IMediaClock {
    public speed: number = 1;
    public isSeeking: boolean = false;
    public latencyMs: number = 0;
    private readonly _output: TestMediaOutput;
    private _seeked: (() => void)[] = [];

    public constructor(output: TestMediaOutput) {
        this._output = output;
    }

    public get position(): number {
        return this._output.currentTime;
    }

    public whenSeeked(action: () => void): void {
        if (this.isSeeking) {
            this._seeked.push(action);
        } else {
            action();
        }
    }

    public finishSeek(): void {
        this.isSeeking = false;
        for (const action of this._seeked.splice(0)) {
            action();
        }
    }

    public mediaTimeAt(_frame: number): number {
        return this._output.isPlaying && !this.isSeeking
            ? this._output.currentTime + this.latencyMs * this.speed
            : Number.NaN;
    }

    public mediaTimeNow(): number {
        return this.mediaTimeAt(0);
    }
}

/**
 * A latency probe the test answers.
 */
export class FakeProbe implements IMediaLatencyProbe {
    public readonly requests: number[] = [];
    private _pending: { resolve: (value: number) => void; reject: (error: Error) => void }[] = [];

    public measure(speed: number): Promise<number> {
        this.requests.push(speed);
        return new Promise<number>((resolve, reject) => this._pending.push({ resolve, reject }));
    }
    public resolveNext(value: number): void {
        this._pending.shift()!.resolve(value);
    }
    public rejectNext(error: Error): void {
        this._pending.shift()!.reject(error);
    }
}

/**
 * The heard context time of the external clock, from the fake timer.
 */
export class TimerHeardTime implements IExternalClockSource {
    public readonly sampleRate: number = 48000;
    private readonly _timer: FakeMediaTimer;

    public constructor(timer: FakeMediaTimer) {
        this._timer = timer;
    }

    public heardContextTime(): number {
        return this._timer.time / 1000;
    }
}

/**
 * A combined player on fakes: a real BackingTrackPlayer (or ExternalMediaPlayer) and fake synth, worklet, graph,
 * timer and probe.
 */
export class MediaSynthHarness {
    public readonly timer: FakeMediaTimer = new FakeMediaTimer();
    public readonly graph: FakeMixGraph;
    public readonly synth: FakeMediaSynth = new FakeMediaSynth();
    public readonly synthOutput: FakeFollowingOutput = new FakeFollowingOutput();
    public readonly probe: FakeProbe = new FakeProbe();
    public readonly probeLatencies: PerSpeedValues = new PerSpeedValues();
    public readonly media: BackingTrackPlayer;
    public readonly mediaOutput: TestMediaOutput | null = null;
    public readonly handler: TestMediaHandler | null = null;
    public readonly backingClock: FakeBackingClock | null = null;
    public readonly externalClock: ExternalMediaClock | null = null;
    public readonly player: MediaSynthPlayer;
    /**
     * 'Playing', 'Paused' or 'Stopped' per stateChanged.
     */
    public readonly states: string[] = [];
    public readonly positions: number[] = [];
    public finished: number = 0;

    public constructor(external: boolean = false, hasSoundFont: boolean = true) {
        this.graph = new FakeMixGraph(this.timer);
        const parts = new MediaSynthPlayerParts();
        if (external) {
            const media = new ExternalMediaPlayer(500);
            const handler = new TestMediaHandler();
            (media.output as IExternalMediaSynthOutput).handler = handler;
            const clock = new ExternalMediaClock(new TimerHeardTime(this.timer), () => 0);
            this.media = media;
            this.handler = handler;
            this.externalClock = clock;
            parts.clock = clock;
            parts.externalClock = clock;
        } else {
            const output = new TestMediaOutput();
            const clock = new FakeBackingClock(output);
            this.media = new BackingTrackPlayer(output, 500);
            this.mediaOutput = output;
            this.backingClock = clock;
            parts.clock = clock;
            parts.probe = this.probe;
        }
        parts.media = this.media;
        parts.synth = this.synth;
        parts.synthOutput = this.synthOutput;
        parts.graph = this.graph;
        parts.timer = this.timer;
        parts.probeLatencies = this.probeLatencies;
        parts.hasSoundFont = hasSoundFont;
        this.player = new MediaSynthPlayer(parts);
        this.player.stateChanged.on(e =>
            this.states.push(e.state === PlayerState.Playing ? 'Playing' : e.stopped ? 'Stopped' : 'Paused')
        );
        this.player.positionChanged.on(e => this.positions.push(e.currentTime));
        this.player.finished.on(() => this.finished++);
    }

    /**
     * Loads syncpoints-testfile.gp; with `synthReady` the synthesizer is then ready (the usual start).
     */
    public async loadSong(synthReady: boolean = true): Promise<MidiFile> {
        const data = await TestPlatform.loadFile('test-data/audio/syncpoints-testfile.gp');
        const score = ScoreLoader.loadScoreFromBytes(data, new Settings());
        const midi = new MidiFile();
        const generator = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(midi));
        generator.generate();
        this.player.loadMidiFile(midi);
        this.player.loadBackingTrack(score);
        this.player.updateSyncPoints(generator.syncPoints);
        if (synthReady) {
            this.synth.becomeReady();
            this.synth.becomeReadyForPlayback();
        }
        return midi;
    }

    /**
     * External media: the handler reports its position (alphaTab's YouTube sample does this every 50 ms).
     */
    public report(position: number): void {
        (this.media.output as IExternalMediaSynthOutput).updatePosition(position);
    }
}
```

- [ ] **Step 5: Write the failing tests**

Create `packages/alphatab/test/audio/MediaSynthPlayer.Routing.test.ts`:

```ts
/**
 * The combined player: routing, readiness, the media-only fallback, volumes, output, probe schedule (spec §6.1).
 * @target web
 */
import { describe, expect, it } from 'vitest';
import { EventEmitterOfT } from '@coderline/alphatab/EventEmitter';
import type { IExternalMediaSynthOutput } from '@coderline/alphatab/synth/ExternalMediaPlayer';
import { MidiEventsPlayedEventArgs } from '@coderline/alphatab/synth/MidiEventsPlayedEventArgs';
import { PlayerState } from '@coderline/alphatab/synth/PlayerState';
import { PlayerStateChangedEventArgs } from '@coderline/alphatab/synth/PlayerStateChangedEventArgs';
import { PositionChangedEventArgs } from '@coderline/alphatab/synth/PositionChangedEventArgs';
import { flush, MediaSynthHarness } from 'test/audio/MediaSyncFakes';

describe('MediaSynthPlayerRoutingTests', () => {
    it('routes-the-media-and-the-synth-events', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        (h.synth.positionChanged as EventEmitterOfT<PositionChangedEventArgs>).trigger(
            new PositionChangedEventArgs(999, 0, 0, 0, false, 120, 120)
        );
        expect(h.positions).not.toContain(999);
        h.player.timePosition = 1000;
        expect(h.positions[h.positions.length - 1]).toBeCloseTo(1000, 6);

        let played = 0;
        h.player.midiEventsPlayed.on(() => played++);
        (h.synth.midiEventsPlayed as EventEmitterOfT<MidiEventsPlayedEventArgs>).trigger(new MidiEventsPlayedEventArgs([]));
        expect(played).toBe(1);
    });

    it('the-inner-players-states-never-reach-the-app', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        (h.synth.stateChanged as EventEmitterOfT<PlayerStateChangedEventArgs>).trigger(
            new PlayerStateChangedEventArgs(PlayerState.Playing, false)
        );
        h.media.play();
        h.media.pause();
        expect(h.states).toEqual([]);
    });

    it('ready-waits-for-both-and-fires-once', () => {
        const h = new MediaSynthHarness();
        let ready = 0;
        h.player.ready.on(() => ready++);
        expect(h.player.isReady).toBe(false);
        expect(ready).toBe(0);
        h.synth.becomeReady();
        expect(ready).toBe(1);
        h.synth.becomeReady();
        expect(ready).toBe(1);
    });

    it('ready-for-playback-warms-up-the-worklet-and-starts-the-probe', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong(false);
        h.synth.becomeReady();
        expect(h.player.isReadyForPlayback).toBe(false); // waiting for the SoundFont, as in synth mode
        h.synth.becomeReadyForPlayback();
        expect(h.player.isReadyForPlayback).toBe(true);
        expect(h.synthOutput.keepAlive).toBe(true);
        expect(h.synthOutput.warmUps).toBe(1);
        expect(h.probe.requests).toEqual([1]);
    });

    it('probe-waits-for-a-running-context', async () => {
        // Review Focus 3: the autoplay policy keeps the context suspended until a gesture
        const h = new MediaSynthHarness();
        h.graph.running = false;
        await h.loadSong();
        expect(h.probe.requests).toEqual([]);
        h.graph.start();
        expect(h.probe.requests).toEqual([1]);
    });

    it('probe-measures-the-background-speeds-in-turn', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        const values: [number, number][] = [
            [1, 0],
            [0.5, 60],
            [0.75, 27],
            [1.25, -4],
            [1.5, -4]
        ];
        for (const [speed, value] of values) {
            expect(h.probe.requests[h.probe.requests.length - 1]).toBe(speed);
            h.probe.resolveNext(value);
            await flush();
        }
        expect(h.probeLatencies.get(0.5)).toBe(60);
        expect(h.probe.requests.length).toBe(5);
        expect(h.player.diagnostics.probes.map(p => p.speed)).toEqual([1, 0.5, 0.75, 1.25, 1.5]);
    });

    it('a-failed-probe-uses-0', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        h.probe.rejectNext(new Error('no media'));
        await flush();
        expect(h.probeLatencies.has(1)).toBe(true);
        expect(h.probeLatencies.get(1)).toBe(0);
        expect(h.probe.requests).toEqual([1, 0.5]);
    });

    it('a-speed-without-a-value-is-probed-next', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        h.player.playbackSpeed = 0.875;
        h.probe.resolveNext(0);
        await flush();
        expect(h.probe.requests).toEqual([1, 0.875]);
    });

    it('no-soundfont-plays-the-media-alone-until-one-is-loaded', async () => {
        // FYI-4, spike 10 §6
        const h = new MediaSynthHarness(false, false);
        await h.loadSong(false);
        h.synth.becomeReady();
        expect(h.player.isReadyForPlayback).toBe(true);
        expect(h.synthOutput.warmUps).toBe(0);
        h.synth.becomeReadyForPlayback(); // api.loadSoundFont() reached the synth
        expect(h.synthOutput.warmUps).toBe(1);
        expect(h.probe.requests).toEqual([1]);
    });

    it('a-failing-worker-falls-back-to-the-media-alone', async () => {
        // F-8, spike 10 §1
        const h = new MediaSynthHarness();
        await h.loadSong(false);
        h.synth.fail('alphaTab.worker.mjs: 404');
        expect(h.player.isReady).toBe(true);
        expect(h.player.isReadyForPlayback).toBe(true);
        h.player.play();
        expect(h.mediaOutput!.isPlaying).toBe(true);
        expect(h.synth.count('play')).toBe(0);
    });

    it('a-failing-worklet-falls-back-to-the-media-alone', async () => {
        // F-8, spike 10 §2
        const h = new MediaSynthHarness();
        await h.loadSong(false);
        h.synth.becomeReady();
        h.synthOutput.fail('Audio Worklet operation failed');
        expect(h.player.isReadyForPlayback).toBe(true);
    });

    it('a-failed-soundfont-download-falls-back-to-the-media-alone', async () => {
        // F-8, spike 10 §3: raised on the instance by AlphaTabApi.loadSoundFontFromUrl
        const h = new MediaSynthHarness();
        await h.loadSong(false);
        h.synth.becomeReady();
        (h.player.soundFontLoadFailed as EventEmitterOfT<Error>).trigger(new Error('connection refused'));
        expect(h.player.isReadyForPlayback).toBe(true);
        h.synth.becomeReadyForPlayback(); // a later SoundFont works: mixing again
        expect(h.synthOutput.warmUps).toBe(1);
    });

    it('volumes-go-to-the-gains', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        h.player.masterVolume = 0.8;
        h.player.backingTrackVolume = 0.35;
        h.player.synthVolume = 2;
        expect(h.graph.masterGain).toBeCloseTo(0.8, 9);
        expect(h.graph.mediaGain).toBeCloseTo(0.35, 9);
        expect(h.graph.synthGain).toBe(2);
        expect(h.mediaOutput!.masterVolume).toBe(1); // the <audio> stays at full volume
    });

    it('external-media-gets-master-volume-alone', async () => {
        const h = new MediaSynthHarness(true);
        await h.loadSong();
        h.player.masterVolume = 0.8;
        h.player.backingTrackVolume = 0.35;
        expect(h.handler!.masterVolume).toBeCloseTo(0.8, 9);
        expect(h.graph.mediaGain).toBe(1);
        expect(h.graph.masterGain).toBeCloseTo(0.8, 9); // the synth, through masterGain
    });

    it('output-passes-the-media-members-through', async () => {
        const h = new MediaSynthHarness(true);
        await h.loadSong();
        const output = h.player.output as IExternalMediaSynthOutput;
        expect(output.handler).toBe(h.handler);
        const times: number[] = [];
        output.timeUpdate.on(t => times.push(t));
        output.updatePosition(1234);
        expect(times).toEqual([1234]);
        expect(await output.enumerateOutputDevices()).toEqual([]); // the synth output's (TestOutput)
    });
});
```

- [ ] **Step 6: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaSynthPlayer.Routing.test.ts`
Expected: FAIL — cannot resolve `MediaSynthPlayer`.

- [ ] **Step 7: Implement the combined player**

Create `packages/alphatab/src/platform/javascript/MediaSynthPlayer.ts`:

```ts
import {
    EventEmitter,
    EventEmitterOfT,
    type IEventEmitter,
    type IEventEmitterOfT
} from '@coderline/alphatab/EventEmitter';
import { Logger } from '@coderline/alphatab/Logger';
import type { LogLevel } from '@coderline/alphatab/LogLevel';
import type { MidiEventType } from '@coderline/alphatab/midi/MidiEvent';
import type { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import type { Score } from '@coderline/alphatab/model/Score';
import type { ExternalMediaClock, IMediaClock } from '@coderline/alphatab/platform/javascript/MediaClock';
import { MediaLatencyProbe } from '@coderline/alphatab/platform/javascript/MediaLatencyProbe';
import { MediaSyncController, type MediaSyncStats } from '@coderline/alphatab/platform/javascript/MediaSyncController';
import { MediaSynthOutput } from '@coderline/alphatab/platform/javascript/MediaSynthOutput';
import type {
    IMediaFollowingOutput,
    IMediaLatencyProbe,
    IMediaMixGraph,
    IMediaSynth,
    IMediaTimer
} from '@coderline/alphatab/platform/javascript/MediaSynthTypes';
import { PerSpeedValues } from '@coderline/alphatab/platform/javascript/PerSpeedValues';
import type { BackingTrackPlayer, IBackingTrackSynthOutput } from '@coderline/alphatab/synth/BackingTrackPlayer';
import type { BackingTrackSyncPoint, IAlphaSynth } from '@coderline/alphatab/synth/IAlphaSynth';
import type { ISynthOutput } from '@coderline/alphatab/synth/ISynthOutput';
import type { MidiEventsPlayedEventArgs } from '@coderline/alphatab/synth/MidiEventsPlayedEventArgs';
import type { PlaybackRange } from '@coderline/alphatab/synth/PlaybackRange';
import { PlaybackRangeChangedEventArgs } from '@coderline/alphatab/synth/PlaybackRangeChangedEventArgs';
import { PlayerState } from '@coderline/alphatab/synth/PlayerState';
import { PlayerStateChangedEventArgs } from '@coderline/alphatab/synth/PlayerStateChangedEventArgs';
import type { PositionChangedEventArgs } from '@coderline/alphatab/synth/PositionChangedEventArgs';
import { SynthConstants } from '@coderline/alphatab/synth/SynthConstants';

/**
 * The parts a combined player is built from (BrowserUiFacade builds the real ones; tests build fakes).
 * @target web
 * @internal
 */
export class MediaSynthPlayerParts {
    /**
     * A BackingTrackPlayer, or an ExternalMediaPlayer.
     */
    public media!: BackingTrackPlayer;
    public synth!: IMediaSynth;
    public synthOutput!: IMediaFollowingOutput;
    public graph!: IMediaMixGraph;
    public clock!: IMediaClock;
    /**
     * External media only: the same object as `clock`.
     */
    public externalClock: ExternalMediaClock | null = null;
    public timer!: IMediaTimer;
    /**
     * Backing track only.
     */
    public probe: IMediaLatencyProbe | null = null;
    /**
     * The probe's values (MediaLatencyProbe.cache in the browser); the backing-track clock reads them too.
     */
    public probeLatencies: PerSpeedValues = new PerSpeedValues();
    /**
     * Whether settings.player.soundFont is set.
     */
    public hasSoundFont: boolean = true;
}

/**
 * @target web
 * @internal
 */
export class MediaSynthCountInRecord {
    public readonly speed: number;
    /** How late the media's play() was issued against its planned time, ms. */
    public readonly lateMs: number;

    public constructor(speed: number, lateMs: number) {
        this.speed = speed;
        this.lateMs = lateMs;
    }
}

/**
 * @target web
 * @internal
 */
export class MediaSynthProbeRecord {
    public readonly speed: number;
    public readonly latencyMs: number;
    public readonly time: number;

    public constructor(speed: number, latencyMs: number, time: number) {
        this.speed = speed;
        this.latencyMs = latencyMs;
        this.time = time;
    }
}

/**
 * The sync lab's view into the combined player (spec §3). Not public API.
 * @target web
 * @internal
 */
export class MediaSynthDiagnostics {
    public readonly wraps: number[] = [];
    public readonly countIns: MediaSynthCountInRecord[] = [];
    public readonly probes: MediaSynthProbeRecord[] = [];
    private readonly _parts: MediaSynthPlayerParts;
    private readonly _controller: MediaSyncController;

    public constructor(parts: MediaSynthPlayerParts, controller: MediaSyncController) {
        this._parts = parts;
        this._controller = controller;
    }

    public get audioContext(): AudioContext | null {
        return this._parts.graph.context;
    }

    public get mediaSourceNode(): AudioNode | null {
        return this._parts.graph.mediaSourceNode;
    }

    public get synthNode(): AudioNode | null {
        return this._parts.synthOutput.workletNode;
    }

    public get masterGainNode(): GainNode | null {
        return this._parts.graph.masterGainNode;
    }

    public get stats(): MediaSyncStats {
        return this._controller.stats;
    }

    public get startLeads(): Record<string, number> {
        return this._controller.startLeads.toRecord();
    }

    public get mediaStartLatencies(): Record<string, number> {
        return this._controller.mediaStartLatencies.toRecord();
    }

    public get probeLatencies(): Record<string, number> {
        return this._parts.probeLatencies.toRecord();
    }

    /**
     * The drift log grows with every reading: only on while the lab measures.
     */
    public enableDriftLog(enabled: boolean): void {
        this._controller.stats.driftLog = enabled ? [] : null;
    }

    public forgetStartLead(speed: number): void {
        this._controller.startLeads.delete(speed);
    }

    public forgetProbeLatency(speed: number): void {
        this._parts.probeLatencies.delete(speed);
    }

    /**
     * Measures a speed now without caching it (the lab's 0.25× and 2×).
     */
    public measureLatency(speed: number): Promise<number> {
        const probe = this._parts.probe;
        return probe ? probe.measure(speed) : Promise.resolve(0);
    }
}

/**
 * One IAlphaSynth over a media player (the clock) and the worker synthesizer that follows it (spec §6.1).
 * It owns the transport state and the loop wrap; MediaSyncController keeps the two together.
 * @target web
 * @internal
 */
export class MediaSynthPlayer implements IAlphaSynth {
    private static readonly _soundFontFailure: string = 'the SoundFont failed to load';

    public readonly controller: MediaSyncController;
    public readonly diagnostics: MediaSynthDiagnostics;

    private readonly _media: BackingTrackPlayer;
    private readonly _synth: IMediaSynth;
    private readonly _synthOutput: IMediaFollowingOutput;
    private readonly _graph: IMediaMixGraph;
    private readonly _clock: IMediaClock;
    private readonly _externalClock: ExternalMediaClock | null;
    private readonly _timer: IMediaTimer;
    private readonly _probe: IMediaLatencyProbe | null;
    private readonly _probeLatencies: PerSpeedValues;
    private readonly _output: MediaSynthOutput;
    private readonly _unsubscribe: (() => void)[] = [];

    private _state: PlayerState = PlayerState.Paused;
    private _midiLoaded: boolean = false;
    private _hasSoundFont: boolean;
    private _synthReadyForPlayback: boolean = false;
    private _synthFailure: string = '';
    private _readyFired: boolean = false;
    private _destroyed: boolean = false;

    private _masterVolume: number = 1;
    private _backingTrackVolume: number = 1;
    private _synthVolume: number = 1;
    private _countInVolume: number = 0;
    private _playbackRange: PlaybackRange | null = null;
    private _isLooping: boolean = false;
    private _syncPoints: BackingTrackSyncPoint[] = [];

    private _probeQueue: number[] = [];
    private _probing: boolean = false;
    private _waitingForContext: boolean = false;

    public constructor(parts: MediaSynthPlayerParts) {
        this._media = parts.media;
        this._synth = parts.synth;
        this._synthOutput = parts.synthOutput;
        this._graph = parts.graph;
        this._clock = parts.clock;
        this._externalClock = parts.externalClock;
        this._timer = parts.timer;
        this._probe = parts.probe;
        this._probeLatencies = parts.probeLatencies;
        this._hasSoundFont = parts.hasSoundFont;
        this.controller = new MediaSyncController(this._synth, this._clock, this._timer);
        this.controller.baseLatencyMs = this._graph.baseLatencyMs;
        this.diagnostics = new MediaSynthDiagnostics(parts, this.controller);
        this._output = new MediaSynthOutput(this._media.output as IBackingTrackSynthOutput, this._synth.output);

        this.ready = new EventEmitter(() => this.isReady);
        this.readyForPlayback = new EventEmitter(() => this.isReadyForPlayback);
        this.midiLoaded = new EventEmitterOfT<PositionChangedEventArgs>(() => this._media.loadedMidiInfo ?? null);
        this.stateChanged = new EventEmitterOfT<PlayerStateChangedEventArgs>(
            () => new PlayerStateChangedEventArgs(this._state, false)
        );
        this.positionChanged = new EventEmitterOfT<PositionChangedEventArgs>(() => this._media.currentPosition);
        this.playbackRangeChanged = new EventEmitterOfT<PlaybackRangeChangedEventArgs>(() =>
            this._playbackRange ? new PlaybackRangeChangedEventArgs(this._playbackRange) : null
        );

        // the inner players run without a range, looping, count-in or volumes of their own (§6.1)
        this._media.isLooping = false;
        this._media.countInVolume = 0;
        this._synth.isLooping = false;
        this._synth.countInVolume = 0;
        this._synth.masterVolume = 1;

        const media = this._media;
        const synth = this._synth;
        const subscribe = (unsubscribe: () => void) => this._unsubscribe.push(unsubscribe);
        subscribe(media.positionChanged.on(e => this._onMediaPosition(e)));
        subscribe(media.finished.on(() => this._onMediaFinished()));
        subscribe(media.midiLoaded.on(e => (this.midiLoaded as EventEmitterOfT<PositionChangedEventArgs>).trigger(e)));
        subscribe(media.midiLoadFailed.on(e => (this.midiLoadFailed as EventEmitterOfT<Error>).trigger(e)));
        subscribe(media.ready.on(() => this._checkReady()));
        subscribe(media.readyForPlayback.on(() => this._checkReadyForPlayback()));
        subscribe(synth.ready.on(() => this._checkReady()));
        subscribe(synth.readyForPlayback.on(() => this._onSynthReadyForPlayback()));
        subscribe(
            synth.midiEventsPlayed.on(e =>
                (this.midiEventsPlayed as EventEmitterOfT<MidiEventsPlayedEventArgs>).trigger(e)
            )
        );
        subscribe(synth.soundFontLoaded.on(() => (this.soundFontLoaded as EventEmitter).trigger()));
        // the synth's own failure and a failed download (raised on this instance, F-8) both arrive here
        subscribe(synth.soundFontLoadFailed.on(e => (this.soundFontLoadFailed as EventEmitterOfT<Error>).trigger(e)));
        subscribe(
            this.soundFontLoadFailed.on(e =>
                this._fallBackToMediaOnly(`${MediaSynthPlayer._soundFontFailure}: ${e.message}`)
            )
        );
        subscribe(synth.workerFailed.on(e => this._fallBackToMediaOnly(e.message)));
        subscribe(this._synthOutput.workletFailed.on(e => this._fallBackToMediaOnly(e.message)));
        subscribe(this._synthOutput.mediaTimestamp.on(e => this.controller.onStamp(e.frame, e.mediaTime)));
        this._applyVolumes();
    }

    // ---- readiness and the media-only fallback (§6.1) ----

    public get isReady(): boolean {
        return this._media.isReady && (this._synth.isReady || this._synthFailure !== '');
    }

    public get isReadyForPlayback(): boolean {
        return this._media.isReadyForPlayback && (this._synthReadyForPlayback || this._isMediaOnly);
    }

    /**
     * The synthesizer can't play now: it failed, or there is no SoundFont yet.
     */
    private get _isMediaOnly(): boolean {
        return this._synthFailure !== '' || !this._hasSoundFont;
    }

    /**
     * Both play: the synthesizer is ready and nothing failed.
     */
    private get _isMixing(): boolean {
        return !this._isMediaOnly && this._synthReadyForPlayback;
    }

    private _checkReady(): void {
        if (!this._readyFired && this.isReady) {
            this._readyFired = true;
            (this.ready as EventEmitter).trigger();
        }
    }

    private _checkReadyForPlayback(): void {
        if (this.isReadyForPlayback) {
            (this.readyForPlayback as EventEmitter).trigger();
        }
    }

    private _onSynthReadyForPlayback(): void {
        this._synthReadyForPlayback = true;
        // a SoundFont loaded later (api.loadSoundFont(), FYI-4) ends the fallback
        this._hasSoundFont = true;
        if (this._synthFailure.startsWith(MediaSynthPlayer._soundFontFailure)) {
            this._synthFailure = '';
        }
        if (this._synthFailure === '') {
            // build the worklet before the first Play, measure the media latency in the background (§6.1, §6.4)
            this._synthOutput.keepAlive = true;
            this._synthOutput.warmUp();
            this._startBackgroundProbe();
        }
        this._checkReadyForPlayback();
    }

    private _fallBackToMediaOnly(reason: string): void {
        if (this._synthFailure !== '') {
            return;
        }
        this._synthFailure = reason;
        Logger.warning('Player', `The synthesizer can't play along the media; playing the media only: ${reason}`);
        if (this._state === PlayerState.Playing) {
            // the media keeps playing alone
            this.controller.stopped();
            this._synth.pause();
        }
        this._checkReady();
        this._checkReadyForPlayback();
    }

    // ---- volumes (§6.1, §7) ----

    public get masterVolume(): number {
        return this._masterVolume;
    }

    public set masterVolume(value: number) {
        this._masterVolume = Math.max(value, SynthConstants.MinVolume);
        this._applyVolumes();
    }

    public get backingTrackVolume(): number {
        return this._backingTrackVolume;
    }

    public set backingTrackVolume(value: number) {
        this._backingTrackVolume = Math.max(value, SynthConstants.MinVolume);
        this._applyVolumes();
    }

    public get synthVolume(): number {
        return this._synthVolume;
    }

    public set synthVolume(value: number) {
        this._synthVolume = Math.max(value, SynthConstants.MinVolume);
        this._applyVolumes();
    }

    private _applyVolumes(): void {
        const graph = this._graph;
        graph.masterGain = this._masterVolume;
        graph.synthGain = this._synthVolume;
        if (this._externalClock) {
            // the external player isn't in the graph: its handler gets masterVolume alone, as today (§7)
            this._media.masterVolume = this._masterVolume;
            graph.mediaGain = 1;
        } else {
            // the <audio> stays at full volume; the gains mix
            this._media.masterVolume = 1;
            this._media.backingTrackVolume = 1;
            graph.mediaGain = this._backingTrackVolume;
        }
    }

    // ---- the latency probe's schedule (§6.4) ----

    private _startBackgroundProbe(): void {
        for (const speed of MediaLatencyProbe.backgroundSpeeds) {
            this._queueProbe(speed, false);
        }
        this._probeNext();
    }

    private _queueProbe(speed: number, first: boolean): void {
        if (!this._probe || this._probeLatencies.has(speed)) {
            return;
        }
        const key = PerSpeedValues.key(speed);
        const index = this._probeQueue.indexOf(key);
        if (index >= 0) {
            this._probeQueue.splice(index, 1);
        }
        if (first) {
            this._probeQueue.unshift(key);
        } else {
            this._probeQueue.push(key);
        }
    }

    private _probeNext(): void {
        const probe = this._probe;
        if (!probe || this._probing || this._destroyed || this._probeQueue.length === 0) {
            return;
        }
        if (!this._graph.isRunning) {
            // the probe waits until the AudioContext runs (§13)
            if (!this._waitingForContext) {
                this._waitingForContext = true;
                this._graph.whenRunning(() => {
                    this._waitingForContext = false;
                    this._probeNext();
                });
            }
            return;
        }
        const speed = this._probeQueue.shift()!;
        if (this._probeLatencies.has(speed)) {
            this._probeNext();
            return;
        }
        this._probing = true;
        probe.measure(speed).then(
            latency => this._onProbed(speed, latency),
            e => {
                Logger.warning('Player', `Measuring the media latency at ${speed}x failed, using 0: ${e}`);
                this._onProbed(speed, 0);
            }
        );
    }

    private _onProbed(speed: number, latency: number): void {
        this._probing = false;
        if (this._destroyed) {
            return;
        }
        this._probeLatencies.set(speed, latency);
        this.diagnostics.probes.push(new MediaSynthProbeRecord(speed, latency, this._timer.now()));
        if (this._state === PlayerState.Playing && PerSpeedValues.key(this.playbackSpeed) === speed) {
            // a measured value replaced the guess mid-playback: settle, no forced re-sync (F-9a, D-1)
            this.controller.latencyChanged();
        }
        this._probeNext();
    }

    // ---- transport ----

    public get state(): PlayerState {
        return this._state;
    }

    public play(): boolean {
        if (this._state !== PlayerState.Paused || !this._media.isReadyForPlayback) {
            return false;
        }
        this._setState(PlayerState.Playing, false);
        this._startPlayback();
        return true;
    }

    public pause(): void {
        if (this._state === PlayerState.Paused) {
            return;
        }
        this._interrupt();
        this._setState(PlayerState.Paused, false);
    }

    public playPause(): void {
        if (this._state !== PlayerState.Paused) {
            this.pause();
        } else {
            this.play();
        }
    }

    public stop(): void {
        if (!this._midiLoaded) {
            return;
        }
        this._interrupt();
        this._media.stop();
        this._synth.stop();
        if (this._playbackRange) {
            // back to the range start, as today
            this._media.tickPosition = this._playbackRange.startTick;
        }
        this._setState(PlayerState.Paused, true);
    }

    public get timePosition(): number {
        return this._media.timePosition;
    }

    public set timePosition(value: number) {
        this._seek(() => {
            this._media.timePosition = value;
        });
    }

    public get tickPosition(): number {
        return this._media.tickPosition;
    }

    public set tickPosition(value: number) {
        this._seek(() => {
            this._media.tickPosition = value;
        });
    }

    public get playbackSpeed(): number {
        return this._media.playbackSpeed;
    }

    public set playbackSpeed(value: number) {
        this._media.playbackSpeed = value;
        const speed = this._media.playbackSpeed;
        this._synth.playbackSpeed = speed;
        this._clock.speed = speed;
        this._queueProbe(speed, true);
        this._probeNext();
    }

    public get playbackRange(): PlaybackRange | null {
        return this._playbackRange;
    }

    public set playbackRange(value: PlaybackRange | null) {
        this._playbackRange = value;
        if (value) {
            // seeks to the range start, as AlphaSynthBase does
            this.tickPosition = value.startTick;
        }
        (this.playbackRangeChanged as EventEmitterOfT<PlaybackRangeChangedEventArgs>).trigger(
            new PlaybackRangeChangedEventArgs(value)
        );
    }

    public get isLooping(): boolean {
        return this._isLooping;
    }

    public set isLooping(value: boolean) {
        this._isLooping = value;
    }

    public playOneTimeMidiFile(midi: MidiFile): void {
        this._media.playOneTimeMidiFile(midi);
    }

    private _setState(state: PlayerState, stopped: boolean): void {
        this._state = state;
        (this.stateChanged as EventEmitterOfT<PlayerStateChangedEventArgs>).trigger(
            new PlayerStateChangedEventArgs(state, stopped)
        );
    }

    private _startPlayback(): void {
        this._playMedia();
    }

    private _seek(apply: () => void): void {
        apply();
    }

    /**
     * Stops whatever is in flight; both end paused.
     */
    private _interrupt(): void {
        this.controller.stopped();
        this._pauseMedia();
        this._synth.pause();
    }

    private _playMedia(): void {
        this._externalClock?.setPlaying(true);
        this._media.play();
    }

    private _pauseMedia(): void {
        this._externalClock?.setPlaying(false);
        this._media.pause();
    }

    private get _mediaDuration(): number {
        return (this._media.output as IBackingTrackSynthOutput).backingTrackDuration;
    }

    private _sendFollowConfig(): void {
        this._synth.followMedia(true, this._mediaDuration, this._syncPoints);
    }

    private _onMediaPosition(e: PositionChangedEventArgs): void {
        (this.positionChanged as EventEmitterOfT<PositionChangedEventArgs>).trigger(e);
    }

    private _onMediaFinished(): void {
        (this.finished as EventEmitter).trigger();
    }

    // ---- delegation ----

    public get output(): ISynthOutput {
        return this._output;
    }

    public get logLevel(): LogLevel {
        return this._synth.logLevel;
    }

    public set logLevel(value: LogLevel) {
        this._media.logLevel = value;
        this._synth.logLevel = value;
    }

    public get metronomeVolume(): number {
        return this._synth.metronomeVolume;
    }

    public set metronomeVolume(value: number) {
        this._synth.metronomeVolume = value;
    }

    public get countInVolume(): number {
        return this._countInVolume;
    }

    public set countInVolume(value: number) {
        // applied by the combined player itself: only an app Play from Paused counts in (§6.1)
        this._countInVolume = Math.max(value, SynthConstants.MinVolume);
    }

    public get midiEventsPlayedFilter(): MidiEventType[] {
        return this._synth.midiEventsPlayedFilter;
    }

    public set midiEventsPlayedFilter(value: MidiEventType[]) {
        this._synth.midiEventsPlayedFilter = value;
    }

    public get loadedMidiInfo(): PositionChangedEventArgs | undefined {
        return this._media.loadedMidiInfo;
    }

    public get currentPosition(): PositionChangedEventArgs {
        return this._media.currentPosition;
    }

    public destroy(): void {
        this._destroyed = true;
        this._interrupt();
        for (const unsubscribe of this._unsubscribe) {
            unsubscribe();
        }
        this._unsubscribe.length = 0;
        this._media.destroy();
        this._synth.destroy();
    }

    public loadSoundFont(data: Uint8Array, append: boolean): void {
        this._synth.loadSoundFont(data, append);
    }

    public resetSoundFonts(): void {
        this.stop();
        this._synth.resetSoundFonts();
    }

    public loadMidiFile(midi: MidiFile): void {
        this.stop();
        this._midiLoaded = true;
        this._media.loadMidiFile(midi);
        this._synth.loadMidiFile(midi);
    }

    public loadBackingTrack(score: Score): void {
        this._media.loadBackingTrack(score);
    }

    public updateSyncPoints(syncPoints: BackingTrackSyncPoint[]): void {
        this._syncPoints = syncPoints;
        this._media.updateSyncPoints(syncPoints);
        // loading a MIDI file drops the worker's sync points: send them again
        this._sendFollowConfig();
    }

    public applyTranspositionPitches(transpositionPitches: Map<number, number>): void {
        this._synth.applyTranspositionPitches(transpositionPitches);
    }

    public setChannelTranspositionPitch(channel: number, semitones: number): void {
        this._synth.setChannelTranspositionPitch(channel, semitones);
    }

    public setChannelMute(channel: number, mute: boolean): void {
        this._synth.setChannelMute(channel, mute);
    }

    public resetChannelStates(): void {
        this._synth.resetChannelStates();
    }

    public setChannelSolo(channel: number, solo: boolean): void {
        this._synth.setChannelSolo(channel, solo);
    }

    public setChannelVolume(channel: number, volume: number): void {
        this._synth.setChannelVolume(channel, volume);
    }

    public readonly ready: IEventEmitter;
    public readonly readyForPlayback: IEventEmitter;
    public readonly finished: IEventEmitter = new EventEmitter();
    public readonly soundFontLoaded: IEventEmitter = new EventEmitter();
    public readonly soundFontLoadFailed: IEventEmitterOfT<Error> = new EventEmitterOfT<Error>();
    public readonly midiLoaded: IEventEmitterOfT<PositionChangedEventArgs>;
    public readonly midiLoadFailed: IEventEmitterOfT<Error> = new EventEmitterOfT<Error>();
    public readonly stateChanged: IEventEmitterOfT<PlayerStateChangedEventArgs>;
    public readonly positionChanged: IEventEmitterOfT<PositionChangedEventArgs>;
    public readonly midiEventsPlayed: IEventEmitterOfT<MidiEventsPlayedEventArgs> =
        new EventEmitterOfT<MidiEventsPlayedEventArgs>();
    public readonly playbackRangeChanged: IEventEmitterOfT<PlaybackRangeChangedEventArgs>;
}
```

Notes for the implementer:
- `soundFontLoadFailed` is declared with an initializer, and the constructor subscribes to it. Field initializers run
  before the constructor body, so the subscription is safe.
- `_startPlayback` and `_seek` are their final selves only in media-only mode. Task 16 gives them the synthesizer's
  handshakes.

- [ ] **Step 8: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaSynthPlayer.Routing.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 9: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src packages/alphatab/test/audio/MediaSyncFakes.ts packages/alphatab/test/audio/MediaSynthPlayer.Routing.test.ts
git commit -m "feat(web): combined player: routing, readiness, media-only fallback, volumes, probe schedule (#2397)"
git push
```

---

### Task 16: `MediaSynthPlayer` — start, seek and speed handshakes; one-time MIDI; song end

**Files:**
- Modify: `packages/alphatab/src/platform/javascript/MediaSynthPlayer.ts`
- Create: `packages/alphatab/test/audio/MediaSynthPlayer.Transport.test.ts`

**Interfaces:**
- Consumes: Task 15's player; `MediaSyncController.planStart/started/speedChanged` (Task 10); `IMediaClock.whenSeeked`
  (Task 11); `BackingTrackPlayer.seekMediaTo` (Task 15).
- Produces (used by Tasks 17–19): `_startPlayback()`, `_runStart(plan, learnStartLead)`, `_interrupt()` with the
  handshake counter, `_holdBefore` for positions, `_mediaDelayTimer`.

§6.2. **Start:** follow config, then plan the start. The media seeks to the plan's start, and only after the seek
the synth seeks and plays and the media plays (delayed by L when the synth is slower). The controller settles.
**Seek while playing (backing track):** pause both, seek, restart through the start handshake, with no count-in and
no `stateChanged`. **Speed change while playing:** both get the new speed and the clock its latency, then a re-sync
and settle (spike 11: Chrome's media lands 15–43 ms behind on every change). **Cursor:** positions from before the
start are held back during the media's pre-roll, so the cursor doesn't jump back. **`playBeat` / `playNote` while
playing (§6.1, spike 7):** pause both (the app sees Paused); the synth leaves follow mode and plays the beat on its
own clock; the next Play follows the media again. **Song end:** when the media reaches its own end, `finished`
fires once and both stop, as today. **Today's behavior kept:** `BackingTrackPlayer.updatePlaybackSpeed` also seeks
the `<audio>` to the same place. That is the media player's own logic (§4, "not changed"); the clock reads no time
while that seek runs, so the re-sync waits for it.

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/MediaSynthPlayer.Transport.test.ts`:

```ts
/**
 * The combined player's start, seek and speed handshakes (spec §6.2).
 * @target web
 */
import { describe, expect, it } from 'vitest';
import { flush, MediaSynthHarness } from 'test/audio/MediaSyncFakes';

async function playing(at: number = 5000, speed: number = 1): Promise<MediaSynthHarness> {
    const h = new MediaSynthHarness();
    await h.loadSong();
    h.player.playbackSpeed = speed;
    h.mediaOutput!.currentTime = at;
    h.player.play();
    return h;
}

describe('MediaSynthPlayerTransportTests', () => {
    it('play-reports-playing-at-once-and-starts-both-at-the-target', async () => {
        const h = await playing(5000);
        expect(h.states).toEqual(['Playing']);
        expect(h.synth.calls.slice(-4)).toEqual(['followMedia:true', 'pause', 'seek:5000', 'play:countIn=0']);
        expect(h.mediaOutput!.isPlaying).toBe(true);
        expect(h.player.controller.isActive).toBe(true);
    });

    it('a-slower-synth-delays-the-media', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        h.player.controller.startLeads.set(1, 8);
        h.mediaOutput!.currentTime = 5000;
        h.player.play();
        expect(h.mediaOutput!.isPlaying).toBe(false);
        h.timer.advance(7);
        expect(h.mediaOutput!.isPlaying).toBe(false);
        h.timer.advance(1);
        expect(h.mediaOutput!.isPlaying).toBe(true);
    });

    it('other-speeds-pre-roll-the-media-and-start-the-synth-where-it-is-heard', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        h.probeLatencies.set(0.5, 60);
        h.player.playbackSpeed = 0.5;
        h.mediaOutput!.currentTime = 5000;
        h.player.play();
        expect(h.mediaOutput!.seekTimes[h.mediaOutput!.seekTimes.length - 1]).toBeCloseTo(4940, 3);
        expect(h.synth.lastSeek()).toBeCloseTo(4940 + 30, 3);
    });

    it('the-media-pre-roll-does-not-move-the-cursor-back', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        h.probeLatencies.set(0.5, 60);
        h.player.playbackSpeed = 0.5;
        h.player.timePosition = 10000;
        const start = h.player.timePosition;
        h.positions.length = 0;
        h.player.play();
        expect(h.positions.filter(p => p < start - 1)).toEqual([]);
        for (let i = 0; i < 10; i++) {
            h.timer.advance(50);
            h.mediaOutput!.advance(50);
        }
        expect(h.positions.length).toBeGreaterThan(0);
        expect(Math.min(...h.positions)).toBeGreaterThanOrEqual(start - 1);
    });

    it('pause-during-the-media-delay-cancels-the-media-start', async () => {
        // Review Focus 2
        const h = new MediaSynthHarness();
        await h.loadSong();
        h.player.controller.startLeads.set(1, 50);
        h.player.play();
        h.player.pause();
        h.timer.advance(100);
        expect(h.mediaOutput!.isPlaying).toBe(false);
        expect(h.states).toEqual(['Playing', 'Paused']);
    });

    it('a-seek-while-playing-restarts-without-state-change-or-count-in', async () => {
        const h = await playing(5000);
        h.player.countInVolume = 1;
        h.player.timePosition = 20000;
        expect(h.states).toEqual(['Playing']);
        expect(h.synth.calls[h.synth.calls.length - 1]).toBe('play:countIn=0');
        expect(h.synth.lastSeek()).toBeCloseTo(h.mediaOutput!.currentTime, 3);
        expect(h.mediaOutput!.isPlaying).toBe(true);
    });

    it('a-speed-change-while-playing-re-syncs', async () => {
        const h = await playing(5000);
        const seeks = h.synth.seeks.length;
        h.player.playbackSpeed = 0.75;
        expect(h.synth.seeks.length).toBe(seeks + 1);
        expect(h.synth.playbackSpeed).toBe(0.75);
        expect(h.player.controller.isSettling).toBe(true);
        // the new speed is probed next, after the measurement already running (1x)
        h.probe.resolveNext(0);
        await flush();
        expect(h.probe.requests).toEqual([1, 0.75]);
    });

    it('a-probe-value-during-playback-settles', async () => {
        // Review Focus 3, F-9a (D-1)
        const h = await playing(5000);
        h.timer.advance(2000);
        expect(h.player.controller.isSettling).toBe(false);
        const seeks = h.synth.seeks.length;
        h.probe.resolveNext(3); // the background probe of 1x lands now
        await flush();
        expect(h.player.controller.isSettling).toBe(true);
        expect(h.synth.seeks.length).toBe(seeks);
    });

    it('stamps-reach-the-controller', async () => {
        const h = await playing(5000);
        h.timer.advance(2000);
        const seeks = h.synth.seeks.length;
        h.synthOutput.stamp(0, h.mediaOutput!.currentTime + 200);
        h.timer.advance(50);
        h.synthOutput.stamp(0, h.mediaOutput!.currentTime + 200);
        expect(h.synth.seeks.length).toBe(seeks + 1);
    });

    it('one-time-midi-pauses-both-and-leaves-follow-mode', async () => {
        const h = new MediaSynthHarness();
        const midi = await h.loadSong();
        h.mediaOutput!.currentTime = 5000;
        h.player.play();
        h.player.playOneTimeMidiFile(midi);
        expect(h.states[h.states.length - 1]).toBe('Paused');
        expect(h.synth.calls.slice(-2)).toEqual(['followMedia:false', 'playOneTimeMidiFile']);
        h.player.play();
        expect(h.synth.calls.slice(-4)).toEqual(['followMedia:true', 'pause', `seek:${h.synth.lastSeek()}`, 'play:countIn=0']);
    });

    it('the-media-end-stops-both-once', async () => {
        // Review Focus 1
        const h = await playing(41950);
        h.mediaOutput!.advance(100);
        expect(h.finished).toBe(1);
        expect(h.states).toEqual(['Playing', 'Stopped']);
        expect(h.synth.count('stop')).toBeGreaterThan(0);
    });

    it('destroy-clears-pending-timers', async () => {
        // Review Focus 5
        const h = new MediaSynthHarness();
        await h.loadSong();
        h.player.controller.startLeads.set(1, 50);
        h.player.play();
        h.player.destroy();
        h.timer.advance(100);
        expect(h.mediaOutput!.isPlaying).toBe(false);
        expect(h.timer.pending).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaSynthPlayer.Transport.test.ts`
Expected: FAIL — e.g. `play-reports-playing-at-once-and-starts-both-at-the-target` sees no synth calls.

- [ ] **Step 3: Implement the handshakes**

In `MediaSynthPlayer.ts` import `type MediaStartPlan` from `MediaSyncController`, and add the fields:

```ts
    private _handshake: number = 0;
    private _holdBefore: number = -1;
    private _mediaDelayTimer: number = 0;
```

Replace `_startPlayback`, `_seek`, `_interrupt`, `_onMediaPosition` and `_onMediaFinished`, and add `_runStart` and
`_mediaLatency`:

```ts
    /**
     * Starts from the media's position (§6.2 start handshake).
     */
    private _startPlayback(): void {
        const speed = this.playbackSpeed;
        this._queueProbe(speed, true);
        this._probeNext();
        if (!this._isMixing) {
            this._playMedia();
            return;
        }
        this._sendFollowConfig();
        this._runStart(this.controller.planStart(this._clock.position, speed, this._mediaLatency(speed)), true);
    }

    private _runStart(plan: MediaStartPlan, learnStartLead: boolean): void {
        // the cursor stays at the start position while the media pre-rolls
        this._holdBefore = this._media.timePosition;
        // ends a one-time MIDI the synth may still play (spike 7)
        this._synth.pause();
        if (plan.mediaSeekTo !== this._clock.position) {
            this._media.seekMediaTo(plan.mediaSeekTo);
        }
        const handshake = this._handshake;
        this._clock.whenSeeked(() => {
            if (handshake !== this._handshake) {
                // a pause or another handshake came first
                return;
            }
            this._synth.seekToMediaTime(plan.synthSeekTo);
            this._synth.play();
            if (plan.mediaDelayMs > 0) {
                this._mediaDelayTimer = this._timer.setTimeout(() => {
                    this._mediaDelayTimer = 0;
                    this._playMedia();
                }, plan.mediaDelayMs);
            } else {
                this._playMedia();
            }
            this.controller.started(plan, learnStartLead);
        });
    }

    private _seek(apply: () => void): void {
        if (this._state !== PlayerState.Playing) {
            apply();
            return;
        }
        // pause both, seek, restart through the start handshake: no count-in, no stateChanged (§6.2)
        this._interrupt();
        apply();
        this._startPlayback();
    }

    /**
     * Stops whatever a handshake has in flight; both end paused.
     */
    private _interrupt(): void {
        this._handshake++;
        this._timer.clearTimeout(this._mediaDelayTimer);
        this._mediaDelayTimer = 0;
        this._holdBefore = -1;
        this.controller.stopped();
        this._pauseMedia();
        this._synth.pause();
    }

    private _mediaLatency(speed: number): number {
        return this._externalClock ? 0 : this._probeLatencies.get(speed);
    }

    private _onMediaPosition(e: PositionChangedEventArgs): void {
        if (this._holdBefore >= 0) {
            if (e.currentTime < this._holdBefore - 1) {
                // the media's pre-roll: keep the cursor at the start position (§6.1)
                return;
            }
            this._holdBefore = -1;
        }
        (this.positionChanged as EventEmitterOfT<PositionChangedEventArgs>).trigger(e);
    }

    private _onMediaFinished(): void {
        // the media reached the song's end by itself (no range, not looping): finished, and both stop, as today
        (this.finished as EventEmitter).trigger();
        if (this._state === PlayerState.Playing) {
            this._interrupt();
            this._synth.stop();
            this._setState(PlayerState.Paused, true);
        }
    }
```

The speed setter gets the handshake:

```diff
         this._clock.speed = speed;
         this._queueProbe(speed, true);
         this._probeNext();
+        if (this._state === PlayerState.Playing && this._isMixing) {
+            // both at the new speed with its latency: re-sync and settle (§6.2; spike 11)
+            this.controller.speedChanged(speed);
+        }
     }
```

and the one-time MIDI:

```ts
    public playOneTimeMidiFile(midi: MidiFile): void {
        if (!this._isMixing) {
            // the media player's own behavior, as today (§8)
            this._media.playOneTimeMidiFile(midi);
            return;
        }
        // pause both (the app sees Paused); the synth leaves follow mode and plays it on its own clock; the next
        // Play follows the media again through the start handshake (§6.1, spike 7)
        this.pause();
        this._synth.followMedia(false, this._mediaDuration, this._syncPoints);
        this._synth.playOneTimeMidiFile(midi);
    }
```

`destroy()` already calls `_interrupt()`, which now clears the media-delay timer.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaSynthPlayer.Transport.test.ts test/audio/MediaSynthPlayer.Routing.test.ts`
Expected: PASS. If `the-media-end-stops-both-once` sees no `finished`, check that `TestMediaOutput.advance` crosses the
media's end (42000 ms): `BackingTrackPlayer.checkForFinish` fires `finished` once the tick passes the song's end.

- [ ] **Step 5: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform/javascript/MediaSynthPlayer.ts packages/alphatab/test/audio/MediaSynthPlayer.Transport.test.ts
git commit -m "feat(web): combined player start, seek and speed handshakes (#2397)"
git push
```

---

### Task 17: `MediaSynthPlayer` — count-in hand-off (G-5) and the refused-start safety net (R-2)

**Files:**
- Modify: `packages/alphatab/src/platform/javascript/MediaSynthPlayer.ts`
- Create: `packages/alphatab/test/audio/MediaSynthPlayer.CountIn.test.ts`

**Interfaces:**
- Consumes: `IMediaSynth.countInStarted` (Task 5), `IMediaFollowingOutput.countInEnd` (Task 7),
  `MediaSyncController.handOffPlayTime/preRoll/startedAfterHandOff` (Task 10), `MediaSyncConstants` (Task 9),
  `IMediaTimer.spinUntil` (Task 5).
- Produces (used by Tasks 18, 19): `_startPlayback(countIn: boolean)`, `_countIn` (non-null while counting in),
  `_watchMediaStart(delayMs)`, `MediaSynthCountInRecord` entries in `diagnostics.countIns`.

§6.2 count-in: only an app Play from Paused counts in (§6.1). The worker renders one bar and then the song in one
stream (Task 4), while the media waits, paused, at its pre-roll start (60 ms above 1×, 120 ms below, F-14). Once
the boundary chunk is buffered the worklet reports its context frame (Task 7). The media's `play()` is issued at
`frame / sampleRate − (mediaStartLatency(speed) + preRoll / speed)`. **G-5:** the timer fires 12 ms early, then
waits on the audio clock for at most 30 ms (spike 6: `play()` 0.2–4.8 ms after its time). If the hand-off doesn't
come by the count-in's length + 250 ms, the media starts anyway and this player turns media-only. The cursor stays
at the start position. **R-2 safety net** (not spiked; Low): WebKit may refuse a `play()` a bar after the gesture.
If the media isn't running 500 ms after its planned start, both pause and a warning is logged. Decision D-7 (Task 24)
picks the real fallback.

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/MediaSynthPlayer.CountIn.test.ts`:

```ts
/**
 * The count-in hand-off (spec §6.2) and the refused-start safety net (R-2).
 * @target web
 */
import { describe, expect, it } from 'vitest';
import { MediaSynthHarness } from 'test/audio/MediaSyncFakes';

async function countingIn(speed: number = 1, at: number = 5000): Promise<MediaSynthHarness> {
    const h = new MediaSynthHarness();
    await h.loadSong();
    h.player.playbackSpeed = speed;
    h.player.countInVolume = 1;
    h.mediaOutput!.currentTime = at;
    h.player.play();
    return h;
}

describe('MediaSynthPlayerCountInTests', () => {
    it('play-with-count-in-starts-the-synth-alone', async () => {
        const h = await countingIn();
        expect(h.states).toEqual(['Playing']);
        expect(h.synth.calls.slice(-3)).toEqual(['pause', 'seek:5000', 'play:countIn=1']);
        expect(h.synth.countInVolume).toBe(0); // handshakes later in this playback never count in
        expect(h.mediaOutput!.isPlaying).toBe(false);
        expect(h.player.controller.isActive).toBe(false);
    });

    it('no-position-reaches-the-app-during-the-count-in', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        h.player.playbackSpeed = 0.5;
        h.player.countInVolume = 1;
        h.player.timePosition = 10000;
        const start = h.player.timePosition;
        h.positions.length = 0;
        h.player.play(); // the media pre-rolls 120 ms, paused
        expect(h.positions.filter(p => p < start - 1)).toEqual([]);
    });

    it('the-count-in-end-schedules-the-media-start', async () => {
        const h = await countingIn();
        h.synth.startCountIn(2000);
        h.synthOutput.endCountIn(1.5 * 48000); // no learned latency and no pre-roll at 1x: play() at the boundary
        h.timer.advance(1500 - 12 - 1);
        expect(h.mediaOutput!.isPlaying).toBe(false);
        h.timer.advance(2); // fires 12 ms early, then waits on the audio clock
        expect(h.mediaOutput!.isPlaying).toBe(true);
        expect(h.graph.currentTime).toBeGreaterThanOrEqual(1.5);
        expect(h.player.diagnostics.countIns[0].lateMs).toBeLessThan(0.2);
        expect(h.player.controller.isActive).toBe(true);
    });

    it('below-1x-the-media-pre-rolls-120-ms', async () => {
        // F-14 (D-3)
        const h = await countingIn(0.5, 5000);
        expect(h.mediaOutput!.seekTimes[h.mediaOutput!.seekTimes.length - 1]).toBeCloseTo(5000 - 120, 3);
        h.synth.startCountIn(4000);
        h.synthOutput.endCountIn(3 * 48000);
        // play() at the boundary minus the pre-roll in real time: 120 / 0.5 = 240 ms
        h.timer.advance(3000 - 240 - 12 - 1);
        expect(h.mediaOutput!.isPlaying).toBe(false);
        h.timer.advance(2);
        expect(h.mediaOutput!.isPlaying).toBe(true);
        expect(h.graph.currentTime).toBeCloseTo(2.76, 3);
    });

    it('a-refined-count-in-end-moves-the-media-start', async () => {
        const h = await countingIn();
        h.synth.startCountIn(2000);
        h.synthOutput.endCountIn(1.5 * 48000);
        h.synthOutput.endCountIn(1.51 * 48000); // an underrun moved the boundary 10 ms
        h.timer.advance(1490);
        expect(h.mediaOutput!.isPlaying).toBe(true);
        expect(h.graph.currentTime).toBeGreaterThanOrEqual(1.51 - 1e-9);
    });

    it('the-time-limit-starts-the-media-alone', async () => {
        const h = await countingIn();
        h.synth.startCountIn(2000);
        h.timer.advance(2249);
        expect(h.mediaOutput!.isPlaying).toBe(false);
        h.timer.advance(1);
        expect(h.mediaOutput!.isPlaying).toBe(true);
        expect(h.synth.calls[h.synth.calls.length - 1]).toBe('pause');
        // media only from here on
        h.player.pause();
        const plays = h.synth.count('play:');
        h.player.play();
        expect(h.synth.count('play:')).toBe(plays);
    });

    it('pause-during-the-count-in-cancels-the-hand-off', async () => {
        // Review Focus 2
        const h = await countingIn();
        h.synth.startCountIn(2000);
        h.synthOutput.endCountIn(1.5 * 48000);
        h.player.pause();
        h.timer.advance(3000);
        expect(h.mediaOutput!.isPlaying).toBe(false);
        expect(h.timer.pending).toBe(0);
    });

    it('a-seek-during-the-count-in-restarts-without-count-in', async () => {
        // Review Focus 2
        const h = await countingIn();
        h.synth.startCountIn(2000);
        h.player.timePosition = 20000;
        expect(h.states).toEqual(['Playing']);
        expect(h.synth.calls[h.synth.calls.length - 1]).toBe('play:countIn=0');
        expect(h.mediaOutput!.isPlaying).toBe(true);
        h.timer.advance(3000); // the old count-in's timers are gone
        expect(h.timer.pending).toBe(0);
    });

    it('a-media-start-that-never-happens-pauses-both', async () => {
        // R-2 safety net
        const h = await countingIn();
        h.synth.startCountIn(2000);
        h.synthOutput.endCountIn(1.5 * 48000);
        h.timer.advance(1500);
        expect(h.mediaOutput!.isPlaying).toBe(true);
        h.mediaOutput!.isPlaying = false; // the browser refused the delayed play()
        h.timer.advance(600);
        expect(h.states).toEqual(['Playing', 'Paused']);
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaSynthPlayer.CountIn.test.ts`
Expected: FAIL — `play-with-count-in-starts-the-synth-alone` sees `play:countIn=0` and a playing media.

- [ ] **Step 3: Implement**

Import `MediaSyncConstants` (value) from `MediaSyncController`. Add above `MediaSynthPlayer`:

```ts
/**
 * One count-in hand-off in flight.
 * @target web
 * @internal
 */
class CountInHandOff {
    public readonly target: number;
    public readonly speed: number;
    public readonly preRoll: number;
    /** The context time (s) for the media's play(); -1 until the count-in end is known. */
    public playAt: number = -1;
    public handOffTimer: number = 0;
    public limitTimer: number = 0;

    public constructor(target: number, speed: number, preRoll: number) {
        this.target = target;
        this.speed = speed;
        this.preRoll = preRoll;
    }
}
```

Fields and subscriptions:

```ts
    private _countIn: CountInHandOff | null = null;
    private _mediaStartCheckTimer: number = 0;
```

```ts
        // in the constructor, after the mediaTimestamp subscription
        subscribe(this._synthOutput.countInEnd.on(frame => this._onCountInEnd(frame)));
        subscribe(synth.countInStarted.on(lengthMs => this._onCountInStarted(lengthMs)));
```

Only an app Play counts in:

```diff
         this._setState(PlayerState.Playing, false);
-        this._startPlayback();
+        // an app Play from Paused is the only start that counts in (§6.1)
+        this._startPlayback(true);
         return true;
@@
-    private _startPlayback(): void {
+    private _startPlayback(countIn: boolean): void {
@@
         this._sendFollowConfig();
-        this._runStart(this.controller.planStart(this._clock.position, speed, this._mediaLatency(speed)), true);
+        const target = this._clock.position;
+        if (countIn && this._countInVolume > 0) {
+            this._startCountIn(target, speed);
+            return;
+        }
+        this._runStart(this.controller.planStart(target, speed, this._mediaLatency(speed)), true);
     }
@@ (in _seek)
-        this._startPlayback();
+        this._startPlayback(false);
```

`_interrupt` cancels a count-in and the start check:

```diff
         this._timer.clearTimeout(this._mediaDelayTimer);
         this._mediaDelayTimer = 0;
+        this._timer.clearTimeout(this._mediaStartCheckTimer);
+        this._mediaStartCheckTimer = 0;
+        this._cancelCountIn();
         this._holdBefore = -1;
```

A speed change during the count-in waits for the hand-off:

```diff
-        if (this._state === PlayerState.Playing && this._isMixing) {
+        if (this._state === PlayerState.Playing && this._isMixing && !this._countIn) {
```

New methods:

```ts
    private _startCountIn(target: number, speed: number): void {
        const preRoll = MediaSyncController.preRoll(speed, true);
        // the cursor stays at the start position meanwhile
        this._holdBefore = this._media.timePosition;
        this._synth.pause();
        if (preRoll > 0) {
            // the media waits, paused, at its pre-roll start
            this._media.seekMediaTo(target - preRoll);
        }
        this._countIn = new CountInHandOff(target, speed, preRoll);
        this._synth.seekToMediaTime(target);
        this._synth.countInVolume = this._countInVolume;
        this._synth.play();
        // later starts in this playback (a seek, a wrap) never count in
        this._synth.countInVolume = 0;
    }

    private _onCountInStarted(lengthMs: number): void {
        const countIn = this._countIn;
        if (!countIn || countIn.limitTimer !== 0) {
            return;
        }
        countIn.limitTimer = this._timer.setTimeout(
            () => this._onCountInTimeLimit(countIn),
            lengthMs + MediaSyncConstants.CountInTimeLimitExtraMs
        );
    }

    private _onCountInEnd(frame: number): void {
        const countIn = this._countIn;
        if (!countIn) {
            return;
        }
        countIn.playAt = this.controller.handOffPlayTime(frame, this._graph.sampleRate, countIn.speed, countIn.preRoll);
        if (countIn.handOffTimer !== 0) {
            // a refined estimate only moves playAt
            return;
        }
        const waitMs = (countIn.playAt - this._graph.currentTime) * 1000 - MediaSyncConstants.HandOffEarlyMs;
        countIn.handOffTimer = this._timer.setTimeout(() => this._handOff(countIn), Math.max(0, waitMs));
    }

    private _handOff(countIn: CountInHandOff): void {
        if (this._countIn !== countIn) {
            return;
        }
        // the last ms on the audio clock (G-5; spike 6: play() 0.2–4.8 ms after its time)
        this._timer.spinUntil(() => this._graph.currentTime >= countIn.playAt, MediaSyncConstants.HandOffSpinMaxMs);
        this._countIn = null;
        this._timer.clearTimeout(countIn.limitTimer);
        this.diagnostics.countIns.push(
            new MediaSynthCountInRecord(countIn.speed, (this._graph.currentTime - countIn.playAt) * 1000)
        );
        this._playMedia();
        this.controller.startedAfterHandOff(countIn.speed, true);
        this._watchMediaStart(this.controller.mediaStartLatencies.get(countIn.speed) + MediaSyncConstants.MediaStartCheckMs);
    }

    private _onCountInTimeLimit(countIn: CountInHandOff): void {
        if (this._countIn !== countIn) {
            return;
        }
        // the hand-off never came: start the media anyway and play it alone (§6.2)
        this._countIn = null;
        this._timer.clearTimeout(countIn.handOffTimer);
        this._fallBackToMediaOnly('the count-in hand-off never came');
        this._playMedia();
    }

    private _cancelCountIn(): void {
        const countIn = this._countIn;
        if (countIn) {
            this._timer.clearTimeout(countIn.handOffTimer);
            this._timer.clearTimeout(countIn.limitTimer);
            this._countIn = null;
        }
    }

    /**
     * After a delayed media start: check that the media runs.
     */
    private _watchMediaStart(delayMs: number): void {
        this._timer.clearTimeout(this._mediaStartCheckTimer);
        this._mediaStartCheckTimer = this._timer.setTimeout(() => {
            this._mediaStartCheckTimer = 0;
            if (
                this._state !== PlayerState.Playing ||
                !Number.isNaN(this._clock.mediaTimeNow()) ||
                this._clock.isSeeking
            ) {
                return;
            }
            // R-2: the browser refused the media's play(); decision D-7 picks the real fallback
            Logger.warning('Player', 'The media did not start after the count-in; pausing');
            this.pause();
        }, delayMs);
    }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaSynthPlayer.CountIn.test.ts test/audio/MediaSynthPlayer.Transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform/javascript/MediaSynthPlayer.ts packages/alphatab/test/audio/MediaSynthPlayer.CountIn.test.ts
git commit -m "feat(web): count-in hand-off to the media; pause when the media never starts (#2397)"
git push
```

---

### Task 18: `MediaSynthPlayer` — playback range and the loop wrap (G-3)

**Files:**
- Modify: `packages/alphatab/src/platform/javascript/MediaSynthPlayer.ts`
- Create: `packages/alphatab/test/audio/MediaSynthPlayer.Loop.test.ts`

**Interfaces:**
- Consumes: `BackingTrackPlayer.tickToMediaTime` (Task 15), the handshakes (Tasks 16, 17).
- Produces (used by Task 19): `_scheduleWrap(extraDelayMs)`, `_wrapEnd()`, `_onWrapTimer()`, `_wrapTimer`.

§6.2 loop wrap: the combined player owns `playbackRange` and `isLooping`. When no range is set, the song's end
counts as the range end, so `isLooping` alone loops the whole song, as today. Just before the range end it fires
`finished`, pauses both, seeks both to the range start (60 ms earlier at speeds other than 1×, from the start plan)
and restarts them through the start handshake, with no count-in and no `stateChanged`. Spike 4 measured this:
0 missing clicks at 0.5×, 1× and 1.5×, under 15 ms per wrap at 1× and ~24 ms at 0.5× and 1.5×. With `isLooping`
off, the range end fires `finished` and stops both at the range start, as today. **G-3** (spike 4): the timer
fires 15 ms of media time before the end. If the media is behind (a late start), it waits for the media.

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/MediaSynthPlayer.Loop.test.ts`:

```ts
/**
 * The playback range and the loop wrap (spec §6.2).
 * @target web
 */
import { describe, expect, it } from 'vitest';
import { PlaybackRange } from '@coderline/alphatab/synth/PlaybackRange';
import { MediaSynthHarness } from 'test/audio/MediaSyncFakes';

const StartTick = 7680;
const EndTick = 15360;

async function looping(speed: number = 1, loop: boolean = true) {
    const h = new MediaSynthHarness();
    await h.loadSong();
    h.player.playbackSpeed = speed;
    h.player.isLooping = loop;
    const range = new PlaybackRange();
    range.startTick = StartTick;
    range.endTick = EndTick;
    h.player.playbackRange = range;
    return { h, start: h.media.tickToMediaTime(StartTick), end: h.media.tickToMediaTime(EndTick) };
}

/**
 * Time and the media move together, in 10 ms steps.
 */
function run(h: MediaSynthHarness, ms: number) {
    for (let t = 0; t < ms; t += 10) {
        h.timer.advance(10);
        h.mediaOutput!.advance(10);
    }
}

describe('MediaSynthPlayerLoopTests', () => {
    it('setting-a-range-seeks-to-its-start-and-raises-the-event', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        let changed = 0;
        h.player.playbackRangeChanged.on(() => changed++);
        const range = new PlaybackRange();
        range.startTick = StartTick;
        range.endTick = EndTick;
        h.player.playbackRange = range;
        expect(changed).toBe(1);
        expect(h.mediaOutput!.currentTime).toBeCloseTo(h.media.tickToMediaTime(StartTick), 3);
    });

    it('a-wrap-fires-finished-and-restarts-through-the-handshake', async () => {
        const { h, start, end } = await looping();
        h.player.countInVolume = 1;
        h.player.play(); // counts in
        h.synth.startCountIn(2000);
        h.synthOutput.endCountIn(0.5 * 48000);
        h.timer.advance(600);
        const plays = h.synth.count('play:');
        run(h, (end - start) + 100);
        expect(h.finished).toBe(1);
        expect(h.states).toEqual(['Playing']);
        expect(h.synth.count('play:')).toBe(plays + 1);
        expect(h.synth.calls[h.synth.calls.length - 1]).toBe('play:countIn=0');
        expect(h.player.diagnostics.wraps.length).toBe(1);
        expect(h.mediaOutput!.currentTime).toBeLessThan(start + 200);
    });

    it('a-wrap-above-1x-pre-rolls-60-ms', async () => {
        const { h, start, end } = await looping(1.5);
        h.player.play();
        run(h, (end - start) / 1.5 + 100);
        expect(h.finished).toBe(1);
        expect(h.mediaOutput!.seekTimes.some(t => Math.abs(t - (start - 60)) < 0.01)).toBe(true);
    });

    it('the-range-end-without-looping-stops-at-the-range-start', async () => {
        const { h, start, end } = await looping(1, false);
        h.player.play();
        run(h, (end - start) + 100);
        expect(h.finished).toBe(1);
        expect(h.states).toEqual(['Playing', 'Stopped']);
        expect(h.mediaOutput!.currentTime).toBeCloseTo(start, 3);
    });

    it('looping-without-a-range-wraps-at-the-song-end', async () => {
        const h = new MediaSynthHarness();
        await h.loadSong();
        h.player.isLooping = true;
        const songEnd = h.media.tickToMediaTime(h.media.loadedMidiInfo!.endTick);
        h.mediaOutput!.currentTime = songEnd - 300;
        h.player.play();
        run(h, 400);
        expect(h.finished).toBe(1);
        expect(h.states).toEqual(['Playing']);
        expect(h.mediaOutput!.currentTime).toBeLessThan(200);
    });

    it('an-early-timer-waits-for-the-media', async () => {
        const { h, start, end } = await looping();
        h.player.play();
        h.timer.advance((end - start) + 100); // the media hasn't moved (it started late)
        expect(h.finished).toBe(0);
        run(h, (end - start) + 100);
        expect(h.finished).toBe(1);
    });

    it('destroy-clears-the-wrap-timer', async () => {
        // Review Focus 5
        const { h } = await looping();
        h.player.play();
        h.player.destroy();
        expect(h.timer.pending).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaSynthPlayer.Loop.test.ts`
Expected: FAIL — no `finished` at the range end.

- [ ] **Step 3: Implement**

Field: `private _wrapTimer: number = 0;`. `_interrupt` clears it:

```diff
+        this._timer.clearTimeout(this._wrapTimer);
+        this._wrapTimer = 0;
         this._cancelCountIn();
```

Schedule the wrap wherever playback (re)starts or its timing changes:

```diff
@@ _startPlayback (media-only branch)
         if (!this._isMixing) {
             this._playMedia();
+            this._scheduleWrap(0);
             return;
         }
@@ _runStart (inside whenSeeked, after controller.started)
             this.controller.started(plan, learnStartLead);
+            this._scheduleWrap(plan.mediaDelayMs);
         });
@@ _handOff (at the end)
         this._watchMediaStart(this.controller.mediaStartLatencies.get(countIn.speed) + MediaSyncConstants.MediaStartCheckMs);
+        this._scheduleWrap(0);
@@ _onCountInTimeLimit (at the end)
         this._playMedia();
+        this._scheduleWrap(0);
@@ playbackSpeed setter (at the end)
+        if (this._state === PlayerState.Playing) {
+            this._scheduleWrap(0);
+        }
@@ playbackRange setter (after the event)
+        this._scheduleWrap(0);
@@ isLooping setter
         this._isLooping = value;
+        this._scheduleWrap(0);
```

New methods:

```ts
    /**
     * The media time of the end to wrap or stop at, or -1 when the media's own end handles it (no range, no loop).
     */
    private _wrapEnd(): number {
        const range = this._playbackRange;
        if (range) {
            return this._media.tickToMediaTime(range.endTick);
        }
        const info = this._media.loadedMidiInfo;
        if (this._isLooping && info) {
            return this._media.tickToMediaTime(info.endTick);
        }
        return -1;
    }

    private _scheduleWrap(extraDelayMs: number): void {
        this._timer.clearTimeout(this._wrapTimer);
        this._wrapTimer = 0;
        if (this._state !== PlayerState.Playing || this._countIn) {
            return;
        }
        const end = this._wrapEnd();
        if (end < 0) {
            return;
        }
        // G-3 (spike 4): a little before the end
        const untilEndMs = (end - MediaSyncConstants.LoopWrapLeadMs - this._clock.position) / this.playbackSpeed;
        this._wrapTimer = this._timer.setTimeout(() => this._onWrapTimer(), Math.max(0, untilEndMs) + extraDelayMs);
    }

    private _onWrapTimer(): void {
        this._wrapTimer = 0;
        const end = this._wrapEnd();
        if (this._state !== PlayerState.Playing || end < 0) {
            return;
        }
        const remainingMs = (end - MediaSyncConstants.LoopWrapLeadMs - this._clock.position) / this.playbackSpeed;
        if (remainingMs > 5) {
            // the timer fired early or the media started late: wait for the media
            this._wrapTimer = this._timer.setTimeout(() => this._onWrapTimer(), remainingMs);
            return;
        }
        (this.finished as EventEmitter).trigger();
        if (!this._isLooping) {
            // back to the range start, stateChanged(Paused, stopped), as today
            this.stop();
            return;
        }
        this.diagnostics.wraps.push(this._timer.now());
        // pause both, seek both to the range start, restart through the start handshake (§6.2):
        // no count-in, no stateChanged
        this._interrupt();
        const range = this._playbackRange;
        if (range) {
            this._media.tickPosition = range.startTick;
        } else {
            this._media.timePosition = 0;
        }
        this._startPlayback(false);
    }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaSynthPlayer.Loop.test.ts test/audio/MediaSynthPlayer.CountIn.test.ts test/audio/MediaSynthPlayer.Transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform/javascript/MediaSynthPlayer.ts packages/alphatab/test/audio/MediaSynthPlayer.Loop.test.ts
git commit -m "feat(web): combined player owns the playback range and the loop wrap (#2397)"
git push
```

---

### Task 19: `MediaSynthPlayer` — external media (F-5, F-6, F-17)

**Files:**
- Modify: `packages/alphatab/src/platform/javascript/MediaSynthPlayer.ts`
- Create: `packages/alphatab/test/audio/MediaSynthPlayer.External.test.ts`
- Modify: `docs/superpowers/specs/2026-10-07-synth-with-media-design.md` (§1 S10 scope, F-5; §7 the
  `updatePosition()` call, F-6)

**Interfaces:**
- Consumes: `ExternalMediaClock` (`addSample`, `setPlaying`, `notePausedPosition`, `restartFit`, `expectJumpTo`,
  `isStalled`, `movedSincePause`) (Task 11); the handshakes (Tasks 16–18).
- Produces (used by Task 20): the external-media flows below. No new public members.

External media is best-effort (S9). It can't be held, so a seek or a wrap happens while it plays, and its
position arrives through the app's `updatePosition()` calls. Our design's problems, all **(untested)** except
F-17's model:

- **Seek while playing (§6.2):** the synth stays silent until the first update after the jump, then restarts at
  the media's position. There's no count-in and no learning; the settling re-sync locks it.
- **F-5** (library-only; Low): a wrap doesn't pause the media. It seeks to the range start, then does what a seek
  does. S10 is scoped to the backing track.
- **F-6** (alphaTabWebsite; Low): when the position moved since the pause (an update at most 100 ms old), the start
  came from the media's own player. The synth then starts at the media's position, with no count-in and no
  learning.
- **F-17** (alphaTabWebsite; modeled in spike 9 §4; Medium): the same position for 100 ms or more silences the
  synth. On the first update that moves, the fit restarts there and the synth restarts.
- **A media that hasn't started 500 ms after its planned start** (buffering): the synth goes silent and restarts
  once the media moves.

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/MediaSynthPlayer.External.test.ts`:

```ts
/**
 * External media with the combined player (spec §6.2): seeks, wraps, stalls and starts inside the media.
 * @target web
 */
import { describe, expect, it } from 'vitest';
import { PlaybackRange } from '@coderline/alphatab/synth/PlaybackRange';
import { MediaSynthHarness } from 'test/audio/MediaSyncFakes';

async function externalPlaying(): Promise<MediaSynthHarness> {
    const h = new MediaSynthHarness(true);
    await h.loadSong();
    h.report(5000); // the paused media's position
    h.player.play(); // through alphaTab: no movement since the pause
    for (let i = 1; i <= 6; i++) {
        h.timer.advance(50);
        h.report(5000 + i * 50);
    }
    return h;
}

function last(h: MediaSynthHarness): string {
    return h.synth.calls[h.synth.calls.length - 1];
}

describe('MediaSynthPlayerExternalTests', () => {
    it('a-seek-silences-the-synth-until-the-first-update-after-the-jump', async () => {
        const h = await externalPlaying();
        h.player.timePosition = 20000;
        const target = h.media.mediaTimeOfPosition;
        expect(h.handler!.seekTimes[h.handler!.seekTimes.length - 1]).toBeCloseTo(target, 3);
        expect(h.handler!.pauses).toBe(0); // the media can't be held
        expect(last(h)).toBe('pause');
        h.timer.advance(50);
        h.report(5350); // still the position from before the jump
        expect(last(h)).toBe('pause');
        for (let i = 0; i < 3; i++) {
            h.timer.advance(50);
            h.report(target + i * 50);
        }
        expect(last(h)).toBe('play:countIn=0');
        expect(h.synth.lastSeek()).toBeCloseTo(target + 100 + 10, 0); // the media now + the re-sync lead
    });

    it('a-wrap-seeks-without-pausing-the-media', async () => {
        // F-5
        const h = new MediaSynthHarness(true);
        await h.loadSong();
        const range = new PlaybackRange();
        range.startTick = 7680;
        range.endTick = 15360;
        h.player.isLooping = true;
        h.player.playbackRange = range;
        const start = h.media.tickToMediaTime(range.startTick);
        h.report(start);
        h.player.play();
        let position = start;
        for (let guard = 0; h.finished === 0 && guard < 10000; guard++) {
            h.timer.advance(50);
            position += 50;
            h.report(position);
        }
        expect(h.finished).toBe(1);
        expect(h.handler!.pauses).toBe(0);
        expect(h.handler!.seekTimes[h.handler!.seekTimes.length - 1]).toBeCloseTo(start, 3);
        expect(last(h)).toBe('pause');
        for (let i = 0; i < 3; i++) {
            h.timer.advance(50);
            h.report(start + i * 50);
        }
        expect(last(h)).toBe('play:countIn=0');
    });

    it('a-stall-silences-the-synth-and-restarts-it-after', async () => {
        // F-17, spike 9 §4
        const h = await externalPlaying();
        const plays = h.synth.count('play:');
        h.timer.advance(50);
        h.report(5300);
        h.timer.advance(50);
        h.report(5300); // the same position for 100 ms: buffering
        expect(last(h)).toBe('pause');
        for (let i = 1; i <= 3; i++) {
            h.timer.advance(50);
            h.report(5300 + i * 50);
        }
        expect(h.synth.count('play:')).toBe(plays + 1);
    });

    it('a-start-inside-the-media-skips-the-count-in-and-learning', async () => {
        // F-6
        const h = new MediaSynthHarness(true);
        await h.loadSong();
        h.player.countInVolume = 1;
        h.report(1000); // paused at 1000
        h.timer.advance(300);
        h.report(1220); // play pressed inside the video; the app hears of it ~220 ms later
        h.player.play(); // the integration calls api.play() from the media's play event
        expect(h.synth.count('play:')).toBe(0); // waits for the media's clock
        for (let i = 1; i <= 3; i++) {
            h.timer.advance(50);
            h.report(1220 + i * 50);
        }
        expect(h.synth.calls.filter(c => c.startsWith('play:'))).toEqual(['play:countIn=0']);
        expect(h.handler!.plays).toBe(1);
        expect(h.player.controller.startLeads.size).toBe(0);
    });

    it('a-start-through-alphatab-counts-in', async () => {
        const h = new MediaSynthHarness(true);
        await h.loadSong();
        h.player.countInVolume = 1;
        h.report(1000);
        h.player.play();
        expect(last(h)).toBe('play:countIn=1');
        expect(h.handler!.plays).toBe(0); // the media starts at the hand-off
    });

    it('a-media-that-has-not-started-restarts-the-synth-when-it-moves', async () => {
        const h = new MediaSynthHarness(true);
        await h.loadSong();
        h.report(5000);
        h.player.play();
        for (let i = 1; i <= 12; i++) {
            h.timer.advance(50);
            h.report(5000); // buffering
        }
        expect(last(h)).toBe('pause');
        for (let i = 1; i <= 3; i++) {
            h.timer.advance(50);
            h.report(5000 + i * 50);
        }
        expect(last(h)).toBe('play:countIn=0');
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaSynthPlayer.External.test.ts`
Expected: FAIL — e.g. the seek pauses the external media through the backing-track handshake.

- [ ] **Step 3: Implement**

Fields:

```ts
    private _awaitingSynthStart: boolean = false;
    private _stalled: boolean = false;
    private _refitOnMove: boolean = false;
```

Subscribe to the media's position updates (constructor):

```ts
        subscribe((media.output as IBackingTrackSynthOutput).timeUpdate.on(t => this._onMediaTimeUpdate(t)));
```

`_interrupt` resets the external state:

```diff
         this._holdBefore = -1;
+        this._awaitingSynthStart = false;
+        this._stalled = false;
+        this._refitOnMove = false;
         this.controller.stopped();
```

`_startPlayback` — a start inside the media (F-6), after the media-only branch:

```diff
         if (!this._isMixing) {
             this._playMedia();
             this._scheduleWrap(0);
             return;
         }
+        const external = this._externalClock;
+        if (external && external.movedSincePause()) {
+            // F-6: play was pressed inside the media's own player and it already moves:
+            // no count-in, no learning; the synth starts where the media is
+            this._playMedia();
+            this._awaitingSynthStart = true;
+            this._startSynthWhenTheMediaRuns();
+            return;
+        }
         this._sendFollowConfig();
```

`_runStart` watches an external start (inside `whenSeeked`, after `controller.started`):

```diff
             this.controller.started(plan, learnStartLead);
             this._scheduleWrap(plan.mediaDelayMs);
+            if (this._externalClock) {
+                this._watchMediaStart(
+                    plan.mediaDelayMs + this.controller.mediaStartLatencies.get(plan.speed) + MediaSyncConstants.MediaStartCheckMs
+                );
+            }
         });
```

`_watchMediaStart` — external media restarts the synth when it moves, instead of pausing:

```diff
                 return;
             }
+            if (this._externalClock) {
+                // the video buffers: the synth restarts at the media's position once it moves (§6.2)
+                this._silenceUntilTheMediaMoves();
+                return;
+            }
             // R-2: the browser refused the media's play(); decision D-7 picks the real fallback
```

`_seek` — external media jumps while it plays; a paused seek is not a start:

```ts
    private _seek(apply: () => void): void {
        if (this._state !== PlayerState.Playing) {
            apply();
            this._externalClock?.notePausedPosition(this._media.mediaTimeOfPosition);
            return;
        }
        if (this._externalClock && !this._countIn) {
            // external media can't be held: it jumps while playing, the synth waits for it (§6.2)
            this._timer.clearTimeout(this._wrapTimer);
            this._wrapTimer = 0;
            apply();
            this._jumpExternal(this._media.mediaTimeOfPosition);
            return;
        }
        // pause both, seek, restart through the start handshake: no count-in, no stateChanged (§6.2)
        this._interrupt();
        apply();
        this._startPlayback(false);
    }
```

`_onWrapTimer` — F-5, before the backing-track wrap:

```diff
         this.diagnostics.wraps.push(this._timer.now());
+        const range = this._playbackRange;
+        if (this._externalClock) {
+            // F-5: external media wraps without pausing: seek it, the synth waits for the first update after
+            const start = range ? this._media.tickToMediaTime(range.startTick) : 0;
+            this._media.seekMediaTo(start);
+            this._jumpExternal(start);
+            return;
+        }
         // pause both, seek both to the range start, restart through the start handshake (§6.2):
         // no count-in, no stateChanged
         this._interrupt();
-        const range = this._playbackRange;
         if (range) {
```

Speed change — the fit is at the old rate:

```diff
         if (this._state === PlayerState.Playing && this._isMixing && !this._countIn) {
+            // the fitted line is at the old rate
+            this._externalClock?.restartFit();
             // both at the new speed with its latency: re-sync and settle (§6.2; spike 11)
             this.controller.speedChanged(speed);
         }
```

New methods:

```ts
    private _onMediaTimeUpdate(position: number): void {
        const clock = this._externalClock;
        if (!clock) {
            return;
        }
        if (this._refitOnMove && position !== clock.position) {
            // the media moves (again): fit from here; a fit across a stall re-syncs twice (spike 9 §4)
            this._refitOnMove = false;
            this._stalled = false;
            clock.restartFit();
        }
        clock.addSample(position);
        if (this._mediaStartCheckTimer !== 0 && !Number.isNaN(clock.mediaTimeNow())) {
            // the media runs: its start needs no more checking
            this._timer.clearTimeout(this._mediaStartCheckTimer);
            this._mediaStartCheckTimer = 0;
        }
        if (this._state !== PlayerState.Playing || !this._isMixing || this._countIn) {
            return;
        }
        if (!this._stalled && !this._awaitingSynthStart && clock.isStalled) {
            // F-17: the media stalls (buffering): silence the synth until it moves again
            this._stalled = true;
            this._silenceUntilTheMediaMoves();
            return;
        }
        this._startSynthWhenTheMediaRuns();
    }

    private _startSynthWhenTheMediaRuns(): void {
        if (!this._awaitingSynthStart || this._stalled || Number.isNaN(this._clock.mediaTimeNow())) {
            return;
        }
        this._awaitingSynthStart = false;
        // started by the media, or after an external seek, wrap or stall: no count-in, no learning; the synth starts
        // where the media is and the settling re-sync locks it (§6.2)
        this._sendFollowConfig();
        this.controller.startedAfterHandOff(this.playbackSpeed, false);
        this._synth.pause();
        this.controller.resync();
        this._synth.play();
        this._scheduleWrap(0);
    }

    private _jumpExternal(target: number): void {
        this.controller.stopped();
        this._synth.pause();
        this._externalClock!.expectJumpTo(target);
        this._awaitingSynthStart = true;
    }

    private _silenceUntilTheMediaMoves(): void {
        this.controller.stopped();
        this._synth.pause();
        this._awaitingSynthStart = true;
        this._refitOnMove = true;
    }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaSynthPlayer.External.test.ts` and then all `MediaSynthPlayer.*` tests.
Expected: PASS.

- [ ] **Step 5: Update the spec (F-5, F-6)**

§1, row S10, add at the end of the criterion cell: "Backing track only: external media wraps without pausing and
stays best-effort (S9)."

§7, after the paragraph that starts "External media: hide the player's own controls", add:

> If your integration starts alphaTab from the media's own play event (for example YouTube's `PLAYING` state),
> call `updatePosition()` right before `api.play()`: alphaTab then sees that the media already moves and starts
> the synthesizer at its position, with no count-in (F-6).

- [ ] **Step 6: Run the repo gates and commit**

```bash
npm run lint && npm run typecheck && npm test
git add packages/alphatab/src/platform/javascript/MediaSynthPlayer.ts packages/alphatab/test/audio/MediaSynthPlayer.External.test.ts docs/superpowers/specs/2026-10-07-synth-with-media-design.md
git commit -m "feat(web): external media seeks, wraps, stalls and starts inside the media (#2397, F-5, F-6, F-17)"
git push
```

---

### Task 20: Settings and wiring

**Files:**
- Modify: `packages/alphatab/src/PlayerSettings.ts`
- Regenerate: `packages/alphatab/src/generated/*` (`npm run generate-typescript`)
- Modify: `packages/alphatab/src/platform/IUiFacade.ts`
- Modify: `packages/alphatab/test/visualTests/TestUiFacade.ts`
- Modify: `packages/alphatab/src/platform/javascript/BrowserUiFacade.ts`
- Modify: `packages/alphatab/src/AlphaTabApiBase.ts` (`_setupOrDestroyPlayer`)
- Create: `packages/alphatab/test/audio/MediaSynthWiring.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces (used by Tasks 21–27): `PlayerSettings.enableSynthesizerWithMedia`,
  `PlayerSettings.mediaSyncOffsetInMilliseconds`, `IUiFacade.createMediaSynthPlayer(mode: PlayerMode): IAlphaSynth | null`,
  the combined player in the browser.

§7 wiring: when the resolved mode is `EnabledBackingTrack` or `EnabledExternalMedia` and the switch is on,
`_setupOrDestroyPlayer` asks `uiFacade.createMediaSynthPlayer(mode)`. Web returns a `MediaSynthPlayer`; other
platforms return null and get today's media-only player. Web also returns null, and logs a warning, when
`outputMode` isn't `WebAudioAudioWorklets` or AudioWorklets are unavailable (no `AudioWorkletNode`, or not a secure
context). The player is also recreated when the switch changes through `updateSettings()` (Review Focus 4). With
the switch off nothing changes (S7).

- [ ] **Step 1: Write the failing tests**

Create `packages/alphatab/test/audio/MediaSynthWiring.test.ts`:

```ts
/**
 * Creating the combined player from the settings (spec §7).
 * @target web
 */
import { describe, expect, it } from 'vitest';
import { AlphaTabApiBase } from '@coderline/alphatab/AlphaTabApiBase';
import { PlayerMode } from '@coderline/alphatab/PlayerSettings';
import { Settings } from '@coderline/alphatab/Settings';
import { AlphaSynth } from '@coderline/alphatab/synth/AlphaSynth';
import type { AlphaSynthWrapper } from '@coderline/alphatab/synth/AlphaSynthWrapper';
import { BackingTrackPlayer } from '@coderline/alphatab/synth/BackingTrackPlayer';
import { ExternalMediaPlayer } from '@coderline/alphatab/synth/ExternalMediaPlayer';
import type { IAlphaSynth } from '@coderline/alphatab/synth/IAlphaSynth';
import { TestMediaOutput } from 'test/audio/TestMediaOutput';
import { TestOutput } from 'test/audio/TestOutput';
import { TestUiFacade } from '../visualTests/TestUiFacade';

class MixingTestUiFacade extends TestUiFacade {
    public readonly mediaSynthCalls: PlayerMode[] = [];
    public mediaSynthResult: (() => IAlphaSynth | null) = () => null;
    public backingTrackCalls: number = 0;

    public override createMediaSynthPlayer(mode: PlayerMode): IAlphaSynth | null {
        this.mediaSynthCalls.push(mode);
        return this.mediaSynthResult();
    }

    public override createBackingTrackPlayer(): IAlphaSynth | null {
        this.backingTrackCalls++;
        return new BackingTrackPlayer(new TestMediaOutput(), 500);
    }
}

function createApi(mode: PlayerMode, mixing: boolean, facade: MixingTestUiFacade): AlphaTabApiBase<unknown> {
    const settings = new Settings();
    settings.player.playerMode = mode;
    settings.player.enableSynthesizerWithMedia = mixing;
    return new AlphaTabApiBase<unknown>(facade, settings);
}

function instanceOf(api: AlphaTabApiBase<unknown>): IAlphaSynth | undefined {
    return (api.player as AlphaSynthWrapper | null)?.instance;
}

describe('MediaSynthWiringTests', () => {
    it('settings-default-off-and-read-from-json', () => {
        const settings = new Settings();
        expect(settings.player.enableSynthesizerWithMedia).toBe(false);
        expect(settings.player.mediaSyncOffsetInMilliseconds).toBe(0);
        settings.fillFromJson({ player: { enableSynthesizerWithMedia: true, mediaSyncOffsetInMilliseconds: 25 } });
        expect(settings.player.enableSynthesizerWithMedia).toBe(true);
        expect(settings.player.mediaSyncOffsetInMilliseconds).toBe(25);
    });

    it('mixing-on-asks-for-a-combined-player', () => {
        const facade = new MixingTestUiFacade();
        const combined = new AlphaSynth(new TestOutput(), 500);
        facade.mediaSynthResult = () => combined;
        const api = createApi(PlayerMode.EnabledBackingTrack, true, facade);
        expect(facade.mediaSynthCalls).toEqual([PlayerMode.EnabledBackingTrack]);
        expect(facade.backingTrackCalls).toBe(0);
        expect(instanceOf(api)).toBe(combined);
        api.destroy();
    });

    it('no-combined-player-falls-back-to-the-media-player', () => {
        const facade = new MixingTestUiFacade();
        const api = createApi(PlayerMode.EnabledBackingTrack, true, facade);
        expect(facade.mediaSynthCalls.length).toBe(1);
        expect(instanceOf(api)).toBeInstanceOf(BackingTrackPlayer);
        api.destroy();
    });

    it('external-media-asks-too-and-falls-back', () => {
        const facade = new MixingTestUiFacade();
        const api = createApi(PlayerMode.EnabledExternalMedia, true, facade);
        expect(facade.mediaSynthCalls).toEqual([PlayerMode.EnabledExternalMedia]);
        expect(instanceOf(api)).toBeInstanceOf(ExternalMediaPlayer);
        api.destroy();
    });

    it('mixing-off-changes-nothing', () => {
        // S7
        const facade = new MixingTestUiFacade();
        const api = createApi(PlayerMode.EnabledBackingTrack, false, facade);
        expect(facade.mediaSynthCalls).toEqual([]);
        expect(facade.backingTrackCalls).toBe(1);
        api.destroy();
    });

    it('synthesizer-mode-ignores-the-switch', () => {
        const facade = new MixingTestUiFacade();
        const api = createApi(PlayerMode.EnabledSynthesizer, true, facade);
        expect(facade.mediaSynthCalls).toEqual([]);
        api.destroy();
    });

    it('flag-change-recreates-the-player', () => {
        // Review Focus 4
        const facade = new MixingTestUiFacade();
        facade.mediaSynthResult = () => new AlphaSynth(new TestOutput(), 500);
        const api = createApi(PlayerMode.EnabledBackingTrack, false, facade);
        expect(facade.backingTrackCalls).toBe(1);

        api.settings.player.enableSynthesizerWithMedia = true;
        api.updateSettings();
        expect(facade.mediaSynthCalls.length).toBe(1);

        api.updateSettings(); // unchanged: no new player
        expect(facade.mediaSynthCalls.length).toBe(1);

        api.settings.player.enableSynthesizerWithMedia = false;
        api.updateSettings();
        expect(facade.backingTrackCalls).toBe(2);
        api.destroy();
    });

    it('wrapper-restores-media-volumes', () => {
        // Review Focus 4
        const facade = new MixingTestUiFacade();
        const combined = new AlphaSynth(new TestOutput(), 500);
        facade.mediaSynthResult = () => combined;
        const api = createApi(PlayerMode.EnabledBackingTrack, false, facade);
        api.backingTrackVolume = 0.4;
        api.synthVolume = 1.5;
        api.settings.player.enableSynthesizerWithMedia = true;
        api.updateSettings();
        expect(combined.backingTrackVolume).toBeCloseTo(0.4, 9);
        expect(combined.synthVolume).toBeCloseTo(1.5, 9);
        api.destroy();
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/audio/MediaSynthWiring.test.ts`
Expected: FAIL — `enableSynthesizerWithMedia` doesn't exist.

- [ ] **Step 3: The settings**

`PlayerSettings.ts`, after `bufferTimeInMilliseconds`:

```ts
    /**
     * Whether the synthesizer plays along a backing track or external media.
     * @since 1.9.0
     * @defaultValue `false`
     * @category Player
     * @remarks
     * With {@link playerMode} resolving to {@link PlayerMode.EnabledBackingTrack} or
     * {@link PlayerMode.EnabledExternalMedia}, alphaTab also runs its synthesizer, locked to the media: the
     * metronome, the count-in and the score's tracks (use the track mute, solo and volume to choose what plays).
     * The media stays the time source. Balance the two with `api.backingTrackVolume` and `api.synthVolume`.
     *
     * Needs {@link outputMode} {@link PlayerOutputMode.WebAudioAudioWorklets} and a browser with AudioWorklets (a
     * secure context); otherwise the media plays alone and a warning is logged. Web only: other platforms play the
     * media alone.
     *
     * External media is best-effort: tune {@link mediaSyncOffsetInMilliseconds} by ear. Hide the external player's
     * own controls (YouTube: `controls: 0`, `disablekb: 1`) so starts go through your Play button and keep their
     * count-in. If your integration starts alphaTab from the media's own play event, call `updatePosition()` right
     * before `api.play()`: alphaTab then starts the synthesizer where the media already is, without a count-in.
     */
    public enableSynthesizerWithMedia: boolean = false;

    /**
     * A manual correction of the synthesizer against the media, in milliseconds.
     * @since 1.9.0
     * @defaultValue `0`
     * @category Player
     * @remarks
     * Positive values make the synthesizer play later, negative values earlier, in milliseconds of real time at any
     * playback speed. Use it for output paths alphaTab can't measure, like Bluetooth headphones or an external
     * media player. Only used with {@link enableSynthesizerWithMedia}.
     */
    public mediaSyncOffsetInMilliseconds: number = 0;
```

Then regenerate the JSON types and serializers:

```bash
npm run generate-typescript
```

Expected: `packages/alphatab/src/generated/PlayerSettingsJson.ts` and the serializer gain both members.

- [ ] **Step 4: The UI facade member**

`IUiFacade.ts`, after `createBackingTrackPlayer()`:

```ts
    /**
     * Tells the UI layer to create a player that runs the synthesizer along a backing track or external media
     * ({@link PlayerSettings.enableSynthesizerWithMedia}).
     * @param mode {@link PlayerMode.EnabledBackingTrack} or {@link PlayerMode.EnabledExternalMedia}.
     * @returns The player, or null when this platform can't mix (the media then plays alone).
     */
    createMediaSynthPlayer(mode: PlayerMode): IAlphaSynth | null;
```

`TestUiFacade.ts`:

```ts
    public createMediaSynthPlayer(_mode: PlayerMode): IAlphaSynth | null {
        return null;
    }
```

- [ ] **Step 5: The wiring in `AlphaTabApiBase`**

```diff
     private _actualPlayerMode: PlayerMode = PlayerMode.Disabled;
+    private _actualMixing: boolean = false;
@@ _setupOrDestroyPlayer
         let newPlayer: IAlphaSynth | null = null;
-        if (mode !== this._actualPlayerMode) {
+        // the synthesizer along a backing track or external media (§7); recreated when the switch changes
+        const mixing =
+            this.settings.player.enableSynthesizerWithMedia &&
+            (mode === PlayerMode.EnabledBackingTrack || mode === PlayerMode.EnabledExternalMedia);
+        if (mode !== this._actualPlayerMode || mixing !== this._actualMixing) {
             this._destroyPlayer();
             this._updateCursors();
@@
                 case PlayerMode.EnabledBackingTrack:
-                    newPlayer = this.uiFacade.createBackingTrackPlayer();
+                    newPlayer =
+                        (mixing ? this.uiFacade.createMediaSynthPlayer(mode) : null) ??
+                        this.uiFacade.createBackingTrackPlayer();
                     break;
                 case PlayerMode.EnabledExternalMedia:
-                    newPlayer = new ExternalMediaPlayer(this.settings.player.bufferTimeInMilliseconds);
+                    newPlayer =
+                        (mixing ? this.uiFacade.createMediaSynthPlayer(mode) : null) ??
+                        new ExternalMediaPlayer(this.settings.player.bufferTimeInMilliseconds);
                     break;
@@
         this._actualPlayerMode = mode;
+        this._actualMixing = mixing;
```

- [ ] **Step 6: The browser's combined player**

`BrowserUiFacade.ts`:

```ts
    /**
     * The synthesizer along a backing track or external media (spec §7). Null (the media plays alone) when
     * AudioWorklets can't be used.
     */
    public createMediaSynthPlayer(mode: PlayerMode): IAlphaSynth | null {
        const settings = this._api.settings;
        const supportsAudioWorklets: boolean = window.isSecureContext && 'AudioWorkletNode' in window;
        if (settings.player.outputMode !== PlayerOutputMode.WebAudioAudioWorklets || !supportsAudioWorklets) {
            Logger.warning(
                'Player',
                'Mixing the synthesizer with media needs AudioWorklets (PlayerOutputMode.WebAudioAudioWorklets in a secure context); playing the media only'
            );
            return null;
        }
        // created first: when it fails no media player (and no <audio>) is left behind
        const synth = this.createWorkerPlayer() as AlphaSynthWebWorkerApi | null;
        if (!synth) {
            Logger.warning('Player', 'The synthesizer could not be created; playing the media only');
            return null;
        }
        const synthOutput = synth.output as AlphaSynthAudioWorkletOutput;
        const context = synthOutput.audioContext!;
        const graph = new WebAudioMixGraph(context);
        synthOutput.destinationNode = graph.synthInput;
        synth.mediaSampleOutput = synthOutput;
        const offset = () => settings.player.mediaSyncOffsetInMilliseconds;

        const parts = new MediaSynthPlayerParts();
        parts.synth = synth;
        parts.synthOutput = synthOutput;
        parts.graph = graph;
        parts.timer = new BrowserMediaTimer();
        parts.hasSoundFont = !!settings.player.soundFont;
        parts.probeLatencies = MediaLatencyProbe.cache;
        if (mode === PlayerMode.EnabledExternalMedia) {
            const clock = new ExternalMediaClock(graph, offset);
            parts.media = new ExternalMediaPlayer(settings.player.bufferTimeInMilliseconds);
            parts.clock = clock;
            parts.externalClock = clock;
        } else {
            const media = this.createBackingTrackPlayer() as BackingTrackPlayer;
            const element = (media.output as AudioElementBackingTrackSynthOutput).audioElement;
            graph.connectMediaElement(element);
            parts.media = media;
            parts.clock = new BackingTrackMediaClock(
                new AudioElementClockSource(element, context),
                MediaLatencyProbe.cache,
                offset
            );
            parts.probe = new MediaLatencyProbe(context, () =>
                BrowserUiFacade.createAlphaSynthAudioWorklet(context, settings)
            );
        }
        return new MediaSynthPlayer(parts);
    }
```

Imports: `PlayerMode` (next to `PlayerOutputMode`), `ExternalMediaPlayer`, `WebAudioMixGraph`,
`MediaSynthPlayer, MediaSynthPlayerParts`, `BackingTrackMediaClock, AudioElementClockSource, ExternalMediaClock`,
`MediaLatencyProbe`, `BrowserMediaTimer`; `AlphaSynthAudioWorkletOutput`, `AlphaSynthWebWorkerApi`,
`AudioElementBackingTrackSynthOutput` and `BackingTrackPlayer` are imported already. Remove nothing else.

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run test/audio/MediaSynthWiring.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 8: Run the repo gates, build, and commit**

```bash
npm run lint && npm run typecheck && npm test
npm run build
git add packages/alphatab/src packages/alphatab/test/audio/MediaSynthWiring.test.ts packages/alphatab/test/visualTests/TestUiFacade.ts
git commit -m "feat: enableSynthesizerWithMedia and mediaSyncOffsetInMilliseconds; create the combined player (#2397)"
git push
```

`npm run build` must pass: it bundles the worklet module too, and Task 12 registered the probe tap in it.

---

## Phase 5 — Verification

### Task 21: The sync lab (playground demo), with the speed-change tests (F-9d) and the F-3 tolerance

**Files:**
- Create: `packages/playground/demos/sync-lab/index.html`
- Create: `packages/playground/demos/sync-lab/index.ts`

**Interfaces:**
- Consumes: `MediaSynthPlayer.diagnostics` and `controller` (Task 15), `MediaLatencyProbe` (Task 12),
  `MediaSyncConstants` (Task 9), the public API.
- Produces (used by Tasks 22–24): `http://localhost:5188/demos/sync-lab/` with `window.syncLab` (the tests below,
  `results`, `created`).

§9: the spike's measurement page, cleaned up and moved onto the real player. It doesn't carry the spike's modes.
It reads the player through the `@internal` diagnostics only (§3). The default file is the repo's
`syncpoints-testfile.gp` (the spike used a local file). `?file=` loads another one, and `?mixing=0` is the S7 check.
New compared with the spike:

- the real count-in;
- the F-9d tests: an auto-BPM loop, a held sweep, a first Play at an unprobed speed;
- a probe value landing mid-playback (D-1);
- the count-in pre-roll comparison (D-3);
- the 1 s vs 4 s probe comparison (§6.4);
- the S4 tolerance derived from `baseLatency` (F-3).

- [ ] **Step 1: The page**

Create `packages/playground/demos/sync-lab/index.html`:

```html
<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>alphaTab — Sync lab (#2397)</title>
        <link rel="stylesheet" href="../../src/styles/common.css" />
        <style>
            body { margin: 0; font-family: system-ui, sans-serif; }
            .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 8px; border-bottom: 1px solid #ddd; }
            .bar select, .bar button { font-size: 14px; }
            pre { margin: 0; padding: 8px; max-height: 30vh; overflow: auto; background: #f6f6f6; font-size: 12px; }
            .at-viewport { height: 55vh; overflow: auto; }
            body.dragging { outline: 4px dashed #2a7; outline-offset: -8px; }
        </style>
    </head>
    <body>
        <div class="bar">
            <strong>Sync lab #2397</strong>
            <label title="or drop a .gp file anywhere on the page">File <input type="file" id="fileInput" accept=".gp,.gpx" /></label>
            <em id="fileName"></em>
            <label>Audio
                <select id="src">
                    <option value="beeps">generated beeps (measure)</option>
                    <option value="mp3">the file's audio (listen)</option>
                </select>
            </label>
            <label><input type="checkbox" id="listen" checked /> sound on</label>
            <button id="play">Play / Pause</button>
            <label><input type="checkbox" id="metronome" checked /> metronome</label>
            <label>Metronome vol <input type="range" id="metronomeVol" min="0" max="3" step="0.1" value="1" /></label>
            <label><input type="checkbox" id="drums" /> synth tracks</label>
            <label>Speed
                <select id="speed">
                    <option>0.25</option>
                    <option>0.5</option>
                    <option>0.75</option>
                    <option selected>1</option>
                    <option>1.25</option>
                    <option>1.5</option>
                    <option>2</option>
                </select>
            </label>
            <label>Backing track vol <input type="range" id="mediaVol" min="0" max="1" step="0.05" value="1" /></label>
            <label>Synth vol <input type="range" id="synthVol" min="0" max="3" step="0.1" value="1" /></label>
            <button id="measure">Run measurement</button>
        </div>
        <div class="bar" id="live" style="font-family: ui-monospace, monospace; font-size: 13px;">live: —</div>
        <pre id="log">loading…</pre>
        <div class="at-viewport"><div class="at-canvas"></div></div>
        <script type="module" src="./index.ts"></script>
    </body>
</html>
```

- [ ] **Step 2: The lab**

Create `packages/playground/demos/sync-lab/index.ts`:

```ts
// Sync lab (CoderLine/alphaTab#2397): measures the synthesizer against a backing track (spec §9).
//
// URL params: ?src=beeps|mp3 &listen=0|1 &mixing=0|1 &file=/test-data/audio/syncpoints-testfile.gp
//   src=beeps  the file's backing track is replaced by a 2 kHz beep on every beat (from the file's own sync points);
//              the synth plays the metronome. Two taps record every beep (media) and every click (synth) on the
//              AudioContext's clock, so click - beep is the audible offset.
//   mixing=0   the S7 check: the same page with enableSynthesizerWithMedia off.
// Every test logs its result and keeps it in window.syncLab.results.
import * as alphaTab from '@coderline/alphatab';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { BrowserUiFacade } from '@coderline/alphatab/platform/javascript/BrowserUiFacade';
import { MediaLatencyProbe } from '@coderline/alphatab/platform/javascript/MediaLatencyProbe';
import { MediaSyncConstants } from '@coderline/alphatab/platform/javascript/MediaSyncController';
import type { MediaSynthPlayer } from '@coderline/alphatab/platform/javascript/MediaSynthPlayer';
import type { IAudioSampleSynthesizer } from '@coderline/alphatab/synth/IAudioSampleSynthesizer';
import { MidiFileSequencer } from '@coderline/alphatab/synth/MidiFileSequencer';
import type { SynthEvent } from '@coderline/alphatab/synth/synthesis/SynthEvent';
import { Paths } from '../../src/util/Paths';

const params = new URL(window.location.href).searchParams;
const src = params.get('src') ?? 'beeps';
const mixing = params.get('mixing') !== '0';
const file = params.get('file') ?? '/test-data/audio/syncpoints-testfile.gp';
const results: { name: string; value: unknown; at: string }[] = [];

const logEl = document.getElementById('log')!;
function log(...args: unknown[]) {
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    logEl.textContent = `${logEl.textContent === 'loading…' ? '' : `${logEl.textContent}\n`}${line}`;
    logEl.scrollTop = logEl.scrollHeight;
    console.log('[sync-lab]', line);
}
function record(name: string, value: unknown) {
    results.push({ name, value, at: new Date().toISOString() });
    log({ [name]: value });
}

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
(document.getElementById('src') as HTMLSelectElement).value = src;
input('listen').checked = params.get('listen') !== '0';
input('drums').checked = params.has('drums') ? params.get('drums') === '1' : src === 'mp3';
input('metronome').checked = params.get('metronome') !== '0';
document.getElementById('src')!.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('src', (document.getElementById('src') as HTMLSelectElement).value);
    window.location.href = url.toString();
});

// ---- S7: count what the player creates (before the API exists) ----
const created = { synthWorkers: 0, synthWorklets: 0 };
const createSynthWorker = BrowserUiFacade.createAlphaSynthWebWorker;
BrowserUiFacade.createAlphaSynthWebWorker = s => {
    created.synthWorkers++;
    return createSynthWorker(s);
};
const NativeWorkletNode = window.AudioWorkletNode;
(window as unknown as { AudioWorkletNode: typeof AudioWorkletNode }).AudioWorkletNode = class extends NativeWorkletNode {
    public constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        if (name === 'alphatab') {
            created.synthWorklets++;
        }
    }
};

class SilentSynth implements IAudioSampleSynthesizer {
    public masterVolume = 0;
    public metronomeVolume = 0;
    public outSampleRate = 44100;
    public currentTempo = 120;
    public timeSignatureNumerator = 4;
    public timeSignatureDenominator = 4;
    public activeVoiceCount = 0;
    public noteOffAll(): void {}
    public resetSoft(): void {}
    public resetPresets(): void {}
    public loadPresets(): void {}
    public setupMetronomeChannel(): void {}
    public synthesizeSilent(): void {}
    public dispatchEvent(_e: SynthEvent): void {}
    public synthesize(): SynthEvent[] {
        return [];
    }
    public applyTranspositionPitches(): void {}
    public setChannelTranspositionPitch(): void {}
    public channelSetMute(): void {}
    public channelSetSolo(): void {}
    public resetChannelStates(): void {}
    public channelSetMixVolume(): void {}
    public hasSamplesForProgram(): boolean {
        return true;
    }
    public hasSamplesForPercussion(): boolean {
        return true;
    }
}

function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const w = (o: number, s: string) => {
        for (let i = 0; i < s.length; i++) {
            v.setUint8(o + i, s.charCodeAt(i));
        }
    };
    w(0, 'RIFF');
    v.setUint32(4, 36 + pcm.length * 2, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, pcm.length * 2, true);
    new Int16Array(buf, 44).set(pcm);
    return new Uint8Array(buf);
}

async function mediaDuration(bytes: Uint8Array): Promise<number> {
    const el = new Audio(URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>])));
    await new Promise(r => el.addEventListener('loadedmetadata', r, { once: true }));
    return el.duration * 1000;
}

const settings = new alphaTab.Settings();
settings.fillFromJson({
    core: { fontDirectory: Paths.fontDirectory, logLevel: 'warning' },
    player: {
        playerMode: alphaTab.PlayerMode.EnabledBackingTrack,
        enableSynthesizerWithMedia: mixing,
        soundFont: Paths.soundFont,
        scrollMode: alphaTab.ScrollMode.Off
    }
} satisfies alphaTab.json.SettingsJson);

// conversions media time <-> alphaTab time (the same sync points as the player)
let sequencer!: MidiFileSequencer;
let durationMs = 0;
let beatMediaTimes: number[] = [];

async function prepareScore(bytes: Uint8Array, name: string): Promise<alphaTab.model.Score | null> {
    let score: alphaTab.model.Score;
    try {
        score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
    } catch (e) {
        log(`${name}: could not load (${(e as Error).message})`);
        return null;
    }
    const audio = score.backingTrack?.rawAudioFile;
    if (!audio) {
        log(`${name}: no embedded audio track. The lab needs a Guitar Pro file with an audio track and sync points.`);
        return null;
    }
    durationMs = await mediaDuration(audio);
    const midi = new MidiFile();
    const generator = new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(midi));
    generator.generate();
    sequencer = new MidiFileSequencer(new SilentSynth());
    sequencer.loadMidi(midi);
    sequencer.mainUpdateSyncPoints(generator.syncPoints);
    const metronome = (sequencer as unknown as { _mainState: { synthData: SynthEvent[] } })._mainState.synthData.filter(
        e => e.isMetronome
    );
    beatMediaTimes = metronome.map(e => sequencer.mainTickToMediaTime(e.event.tick, durationMs));
    if (src === 'beeps') {
        const rate = 48000;
        const pcm = new Int16Array(Math.ceil((durationMs / 1000) * rate));
        const beepFrames = Math.round(rate * 0.003);
        for (const t of beatMediaTimes) {
            const start = Math.round((t / 1000) * rate);
            for (let i = 0; i < beepFrames && start + i < pcm.length; i++) {
                pcm[start + i] = Math.round(Math.sin((2 * Math.PI * 2000 * i) / rate) * 0.6 * 32767);
            }
        }
        score.backingTrack!.rawAudioFile = encodeWav(pcm, rate);
    }
    log(
        `file=${name} src=${src} mixing=${mixing} duration=${(durationMs / 1000).toFixed(2)}s beats=${beatMediaTimes.length} syncPoints=${generator.syncPoints.length}`
    );
    return score;
}

const fileNameEl = document.getElementById('fileName')!;
let pendingFileName = '';
async function loadBytes(bytes: Uint8Array, name: string) {
    const score = await prepareScore(bytes, name);
    if (!score) {
        return;
    }
    api.stop();
    tapOnsets.media.length = 0;
    tapOnsets.synth.length = 0;
    pendingFileName = name;
    fileNameEl.textContent = `${name} — loading, wait for "player ready"…`;
    api.renderScore(
        score,
        score.tracks.map(t => t.index)
    );
}

document.getElementById('fileInput')!.addEventListener('change', async e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) {
        await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name);
    }
});
window.addEventListener('dragover', e => {
    e.preventDefault();
    document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
window.addEventListener('drop', async e => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const f = e.dataTransfer?.files?.[0];
    if (f) {
        await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name);
    }
});

const api = new alphaTab.AlphaTabApi(document.querySelector('.at-canvas') as HTMLElement, settings);
(window as unknown as { api: unknown }).api = api;

function mediaSynth(): MediaSynthPlayer {
    const instance = (api.player as unknown as { instance?: unknown } | null)?.instance as MediaSynthPlayer | undefined;
    if (!instance?.diagnostics) {
        throw new Error('no MediaSynthPlayer: mixing is off or not supported in this browser');
    }
    return instance;
}
const lab = () => mediaSynth().diagnostics;
const ctx = () => lab().audioContext!;

// ---- taps ----
const tapOnsets = { media: [] as number[], synth: [] as number[] };
const tapPeaks = { media: 0, synth: 0 };
const tapCode = `
class LabTap extends AudioWorkletProcessor {
    constructor(o) {
        super();
        this.threshold = o.processorOptions.threshold;
        this.cool = 0;
        this.coolFrames = Math.round(sampleRate * 0.1);
        this.peak = 0;
        this.sincePeak = 0;
    }
    process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) {
            for (let i = 0; i < ch.length; i++) {
                const v = Math.abs(ch[i]);
                if (v > this.peak) this.peak = v;
                if (this.cool > 0) { this.cool--; continue; }
                if (v > this.threshold) {
                    this.port.postMessage({ frame: currentFrame + i });
                    this.cool = this.coolFrames;
                }
            }
        }
        this.sincePeak += 128;
        if (this.sincePeak > sampleRate) { this.port.postMessage({ peak: this.peak }); this.sincePeak = 0; this.peak = 0; }
        return true;
    }
}
registerProcessor('lab-tap', LabTap);`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function setupTaps() {
    const context = ctx();
    await context.audioWorklet.addModule(URL.createObjectURL(new Blob([tapCode], { type: 'application/javascript' })));
    const makeTap = (kind: 'media' | 'synth', threshold: number) => {
        const node = new AudioWorkletNode(context, 'lab-tap', { processorOptions: { threshold } });
        node.port.onmessage = e => {
            if (e.data.frame !== undefined) {
                tapOnsets[kind].push(e.data.frame);
            } else if (e.data.peak !== undefined) {
                tapPeaks[kind] = Math.max(tapPeaks[kind], e.data.peak);
            }
        };
        node.connect(context.destination);
        return node;
    };
    const tapMedia = makeTap('media', 0.25);
    const tapSynth = makeTap('synth', 0.02);
    lab().mediaSourceNode!.connect(tapMedia);
    // the worklet is built when the player is ready (warm start)
    while (!lab().synthNode) {
        await sleep(50);
    }
    lab().synthNode!.connect(tapSynth);
    applySound();
}

function applySound() {
    lab().masterGainNode!.gain.value = input('listen').checked ? api.masterVolume : 0;
}
input('listen').addEventListener('change', applySound);

// ---- analysis (as in the spike) ----
interface SegmentStats {
    name: string;
    clicks: number;
    matched: number;
    unmatched: number;
    firstWindow: { n: number; meanMs: number; maxAbsMs: number };
    settled: { n: number; meanMs: number; medianMs: number; p95AbsMs: number; maxAbsMs: number; stdMs: number };
    resyncs: number;
    firstOffsets: number[];
}

function nearest(sorted: number[], x: number): number {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < x) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    let best = sorted[lo];
    if (lo > 0 && Math.abs(sorted[lo - 1] - x) < Math.abs(best - x)) {
        best = sorted[lo - 1];
    }
    return best;
}

const r1 = (x: number | undefined | null) => (x === undefined || x === null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);

function analyze(name: string, fromFrame: number, toFrame: number, fromPerf: number, toPerf: number, settleMs: number): SegmentStats {
    const sr = ctx().sampleRate;
    const media = tapOnsets.media.filter(f => f >= fromFrame - sr && f <= toFrame + sr).sort((a, b) => a - b);
    const synth = tapOnsets.synth.filter(f => f >= fromFrame && f <= toFrame);
    const settleFrame = fromFrame + (settleMs / 1000) * sr;
    const first: number[] = [];
    const settled: number[] = [];
    let unmatched = 0;
    for (const s of synth) {
        if (media.length === 0) {
            unmatched++;
            continue;
        }
        const off = ((s - nearest(media, s)) / sr) * 1000;
        if (Math.abs(off) > 150) {
            unmatched++;
            continue;
        }
        (s < settleFrame ? first : settled).push(off);
    }
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : Number.NaN);
    const sortedAbs = settled.map(Math.abs).sort((a, b) => a - b);
    const sorted = [...settled].sort((a, b) => a - b);
    const m = mean(settled);
    return {
        name,
        clicks: synth.length,
        matched: first.length + settled.length,
        unmatched,
        firstWindow: {
            n: first.length,
            meanMs: r1(mean(first))!,
            maxAbsMs: r1(first.length ? Math.max(...first.map(Math.abs)) : Number.NaN)!
        },
        settled: {
            n: settled.length,
            meanMs: r1(m)!,
            medianMs: r1(sorted[Math.floor(sorted.length / 2)])!,
            p95AbsMs: r1(sortedAbs[Math.floor(sortedAbs.length * 0.95)])!,
            maxAbsMs: r1(sortedAbs[sortedAbs.length - 1])!,
            stdMs: r1(Math.sqrt(mean(settled.map(x => (x - m) ** 2))))!
        },
        resyncs: lab().stats.resyncTimes.filter(t => t >= fromPerf && t <= toPerf).length,
        firstOffsets: [...first, ...settled].slice(0, 12).map(x => r1(x)!)
    };
}

function alphaTabTimeForMedia(mediaTime: number) {
    // api.timePosition is time at the current speed; the lab's own sequencer runs at 1x
    return sequencer.mainTimePositionFromBackingTrack(mediaTime, durationMs) / api.playbackSpeed;
}

/**
 * S4's first-click tolerance: max(±11 ms, ±2 × baseLatency) at 1× (F-3), ±20 ms at other speeds.
 */
function firstClickToleranceMs(speed: number): number {
    return speed === 1 ? Math.max(11, 2 * ctx().baseLatency * 1000) : 20;
}

function measuringSetup(speed: number) {
    lab().masterGainNode!.gain.value = 0; // silent, metronome only at full level: fixed tap thresholds
    api.metronomeVolume = 1;
    api.countInVolume = 0;
    api.changeTrackMute(api.score!.tracks, true);
    api.backingTrackVolume = 1;
    api.synthVolume = 1;
    api.playbackSpeed = speed;
    lab().enableDriftLog(true);
}

function restore() {
    api.pause();
    api.isLooping = false;
    api.playbackRange = null;
    applySound();
    applyMix();
    applyVolumes();
}

async function waitForProbe(speeds: number[]) {
    while (speeds.some(s => lab().probeLatencies[String(s)] === undefined)) {
        await sleep(100);
    }
}

async function segment(name: string, action: () => void, durationMs: number, settleMs = 1500): Promise<SegmentStats> {
    const context = ctx();
    const fromFrame = Math.round(context.currentTime * context.sampleRate);
    const fromPerf = performance.now();
    action();
    await sleep(durationMs);
    const toFrame = Math.round(context.currentTime * context.sampleRate);
    return analyze(name, fromFrame, toFrame, fromPerf, performance.now(), settleMs);
}

/**
 * S1-S3: steady playback, a seek at 1x, a seek with 0.5x and with 1.5x.
 */
async function runMeasurement() {
    if (src !== 'beeps') {
        log('the measurement needs src=beeps');
        return;
    }
    api.stop();
    measuringSetup(1);
    await waitForProbe([1, 0.5, 1.5]);
    tapOnsets.media.length = 0;
    tapOnsets.synth.length = 0;
    const segments: SegmentStats[] = [];
    segments.push(await segment('start@0s 1.0x', () => api.play(), 25000));
    segments.push(await segment('seek 1.0x', () => (api.timePosition = alphaTabTimeForMedia(durationMs * 0.45)), 15000));
    segments.push(
        await segment(
            'seek + 0.5x',
            () => {
                api.playbackSpeed = 0.5;
                api.timePosition = alphaTabTimeForMedia(durationMs * 0.6);
            },
            15000
        )
    );
    segments.push(
        await segment(
            'seek + 1.5x',
            () => {
                api.playbackSpeed = 1.5;
                api.timePosition = alphaTabTimeForMedia(durationMs * 0.75);
            },
            15000
        )
    );
    restore();
    record('measurement', {
        sampleRate: ctx().sampleRate,
        baseLatencyMs: r1(ctx().baseLatency * 1000),
        outputLatencyMs: r1(ctx().outputLatency * 1000),
        peaks: tapPeaks,
        totalResyncs: lab().stats.resyncTimes.length,
        resyncLeadMs: r1(lab().stats.resyncLeadMs),
        probeLatencies: lab().probeLatencies,
        segments
    });
}

/**
 * S4, S4b, S5: n plays from different beats, `beforeBeatMs` before the beat; checks the first clicks, the skip
 * (the first beep after Play must have its own click) and the lock time.
 */
async function startTest(n: number, beforeBeatMs: number, speed = 1) {
    const sr = ctx().sampleRate;
    measuringSetup(speed);
    const tolerance = firstClickToleranceMs(speed);
    const rows: {
        startMedia: number;
        first: number[];
        lockMs: number | null;
        resyncs: number;
        firstGap: number | null;
        skipped: boolean;
        withinTolerance: boolean;
        counts: string;
    }[] = [];
    for (let i = 0; i < n; i++) {
        api.pause();
        await sleep(400);
        const beat = beatMediaTimes[Math.min(beatMediaTimes.length - 10, 40 + i * 23)];
        const startMedia = beat - beforeBeatMs;
        api.timePosition = alphaTabTimeForMedia(startMedia);
        await sleep(300);
        tapOnsets.media.length = 0;
        tapOnsets.synth.length = 0;
        const playFrame = ctx().currentTime * sr;
        const playT = performance.now();
        api.play();
        await sleep(speed < 1 ? 4500 : 2500);
        const resyncs = lab().stats.resyncTimes.filter(t => t > playT).length;
        const media = [...tapOnsets.media].sort((a, b) => a - b);
        const synthAfter = tapOnsets.synth.filter(f => f > playFrame);
        const offs = synthAfter.slice(0, 5).map(f => r1(((f - nearest(media, f)) / sr) * 1000)!);
        let lockMs: number | null = null;
        for (let k = 0; k < synthAfter.length; k++) {
            if (synthAfter.slice(k).every(f => Math.abs(((f - nearest(media, f)) / sr) * 1000) < 3)) {
                lockMs = Math.round(((synthAfter[k] - playFrame) / sr) * 1000);
                break;
            }
        }
        const mediaAfter = media.filter(f => f > playFrame);
        const firstGap =
            mediaAfter.length > 0 && synthAfter.length > 0 ? r1(((synthAfter[0] - mediaAfter[0]) / sr) * 1000) : null;
        const skipped = firstGap === null || Math.abs(firstGap) > 50;
        rows.push({
            startMedia: Math.round(startMedia),
            first: offs,
            lockMs,
            resyncs,
            firstGap,
            skipped,
            withinTolerance: !skipped && Math.abs(firstGap!) <= tolerance,
            counts: `${synthAfter.length}/${mediaAfter.length}`
        });
    }
    restore();
    record('startTest', { speed, beforeBeatMs, toleranceMs: r1(tolerance), rows });
    return rows;
}

/**
 * S6: Play with the real count-in on a beat; counts the count-in clicks, the downbeat (click vs the media's first
 * beep) and the next clicks.
 */
async function countInTest(n: number, speed = 1) {
    const sr = ctx().sampleRate;
    measuringSetup(speed);
    api.countInVolume = 1;
    const rows: object[] = [];
    for (let i = 0; i < n; i++) {
        api.pause();
        await sleep(400);
        const target = beatMediaTimes[Math.min(beatMediaTimes.length - 10, 40 + i * 23)];
        api.timePosition = alphaTabTimeForMedia(target);
        await sleep(300);
        tapOnsets.media.length = 0;
        tapOnsets.synth.length = 0;
        const playFrame = ctx().currentTime * sr;
        const playT = performance.now();
        const handOffs = lab().countIns.length;
        api.play();
        await sleep(speed < 1 ? 9000 : 6000);
        const media = [...tapOnsets.media].sort((a, b) => a - b);
        const synthAfter = tapOnsets.synth.filter(f => f > playFrame).sort((a, b) => a - b);
        const firstBeep = media.find(f => f > playFrame) ?? null;
        const ms = (f: number) => r1((f / sr) * 1000)!;
        const countInClicks = firstBeep === null ? null : synthAfter.filter(f => f < firstBeep - 0.05 * sr).length;
        const downbeatMs =
            firstBeep === null || synthAfter.length === 0 ? null : ms(nearest(synthAfter, firstBeep) - firstBeep);
        const handOff = lab().countIns[handOffs];
        rows.push({
            target: Math.round(target),
            countInClicks,
            downbeatMs,
            skipped: downbeatMs === null || Math.abs(downbeatMs) > 50,
            withinTolerance: downbeatMs !== null && Math.abs(downbeatMs) <= firstClickToleranceMs(speed),
            after:
                firstBeep === null
                    ? []
                    : synthAfter
                          .filter(f => f > firstBeep + 0.05 * sr)
                          .slice(0, 4)
                          .map(f => ms(f - nearest(media, f))),
            resyncs: lab().stats.resyncTimes.filter(t => t > playT).length,
            playLateMs: handOff ? r1(handOff.lateMs) : null,
            learnedMediaStartMs: lab().mediaStartLatencies[String(speed)] ?? null
        });
    }
    restore();
    record('countInTest', { speed, rows });
    return rows;
}

/**
 * D-3 (F-14): the count-in's media pre-roll below 1x, 60 ms against 120 ms, with the real count-in.
 */
async function countInPreRollTest(speed = 0.5, n = 6) {
    const constants = MediaSyncConstants as unknown as { CountInPreRollBelow1xMs: number };
    const original = constants.CountInPreRollBelow1xMs;
    const byPreRoll: Record<string, object[]> = {};
    for (const preRoll of [60, 120]) {
        constants.CountInPreRollBelow1xMs = preRoll;
        byPreRoll[String(preRoll)] = await countInTest(n, speed);
    }
    constants.CountInPreRollBelow1xMs = original;
    record('countInPreRollTest', { speed, byPreRoll });
    return byPreRoll;
}

/**
 * S10: loops `bars` bars from beat 40 for `wraps` repetitions; every beep must have its own click.
 */
async function loopTest(speed: number, bars = 2, wraps = 10, beatsPerBar = 4) {
    const sr = ctx().sampleRate;
    measuringSetup(speed);
    api.pause();
    await sleep(400);
    const k0 = 40;
    const startMedia = beatMediaTimes[k0];
    const endMedia = beatMediaTimes[k0 + bars * beatsPerBar];
    const beatMs = (beatMediaTimes[k0 + 1] - beatMediaTimes[k0]) / speed;
    api.timePosition = alphaTabTimeForMedia(endMedia);
    await sleep(150);
    const endTick = api.tickPosition;
    api.timePosition = alphaTabTimeForMedia(startMedia);
    await sleep(150);
    const range = new alphaTab.synth.PlaybackRange();
    range.startTick = api.tickPosition;
    range.endTick = endTick;
    api.playbackRange = range;
    api.isLooping = true;
    const wrapsBefore = lab().wraps.length;
    await sleep(300);
    tapOnsets.media.length = 0;
    tapOnsets.synth.length = 0;
    const playFrame = ctx().currentTime * sr;
    api.play();
    await sleep(((endMedia - startMedia) / speed) * (wraps + 1) + 300);
    const wrapCount = lab().wraps.length - wrapsBefore;
    restore();
    await sleep(300);
    const media = tapOnsets.media.filter(f => f > playFrame).sort((a, b) => a - b);
    const synth = tapOnsets.synth.filter(f => f > playFrame).sort((a, b) => a - b);
    const offsets: number[] = [];
    let missing = 0;
    for (const m of media) {
        const off = ((nearest(synth, m) - m) / sr) * 1000;
        if (Math.abs(off) <= 50) {
            offsets.push(off);
        } else {
            missing++;
        }
    }
    const extra = synth.filter(s => Math.abs(((s - nearest(media, s)) / sr) * 1000) > 50).length;
    const gaps: number[] = [];
    for (let i = 1; i < media.length; i++) {
        const d = ((media[i] - media[i - 1]) / sr) * 1000;
        if (d > beatMs + 15) {
            gaps.push(Math.round(d - beatMs));
        }
    }
    const abs = offsets.map(Math.abs).sort((a, b) => a - b);
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const result = {
        speed,
        beeps: media.length,
        clicks: synth.length,
        missing,
        extra,
        meanMs: r1(offsets.reduce((a, b) => a + b, 0) / Math.max(1, offsets.length)),
        p95Ms: r1(abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))]),
        wraps: wrapCount,
        gaps,
        medianGapMs: sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : null,
        beatMs: Math.round(beatMs)
    };
    record('loopTest', result);
    return result;
}

/**
 * F-9d: a held tempo sweep (notation-hero's tempo button, one step per `stepMs`).
 */
async function sweepTest(fromSpeed: number, steps: number, stepSpeed: number, stepMs = 250) {
    const sr = ctx().sampleRate;
    measuringSetup(fromSpeed);
    api.pause();
    await sleep(400);
    api.timePosition = alphaTabTimeForMedia(beatMediaTimes[40]);
    await sleep(300);
    api.play();
    await sleep(3000);
    tapOnsets.media.length = 0;
    tapOnsets.synth.length = 0;
    const f0 = ctx().currentTime * sr;
    const t0 = performance.now();
    let speed = fromSpeed;
    for (let i = 0; i < steps; i++) {
        speed = Math.round((speed + stepSpeed) * 10000) / 10000;
        api.playbackSpeed = speed;
        await sleep(stepMs);
    }
    const lastStepT = performance.now();
    await sleep(2000);
    const f1 = ctx().currentTime * sr;
    restore();
    const media = [...tapOnsets.media].sort((a, b) => a - b);
    const clicks = tapOnsets.synth.filter(f => f > f0 && f < f1);
    const abs = clicks.map(f => Math.abs(((f - nearest(media, f)) / sr) * 1000)).sort((a, b) => a - b);
    // after the last step + 1.5 s settle the clicks must be back within S4b's tolerance
    const settledFrom = f0 + ((lastStepT - t0 + 1500) / 1000) * sr;
    const settled = clicks.filter(f => f > settledFrom).map(f => Math.abs(((f - nearest(media, f)) / sr) * 1000));
    const row = {
        fromSpeed,
        toSpeed: speed,
        steps,
        stepMs,
        resyncs: lab().stats.resyncTimes.filter(t => t > t0).length,
        counts: `${clicks.length}/${media.filter(f => f > f0 && f < f1).length}`,
        p95Ms: r1(abs[Math.floor(abs.length * 0.95)]),
        maxMs: r1(abs[abs.length - 1]),
        over20: abs.filter(x => x > 20).length,
        settledMaxMs: r1(settled.length ? Math.max(...settled) : Number.NaN),
        settledWithinTolerance: settled.every(x => x <= firstClickToleranceMs(speed))
    };
    record('sweepTest', row);
    return row;
}

/**
 * F-9d: the rhythm game's auto-BPM loop: +`bpmStep` BPM each time the loop wraps.
 */
async function autoBpmLoopTest(startSpeed: number, bpmStep = 5, wraps = 10, bars = 2, beatsPerBar = 4) {
    const sr = ctx().sampleRate;
    const bpm = api.score!.tempo;
    const step = bpmStep / bpm;
    let speed = startSpeed;
    const unsubscribe = api.playerFinished.on(() => {
        speed = Math.round((speed + step) * 10000) / 10000;
        api.playbackSpeed = speed;
    });
    const wrapFrames: number[] = [];
    const unsubscribeWraps = api.playerFinished.on(() => wrapFrames.push(ctx().currentTime * sr));
    measuringSetup(startSpeed);
    const k0 = 40;
    const startMedia = beatMediaTimes[k0];
    const endMedia = beatMediaTimes[k0 + bars * beatsPerBar];
    api.timePosition = alphaTabTimeForMedia(endMedia);
    await sleep(150);
    const endTick = api.tickPosition;
    api.timePosition = alphaTabTimeForMedia(startMedia);
    await sleep(150);
    const range = new alphaTab.synth.PlaybackRange();
    range.startTick = api.tickPosition;
    range.endTick = endTick;
    api.playbackRange = range;
    api.isLooping = true;
    tapOnsets.media.length = 0;
    tapOnsets.synth.length = 0;
    const playFrame = ctx().currentTime * sr;
    api.play();
    while (wrapFrames.length < wraps) {
        await sleep(100);
    }
    await sleep(((endMedia - startMedia) / speed) * 0.5);
    unsubscribe();
    unsubscribeWraps();
    restore();
    const media = tapOnsets.media.filter(f => f > playFrame).sort((a, b) => a - b);
    const synth = tapOnsets.synth.filter(f => f > playFrame).sort((a, b) => a - b);
    // each repetition's first beat: the first beep after each wrap
    const firstBeats = wrapFrames.map(w => {
        const beep = media.find(f => f > w);
        return beep === undefined || synth.length === 0 ? null : r1(((nearest(synth, beep) - beep) / sr) * 1000);
    });
    const missing = media.filter(m => Math.abs(((nearest(synth, m) - m) / sr) * 1000) > 50).length;
    const row = {
        startSpeed,
        endSpeed: speed,
        bpmStep,
        wraps: wrapFrames.length,
        firstBeatsMs: firstBeats,
        firstBeatsWithinTolerance: firstBeats.every(x => x !== null && Math.abs(x) <= 20),
        missing,
        resyncs: lab().stats.resyncTimes.length
    };
    record('autoBpmLoopTest', row);
    return row;
}

/**
 * F-9a / F-9d: the first Play at a speed with no probe value and no start lead: the straight-line guesses.
 */
async function firstPlayAtUnprobedSpeedTest(speeds: number[], beforeBeatMs = 30) {
    const rows: object[] = [];
    for (const speed of speeds) {
        lab().forgetProbeLatency(speed);
        lab().forgetStartLead(speed);
        const guessedLead = mediaSynth().controller.startLeads.get(speed);
        const guessedLatency = MediaLatencyProbe.cache.get(speed);
        const probesBefore = lab().probes.length;
        const playT = performance.now();
        const [row] = await startTest(1, beforeBeatMs, speed);
        const probe = lab().probes.slice(probesBefore).find(p => p.speed === speed);
        rows.push({
            speed,
            guessedLeadMs: r1(guessedLead),
            guessedLatencyMs: r1(guessedLatency),
            probeArrivedAfterPlayMs: probe ? Math.round(probe.time - playT) : null,
            ...row
        });
    }
    record('firstPlayAtUnprobedSpeedTest', rows);
    return rows;
}

/**
 * D-1 (F-9a): a probe value lands while a loop plays at an unprobed speed. forcedResync = true runs the spec's
 * current rule (re-sync on arrival) for comparison.
 */
async function probeMidPlaybackTest(speed = 0.875, forcedResync = false) {
    const sr = ctx().sampleRate;
    const controller = mediaSynth().controller;
    const latencyChanged = controller.latencyChanged.bind(controller);
    if (forcedResync) {
        controller.latencyChanged = () => {
            latencyChanged();
            controller.resync();
        };
    }
    lab().forgetProbeLatency(speed);
    measuringSetup(speed);
    api.timePosition = alphaTabTimeForMedia(beatMediaTimes[40]);
    await sleep(300);
    tapOnsets.media.length = 0;
    tapOnsets.synth.length = 0;
    const probesBefore = lab().probes.length;
    const playFrame = ctx().currentTime * sr;
    const playT = performance.now();
    api.play(); // queues this speed's probe first: it lands mid-playback
    await sleep(8000);
    restore();
    controller.latencyChanged = latencyChanged;
    const probe = lab().probes.slice(probesBefore).find(p => p.speed === speed);
    const arrivalFrame = probe ? playFrame + ((probe.time - playT) / 1000) * sr : Number.NaN;
    const media = [...tapOnsets.media].sort((a, b) => a - b);
    const offsetsAround = (from: number, to: number) =>
        tapOnsets.synth
            .filter(f => f > from && f < to)
            .map(f => r1(((f - nearest(media, f)) / sr) * 1000)!);
    const row = {
        speed,
        forcedResync,
        probeArrivedAfterPlayMs: probe ? Math.round(probe.time - playT) : null,
        probeLatencyMs: probe ? r1(probe.latencyMs) : null,
        resyncsAfterArrival: probe ? lab().stats.resyncTimes.filter(t => t >= probe.time).length : null,
        clicksBeforeMs: offsetsAround(arrivalFrame - sr, arrivalFrame),
        clicksAfterMs: offsetsAround(arrivalFrame, arrivalFrame + 2 * sr)
    };
    record('probeMidPlaybackTest', row);
    return row;
}

/**
 * §6.4: the ~1 s probe (125 ms spacing) against the spike's 4 s probe (250 ms spacing).
 */
async function probeComparison(speeds = [0.5, 0.75, 1.25, 1.5], repeats = 3) {
    const context = ctx();
    const load = () => BrowserUiFacade.createAlphaSynthAudioWorklet(context, settings);
    const short = new MediaLatencyProbe(context, load, 1, 0.125);
    const long = new MediaLatencyProbe(context, load, 4, 0.25);
    const rows: object[] = [];
    for (const speed of speeds) {
        const shortValues: number[] = [];
        const longValues: number[] = [];
        for (let i = 0; i < repeats; i++) {
            shortValues.push(r1(await short.measure(speed))!);
            longValues.push(r1(await long.measure(speed))!);
        }
        rows.push({ speed, shortMs: shortValues, longMs: longValues });
    }
    record('probeComparison', rows);
    return rows;
}

/**
 * §6.1, spike 7: playBeat while playing pauses both; the next Play is in sync.
 */
async function playBeatTest(n = 4, speed = 1) {
    const sr = ctx().sampleRate;
    measuringSetup(speed);
    const track = api.score!.tracks[0];
    const beat = track.staves[0].bars[Math.min(12, track.staves[0].bars.length - 1)].voices[0].beats[0];
    const rows: object[] = [];
    for (let i = 0; i < n; i++) {
        api.pause();
        await sleep(400);
        api.timePosition = alphaTabTimeForMedia(beatMediaTimes[40 + i * 23] - 500);
        await sleep(300);
        api.play();
        await sleep(2500);
        const states: string[] = [];
        const unsubscribe = api.playerStateChanged.on(e =>
            states.push(e.state === alphaTab.synth.PlayerState.Playing ? 'Playing' : 'Paused')
        );
        api.playBeat(beat);
        await sleep(1500);
        unsubscribe();
        tapOnsets.media.length = 0;
        tapOnsets.synth.length = 0;
        const playFrame = ctx().currentTime * sr;
        api.play();
        await sleep(2500);
        const media = [...tapOnsets.media].sort((a, b) => a - b);
        const synthAfter = tapOnsets.synth.filter(f => f > playFrame);
        const mediaAfter = media.filter(f => f > playFrame);
        rows.push({
            statesAfterPlayBeat: states,
            firstGapMs: mediaAfter.length && synthAfter.length ? r1(((synthAfter[0] - mediaAfter[0]) / sr) * 1000) : null,
            nextClicksMs: synthAfter.slice(0, 5).map(f => r1(((f - nearest(media, f)) / sr) * 1000))
        });
    }
    restore();
    record('playBeatTest', { speed, rows });
    return rows;
}

document.getElementById('play')!.addEventListener('click', () => api.playPause());
document.getElementById('measure')!.addEventListener('click', () => runMeasurement());
document.getElementById('speed')!.addEventListener('change', e => {
    api.playbackSpeed = Number.parseFloat((e.target as HTMLSelectElement).value);
});
const metronomeEl = input('metronome');
const drumsEl = input('drums');
const metronomeVolEl = input('metronomeVol');
function applyMix() {
    api.metronomeVolume = metronomeEl.checked ? Number.parseFloat(metronomeVolEl.value) : 0;
    if (api.score) {
        api.changeTrackMute(api.score.tracks, !drumsEl.checked);
    }
}
metronomeEl.addEventListener('change', applyMix);
metronomeVolEl.addEventListener('input', applyMix);
drumsEl.addEventListener('change', applyMix);
const mediaVolEl = input('mediaVol');
const synthVolEl = input('synthVol');
function applyVolumes() {
    api.backingTrackVolume = Number.parseFloat(mediaVolEl.value);
    api.synthVolume = Number.parseFloat(synthVolEl.value);
}
mediaVolEl.addEventListener('input', applyVolumes);
synthVolEl.addEventListener('input', applyVolumes);

let tapsReady = false;
api.playerReady.on(async () => {
    fileNameEl.textContent = pendingFileName;
    // S7: with mixing=0 both stay 0 in backing-track mode
    log('player ready', { mixing, created });
    if (!mixing) {
        return;
    }
    applyMix();
    applyVolumes();
    if (!tapsReady) {
        tapsReady = true;
        await setupTaps();
    }
});

// live readout: how far each metronome click is from the backing track's beep (beeps only)
const liveEl = document.getElementById('live')!;
let liveSeen = 0;
setInterval(() => {
    if (!mixing || !tapsReady) {
        return;
    }
    const speed = api.playbackSpeed;
    const latency = lab().probeLatencies[String(speed)];
    const probe = latency === undefined ? `latency @${speed}x: guessed` : `latency @${speed}x: ${latency} ms`;
    if (src !== 'beeps') {
        liveEl.textContent = `live: ${probe} — switch Audio to "generated beeps" for click-vs-beep offsets`;
        return;
    }
    const sr = ctx().sampleRate;
    const media = [...tapOnsets.media].sort((a, b) => a - b);
    const recent = tapOnsets.synth.slice(-8);
    if (media.length === 0 || recent.length === 0 || tapOnsets.synth.length === liveSeen) {
        return;
    }
    liveSeen = tapOnsets.synth.length;
    const offsets = recent
        .map(s => ((s - nearest(media, s)) / sr) * 1000)
        .filter(o => Math.abs(o) < 150)
        .map(o => Math.round(o));
    const mean = offsets.length ? Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length) : 0;
    liveEl.textContent = `live @${speed}x: click - beep (last ${offsets.length}): ${offsets.join(' ')} ms, mean ${mean} ms; ${probe}`;
}, 400);

(window as unknown as { syncLab: unknown }).syncLab = {
    results,
    created,
    lab,
    mediaSynth,
    runMeasurement,
    startTest,
    countInTest,
    countInPreRollTest,
    loopTest,
    sweepTest,
    autoBpmLoopTest,
    firstPlayAtUnprobedSpeedTest,
    probeMidPlaybackTest,
    probeComparison,
    playBeatTest
};

(async () => {
    const bytes = new Uint8Array(await (await fetch(file)).arrayBuffer());
    await loadBytes(bytes, file.split('/').pop() ?? file);
})();
```

Note on the beat times: the lab reads the metronome events' **ticks** and maps them with `mainTickToMediaTime`
(Task 2). The spike page passed the events' times to `mainTimePositionToBackingTrack`, which equals this only at 1×.

- [ ] **Step 3: Typecheck, lint, and a smoke run**

```bash
npm run typecheck --workspace=packages/playground
npm run lint --workspace=packages/playground
npm run dev --workspace=packages/playground -- --port 5188 --strictPort
```

Open `http://localhost:5188/demos/sync-lab/`, click the page once, wait for "player ready", then in the console
run `await syncLab.startTest(2, 30, 1)`.
Expected: two rows, `skipped: false`, first clicks within ±11 ms. Then open
`http://localhost:5188/demos/sync-lab/?mixing=0`: the log shows `created: {"synthWorkers":0,"synthWorklets":0}`
(S7).

- [ ] **Step 4: Commit**

```bash
git add packages/playground/demos/sync-lab
git commit -m "test(playground): sync lab for synth-with-media acceptance (#2397)"
git push
```

---

### Task 22: Acceptance run on this machine — and decision gates D-1, D-3, D-4, D-5

**Files:**
- Create: `docs/spikes/issue-2397/acceptance-<date>.md` (the results, beside the §1 targets)
- Modify: `docs/spikes/issue-2397/results-<date>.json` (raw numbers: `syncLab.results`)
- Modify: `docs/superpowers/specs/2026-10-07-synth-with-media-design.md` (§1 S6 and S12, §6.4, §9 acceptance, the
  §14 lines this run settles)

**Interfaces:** consumes the sync lab (Task 21) and the built feature (Tasks 2–20).

The §9 acceptance on Chromium (macOS), with the lab and by ear. Each step names the criterion it measures. Results
go in the dated `.md`: one table per criterion, with the target, the result, pass or fail. Each decision gate
first runs its measurement, then puts the choice as a picker (see "How to run this plan").

- [ ] **Step 1: S1–S3, steady playback**

Run `await syncLab.runMeasurement()`.
Pass: S1 p95 ≤ 3 ms at 1×, S2 p95 ≤ 5 ms at 1.5× (also run `syncLab.loopTest(1.25, 4, 3)` for a 1.25× figure), S3
p95 ≤ 20 ms at 0.5× (and `syncLab.startTest(5, 30, 0.75)` for 0.75×).

- [ ] **Step 2: S4, S4b, S5 — starts, seeks and speed changes on a beat**

```text
await syncLab.startTest(10, 30, 1); await syncLab.startTest(10, 30, 0.5); await syncLab.startTest(10, 30, 1.5)
await syncLab.startTest(10, 0, 1)        (exactly on a beat)
```

Pass: no `skipped`, `withinTolerance` everywhere, counts equal (one click per beat, S5). For S4b, the seek
segments of Step 1 and the sweep in Step 6 cover seeks and speed changes during playback.

§9 also asks for speeds outside the probed list. Run:

```text
await syncLab.startTest(5, 30, 0.25); await syncLab.startTest(5, 30, 2)
await syncLab.lab().measureLatency(0.25); await syncLab.lab().measureLatency(2)
```

Record the click offsets and the measured latencies next to spike 5's (0.25×: 80 ms, 2×: −6 ms). These speeds are
reported, not gated.

- [ ] **Step 3: STOP — decision gate D-4 (Q-1): does S4 gate the first Play at an unlearned speed?**

Run `await syncLab.firstPlayAtUnprobedSpeedTest([0.625, 0.875])` on a fresh page load. Put to the person as
`[Q-D4]`:

- **Scenario:** you open a song and press Play at 0.875× before the lab, or the app, has played at that speed.
- **Option 1 (recommended; implemented reporting; High; rule only):** report that first Play against S4's (open)
  item, don't gate on it. Spike 11: 0.875× lands within 5 ms, 0.625× +18…+23 ms.
- **Option 2:** gate on it at ±20 ms. That fails whenever the straight-line guess is more than ~20 ms off (spike 11:
  once just over).

Apply the answer to §1 S4's "(open)" sentence.

- [ ] **Step 4: STOP — decision gates D-3 (F-14) and S6, the count-in**

```text
await syncLab.countInPreRollTest(0.5, 6)
await syncLab.countInTest(6, 1); await syncLab.countInTest(6, 1.5)
```

Put D-3 to the person as `[Q-D3]` with the two pre-roll results in hand:

- **Scenario:** in the rhythm game at 0.5×, you press Play with the count-in on; the backing track enters on the
  downbeat after one bar of clicks.
- **Option 1 (recommended; implemented; spiked in spike 6 with an emulated count-in; Medium):** 120 ms.
- **Option 2 (spiked; Medium):** 60 ms, the same pre-roll as every other start.

Then restate §1 S6's figures with the run's numbers. The 1.5× figure should read 0…+2.7 ms (F-14). Mark "the first
count-in at an unlearned speed: (open)".

- [ ] **Step 5: STOP — decision gate D-5 (F-15), S10, the loop wrap**

```text
await syncLab.loopTest(0.5); await syncLab.loopTest(1); await syncLab.loopTest(1.5)
```

Then switch **Audio** to the file's audio, turn the synth tracks on, loop at 1× and 1.5×, and listen at each wrap
the run's `gaps` flags. Put to the person as `[Q-D5]`:

- **Scenario:** in notation-hero you loop two bars to practice; at every wrap the recording jumps back to the
  first beat.
- **Option 1 (recommended; provisional; partly spiked in spike 4; Medium):** a median gate (median added time per
  wrap ≤ 30 ms, every first beat within S4b), plus the ear check.
- **Option 2 (spike 4; Medium):** every wrap ≤ 30 ms. A single slow seek fails it.

Write the gate into §1 S10.

- [ ] **Step 6: F-9d — the apps' speed patterns, and S12 into the spec**

```text
await syncLab.sweepTest(1, 12, -0.0072, 250)       (a held tempo button: 12 steps of about 1 BPM)
await syncLab.sweepTest(0.75, 12, 0.0072, 250)
await syncLab.autoBpmLoopTest(0.8, 5, 10)          (the rhythm game: +5 BPM per passed loop)
```

Add S12 to §1, with the numbers this run measured:

**After** (a new row under S11):
> S12 | Speed changes during playback (the apps' patterns) | a held sweep in 1-BPM steps every 250 ms: one
> re-sync per step (Chrome's media lands 15–43 ms behind at each change, spike 11), clicks back within S4b's
> tolerance 1.5 s after the last step; an auto-BPM loop (+5 BPM per wrap, 10 wraps): each repetition's first beat
> within S4b's tolerance, no missing clicks; the first Play at an unprobed speed: as S4 (Q-1 decides whether it
> gates)

- [ ] **Step 7: STOP — decision gate D-1 (F-9a), a probe value mid-playback**

```text
await syncLab.probeMidPlaybackTest(0.875, false); await syncLab.probeMidPlaybackTest(0.875, true)
```

with the synth tracks unmuted and listening, then the same pair at 0.625×. Put to the person as `[Q-D1]`:

- **Scenario:** in the rhythm game the auto-BPM moves to a speed never played before, and its latency measurement
  lands two bars in.
- **Option 1 (recommended; implemented; not spiked before this run; Low → as measured):** settle only; the drift
  rules re-sync only if the agreed drift exceeds the threshold.
- **Option 2 (the spec's current §6.4 text):** re-sync on arrival. It cuts the notes that are sounding (spike 4).

Edit §6.4's sentence "A value that arrives during playback is applied like a speed change (re-sync, settle)" to
match the answer.

- [ ] **Step 8: §6.4 — the shorter probe**

Run `await syncLab.probeComparison()`. If the 1 s and 4 s values differ by more than 3 ms at any speed, change
`MediaLatencyProbe.LengthS` / `SpacingS` to 4 / 0.25 in a separate commit and say so in the results. Either way,
remove "**untested**" from §6.4 and state what was measured.

- [ ] **Step 9: S7, S8, S11, F-8, F-13 and by ear**

- **S7:** with `?mixing=0` the log shows 0 synth workers and 0 synth worklets.
- **S8:** play the same song for 30 s in synth mode (the control demo) and with mixing on (this lab, the file's
  audio). Record main-thread scripting time and worker message counts from the Chrome performance panel. They
  should be comparable.
- **S11 and F-13:** play a mastered recording (`?file=` your real MP3-backed file) at default levels — the
  metronome must be clearly audible. Then raise `synthVolume` to 3 — there must be no clipping by ear. Also re-run
  spike 8's offline script (`docs/spikes/issue-2397/spike-8-limiter-console.js`): its proposed row must still read
  −0.31 dBFS at `synthVolume` 3 (the unit test ties the code's values to it).
- **F-8 signals:** re-run `docs/spikes/issue-2397/spike-10-batch-1-console.js` in the control demo: a SoundFont
  download failure now fires `soundFontLoadFailed` on the player instance. Mixing on with a missing worker or
  worklet plays the media alone, with the warning.
- **Listening check (§9):** the file's audio with the synth tracks unmuted, using a song with sustained notes.
  Do a Play, a seek, and a speed change. Expect no cut notes and no dropouts, except the one re-sync at each speed
  change (spike 11; a re-sync that keeps notes sounding is later work, §12).
- **Manual (§9):** your real MP3 with drums and metronome, by ear. The `youtube-sync` playground demo with mixing
  on and the metronome: tune `mediaSyncOffsetInMilliseconds` by ear and record the value (S9).

- [ ] **Step 10: F-18 — the acceptance list**

In §9's sync-lab row, change "Acceptance: S1–S5, S4b, S10" to "Acceptance: S1–S6 (S6: backing track), S4b, S10,
S12", using D-3's and D-4's answers.

- [ ] **Step 11: Commit the evidence and the spec**

```bash
git add docs/spikes/issue-2397 docs/superpowers/specs/2026-10-07-synth-with-media-design.md
git commit -m "docs: #2397 acceptance run (Chromium/macOS); S6, S10, S12 and §6.4 settled"
git push
```

---

### Task 23: A run on a machine with a higher `baseLatency` — decision gate D-2 (F-3)

**Files:**
- Create: `docs/spikes/issue-2397/baselatency-<date>.md`

**Interfaces:** consumes the sync lab.

F-3 (both; our design's problem; not spiked; Low): the thresholds come from the context's audio callback. Settle
re-sync at 1× = max(12 ms, 2 × `baseLatency` + 1 ms); the first-click tolerance = max(±11 ms, ±2 × `baseLatency`).
Every run so far was on Chrome/macOS (`baseLatency` ≤ 5.3 ms), where both equal today's constants.

- [ ] **Step 1: Find the machine**

Windows Chrome typically reports 10 ms. In the lab's console, `syncLab.lab().audioContext.baseLatency * 1000`
must be above 5.3. Note the browser, OS and value.

- [ ] **Step 2: Run the start and loop tests**

```text
await syncLab.startTest(10, 30, 1); await syncLab.startTest(10, 0, 1); await syncLab.loopTest(1)
```

Record each row's `toleranceMs`, `withinTolerance`, `resyncs` and `lockMs`.

- [ ] **Step 3: STOP — decision gate D-2**

Put to the person as `[Q-D2]`, with the numbers:

- **Scenario:** you play on a Windows laptop whose audio callback is 10 ms. Should a 15 ms start offset re-sync
  (cutting notes) or be nudged away?
- **Option 1 (implemented; now measured):** keep the derived thresholds.
- **Option 2:** go back to the fixed 12 ms / ±11 ms.

Record the answer in §14 and in `MediaSyncController.settleThreshold`'s comment.

- [ ] **Step 4: Commit**

```bash
git add docs/spikes/issue-2397/baselatency-*.md docs/superpowers/specs/2026-10-07-synth-with-media-design.md
git commit -m "docs: #2397 baseLatency run (F-3, D-2)"
git push
```

---

### Task 24: Target devices — iPad (WebKit) and Android — decision gates D-7 (R-2) and D-8 (R-1)

**Files:**
- Create: `docs/spikes/issue-2397/target-devices-<date>.md`

**Interfaces:** consumes the sync lab, served over HTTPS.

§9's target-device row: before delivery, run the sync lab's start, loop and count-in tests and the listening check
on two devices. One is an iPad (WebKit, inside the Web MIDI Browser shim app both apps use there); the other is an
Android tablet (Chrome). Load the lab over HTTPS: AudioWorklets need a secure context. A device that misses the
targets stays media-only in both apps until it passes (each app leaves the flag off there).

- [ ] **Step 1: Serve the lab over HTTPS on the local network**

Use a tunnel or a local certificate so both devices load `https://…/demos/sync-lab/`. First check that mixing
runs at all: the log must not show "playing the media only".

- [ ] **Step 2: The runs on each device**

```text
await syncLab.startTest(10, 30, 1); await syncLab.startTest(10, 30, 0.5)
await syncLab.loopTest(1); await syncLab.countInTest(6, 1)
```

Then do the listening check: the file's audio, synth tracks on; Play, a seek, a speed change. Listen for cut notes
and dropouts. Put the results beside the §1 targets in the dated `.md`.

- [ ] **Step 3: STOP — decision gate D-8 (R-1), iOS's Ring/Silent switch**

On the iPad, turn the Silent switch on and play. Is the backing track still heard? (Web Audio is muted in silent
mode; a plain `<audio>` is not.) If it isn't heard, try `navigator.audioSession.type = 'playback'` (Safari 16.4+)
in the lab's console before Play and listen again. Put to the person as `[Q-D8]`:

- **Scenario:** a student practices on an iPad with the Silent switch on; with mixing, the recording falls silent.
- **Option 1:** set `navigator.audioSession.type = 'playback'` while mixing on iOS (a small change in
  `MediaSynthPlayer`, with a test).
- **Option 2:** leave mixing off on iOS (both apps keep the flag off there).
- **Option 3:** document it and leave it to the apps.

Confidence and spiked status come from this run.

- [ ] **Step 4: STOP — decision gate D-7 (R-2), a refused delayed `play()`**

On the iPad, run `await syncLab.countInTest(6, 1)`. Does WebKit refuse the backing track's `play()` a bar after the
gesture? The safety net (Task 17) then pauses both and logs "The media did not start after the count-in". Put to
the person as `[Q-D7]`, with the result:

- **Scenario:** in the rhythm game on the iPad you press Play with the count-in on; after one bar of clicks
  nothing plays.
- **Option 1:** unlock the media in the gesture: call the `<audio>`'s `play()` and `pause()` synchronously inside
  the Play handler, so the later `play()` is allowed (a change in `MediaSynthPlayer._startCountIn`, with a test).
- **Option 2:** no count-in on WebKit: start the media at once and skip the count-in there.
- **Option 3:** keep the safety net only.

If it is not refused, record that and keep the safety net.

- [ ] **Step 5: Commit**

```bash
git add docs/spikes/issue-2397/target-devices-*.md
git commit -m "docs: #2397 target-device run (iPad WebKit, Android Chrome; R-1, R-2)"
git push
```

---

## Phase 6 — Delivery (§11)

These tasks work in the two app repositories, alphaTabWebsite and notation-hero. Use each repo's own branch, commit
and test conventions, never their default branch. Commands below use repo-relative paths, plus shell variables you
set yourself (never write absolute paths into tracked files).

### Task 25: Build, pack, and a first try in both apps (a `file:` dependency)

**Files:** none tracked; a tarball outside both apps.

- [ ] **Step 1: Build and pack**

From the alphaTab feature worktree:

```bash
npm run build
npm pack --workspace=packages/alphatab
```

Expected: a `coderline-alphatab-<version>.tgz` in the worktree root. Set `ALPHATAB_PACK` in your shell to its
absolute path.

- [ ] **Step 2: Try it in alphaTabWebsite (a throwaway branch, not committed)**

```bash
git switch -c try/2397-synth-with-media
npm install "$ALPHATAB_PACK"
```

Turn `player.enableSynthesizerWithMedia` on where the rhythm game creates the API (Task 26 Step 5 shows the change).
Play a backing-track song with the metronome on, by ear, and then the YouTube flow. Then throw the branch away:

```bash
git restore --staged --worktree .
git switch -
git branch -D try/2397-synth-with-media
```

- [ ] **Step 3: Try it in notation-hero/web (throwaway, not committed)**

```bash
git switch -c try/2397-synth-with-media
pnpm --filter web add "file:$ALPHATAB_PACK"
```

Same check. Then restore and delete the branch as in Step 2.

If either try fails, stop here, fix it on `feat/2397-synth-with-media` (with a test), and come back to Step 1.

---

### Task 26: alphaTabWebsite — the patch (patch-package) and turning the feature on (F-10)

**Files (alphaTabWebsite):** `package.json`, its lockfile, `patches/@coderline+alphatab+<alpha>.patch` (new),
`patches/@coderline+alphatab+1.8.1.patch` (delete), the rhythm game's API settings and YouTube player options,
`cross-markers.tsx`.

**F-10** (both apps; our design's problem; not spiked; Medium): §11 step 4 turns the feature on in each app. The
rhythm game creates its YouTube player with `controls: 0` and `disablekb: 1`, so starts go through the app's Play
button and keep their count-in (§7).

- [ ] **Step 1: A branch, and the alpha that is current today**

```bash
git switch -c feat/2397-synth-with-media
npm view @coderline/alphatab dist-tags
```

Pick the current `1.9.0-alpha.N` and call it `<alpha>` below.

- [ ] **Step 2: Upgrade, and drop the stale patch in the same commit**

```bash
npm install @coderline/alphatab@<alpha>
git rm patches/@coderline+alphatab+1.8.1.patch
```

The 1.8.1 patch is CoderLine/alphaTab#2591 (drum tablature) back-ported. The alpha contains all of it (checked
2026-10-08 with `guitar-pro-rock-beat-repeat.gp`). A stale patch file fails every install: patch-package exits 1 and
skips every patch after it.

- [ ] **Step 3: The drum marker id after the upgrade**

After the upgrade a hi-hat on string 6 is drawn on the 6th tab line (as in Guitar Pro) instead of line 5. Drum notes
also have `note.fret = NaN`. In `cross-markers.tsx`, build the marker id for drum notes from
`note.percussionArticulation` instead of `note.fret`. Run the app's tests and look at a drum song.

- [ ] **Step 4: The patch, from an alpha that is an ancestor of the feature branch**

In the alphaTab feature worktree:

```bash
npm view @coderline/alphatab@<alpha> gitHead
git merge-base --is-ancestor <gitHead> HEAD && echo ancestor
```

If it isn't an ancestor: rebase `feat/2397-synth-with-media` onto `develop` at or after `<gitHead>`, run the repo
gates, rebuild (`npm run build`), push. Then copy the build into alphaTabWebsite and create the patch:

```bash
rm -r node_modules/@coderline/alphatab/dist
cp -R "$ALPHATAB_WORKTREE/packages/alphatab/dist" node_modules/@coderline/alphatab/dist
npx patch-package @coderline/alphatab
```

(`ALPHATAB_WORKTREE` is the feature worktree's absolute path in your shell.) Expected:
`patches/@coderline+alphatab+<alpha>.patch`. It only adds this feature, plus any `develop` commits newer than the
alpha.

- [ ] **Step 5: Turn it on (F-10)**

Where the rhythm game builds its alphaTab settings:

```ts
player: {
    // ...the existing player settings...
    enableSynthesizerWithMedia: true
}
```

Where it creates the YouTube player, add `controls: 0` and `disablekb: 1` to `playerVars`. Don't overlay the
player: YouTube's terms forbid it (§7). If the game starts alphaTab from YouTube's `PLAYING` event, call
`output.updatePosition(player.getCurrentTime() * 1000)` right before `api.play()` (F-6). Set
`mediaSyncOffsetInMilliseconds` to the value found by ear in Task 22 Step 9, if one was needed.

- [ ] **Step 6: Check, commit, push**

Run the app's tests. By ear: a backing-track song with the metronome, a loop, a speed change; the YouTube flow.

```bash
git add -A
git commit -m "feat: metronome along backing tracks and YouTube (alphaTab #2397 patch on <alpha>)"
git push -u origin feat/2397-synth-with-media
```

Opening a PR in alphaTabWebsite is your call in that repo.

---

### Task 27: notation-hero/web — the patch (`pnpm patch`) and turning the feature on (F-10)

**Files (notation-hero):** `pnpm-workspace.yaml` (`minimumReleaseAgeExclude`), `web/package.json`, `pnpm-lock.yaml`,
`patches/@coderline__alphatab@<alpha>.patch` (written by pnpm) and `patchedDependencies`, the app's alphaTab
settings, a notation-hero spec delta.

notation-hero is a pnpm workspace, so it uses `pnpm patch`. patch-package only writes patches next to an npm or yarn
lockfile. **F-10:** notation-hero keeps the external player's controls enabled while mixing is on. A start inside the
player then plays without a count-in (F-6). That is a notation-hero spec delta.

- [ ] **Step 1: A branch; let the alpha past the release-age rule**

```bash
git switch -c feat/2397-synth-with-media
```

In `pnpm-workspace.yaml`, add `'@coderline/alphatab@<alpha>'` to `minimumReleaseAgeExclude`. Use the exact
`name@version`, like the list's other entries, and update it with every alpha upgrade. Then:

```bash
pnpm run check:supply-chain-pins
```

Expected: passes (it flags a stale pin).

- [ ] **Step 2: Upgrade and patch**

```bash
pnpm --filter web add @coderline/alphatab@<alpha>
pnpm patch @coderline/alphatab@<alpha>
```

`pnpm patch` prints a folder. Check that `<alpha>`'s `gitHead` is an ancestor of the feature branch (Task 26 Step 4),
then:

```bash
rm -r "<printed folder>/dist"
cp -R "$ALPHATAB_WORKTREE/packages/alphatab/dist" "<printed folder>/dist"
pnpm patch-commit "<printed folder>"
```

Expected: a patch file under `patches/` and a `patchedDependencies` entry.

- [ ] **Step 3: Turn it on, and write the spec delta**

Set `player.enableSynthesizerWithMedia: true` where the app builds its alphaTab settings. Keep the external player's
controls enabled. Wire the media-started path to call `updatePosition()` right before `api.play()` (F-6). Then add
the spec delta to notation-hero's own spec docs, in that repo's existing format and folder. If the folder isn't
obvious, ask with a picker. The delta says:

> With mixing on, notation-hero keeps the external player's own controls: a start pressed inside the player plays
> the synthesizer from the player's position without a count-in; the count-in plays only for starts through the
> app's Play button.

- [ ] **Step 4: Check, commit, push**

Run the app's tests, then the same by-ear checks as Task 26 Step 6.

```bash
git add -A
git commit -m "feat: metronome along backing tracks (alphaTab #2397 pnpm patch on <alpha>)"
git push -u origin feat/2397-synth-with-media
```

---

### Task 28: Draft the #2397 comment — never posted without the person's OK

**Files:**
- Create: `docs/spikes/issue-2397/issue-comment-draft.md`

alphaTab's AGENTS.md applies to comments too:
- the one-line disclosure with `alphatab-ai-authored-v1`;
- no proposed patches;
- no diagnosis from alphaTab's source;
- nothing fabricated.

No PR without an accepted issue. So the comment describes the need and the measured outcome, and asks whether a
contribution would be welcome.

- [ ] **Step 1: Write the draft**

Use the template below and fill it with the acceptance numbers (Task 22) and the device results (Task 24):

```markdown
> _AI-assisted (`alphatab-ai-authored-v1`) — drafted with help of an AI agent._

We needed the metronome and count-in over backing tracks (and YouTube) in two apps, so we tried running the
synthesizer in sync with the media. Measured in Chromium on macOS with a generated beat track:

| | Result |
|---|---|
| Click vs beat at 1× (p95) | <S1> |
| At 1.25× / 1.5× (p95) | <S2> |
| At 0.5× / 0.75× (p95) | <S3> |
| First click after Play | <S4> |
| Loop wraps (0.5× / 1× / 1.5×) | <S10> |
| Count-in hand-off to the media | <S6> |
| iPad (WebKit) / Android (Chrome) | <device results> |

With the feature off nothing changes. Would a contribution along these lines be welcome? We can open a separate
issue describing the use case first, if that's preferred.
```

- [ ] **Step 2: STOP — ask before anything is posted**

Put to the person as `[Q-C1]`: post as drafted, edit first, or don't post. If they choose to post, they post it
themselves or explicitly ask for it to be posted. Never post on your own.

- [ ] **Step 3: Commit the draft**

```bash
git add docs/spikes/issue-2397/issue-comment-draft.md
git commit -m "docs: draft #2397 comment (not posted)"
git push
```

---

## After this plan (not tasks here)

- **Upstream PR (§11 step 5, optional and later):** only after a maintainer accepts an issue for it.
  - It needs C# and Kotlin versions of the shared changes: `IAlphaSynth.backingTrackVolume` and `synthVolume` on
    their players, and `IUiFacade.createMediaSynthPlayer` returning null.
  - It needs the alphaTab docs pages for the two settings and the two API members.
  - Drop the `docs/superpowers` and `docs/spikes` commits from the branch.
  - Add the `alphatab-ai-authored-v1` disclosure block to the PR body.
- **Later work the spec lists (§12):** a re-sync that keeps the synth's notes sounding; a direct worker → worklet
  `MessagePort`; Firefox and Safari tuning beyond the probe.
