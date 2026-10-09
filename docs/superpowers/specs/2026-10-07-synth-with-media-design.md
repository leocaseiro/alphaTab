---
lap: 2
last_applied: P1
---

# Synthesizer + backing track / external media mixing — design

| | |
|---|---|
| Issue | [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) — "External Media Sync / Backing Tracks - Allow mixing with Synthesizer" |
| Status | Design approved section by section (2026-10-07). Spec awaiting review |
| Base | `develop` @ `25ef76d3` (alphaTab 1.9.0 alpha) |
| Evidence | Spike on branch `spike/2397-sync-options`: [comparison](../../spikes/issue-2397/comparison.md) · [Spike 1](../../spikes/issue-2397/spike-1-seek-on-drift.md) · [Spike 2/2b](../../spikes/issue-2397/spike-2-timestamp-nudge.md) · [Spike 3](../../spikes/issue-2397/spike-3-decode-and-mix.md) · [Spike 4](../../spikes/issue-2397/spike-4-first-beat-and-loops.md) · [Spike 5](../../spikes/issue-2397/spike-5-unprobed-speeds-and-playbeat.md) · [Spike 6](../../spikes/issue-2397/spike-6-count-in-hand-off.md) · [Spike 7](../../spikes/issue-2397/spike-7-play-beat-with-media.md) · [Spike 8](../../spikes/issue-2397/spike-8-limiter-settings.md) · [Spike 9](../../spikes/issue-2397/spike-9-review-lap-2-checks.md) · [Spike 10](../../spikes/issue-2397/spike-10-batch-1-checks.md) · [Spike 11](../../spikes/issue-2397/spike-11-speed-changes.md) · raw numbers: [spikes 1–3](../../spikes/issue-2397/results.json), [spikes 4–11](../../spikes/issue-2397/results-2026-10-08.json) |

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
| S4 | First click after Play | within ±11 ms at 1× (two of Chrome's 5.3 ms `<audio>` start steps), ±20 ms at other speeds, never skipped (spike 4, start at target: 1× −5.3…+6.7 ms, 0.5× +2…+20 ms, 1.5× −12…+2.7 ms; 0 skips in 35 starts). The first Play at a speed with no learned start lead yet is still off (spike 4: 0.5× −29.6 ms) **(open)** |
| S4b | First click after a seek or speed change during playback | within ±11 ms at 1×, ±20 ms at other speeds (as S4), never skipped |
| S5 | One click per beat, no extra or missing clicks | 15/15 start cycles, plus a full song |
| S6 | Count-in with media | plays one bar of clicks at the media's tempo at the start position, then the media starts on the downbeat, no freeze, no rewind; the song's first beat within the first-click tolerance (S4) (spike 6, emulated count-in: 1× ±1.3 ms, 1.5× ≤ +2.7 ms, 0.5× ≤ +13.9 ms; the count-in MIDI itself **(untested)**). External media: for starts through alphaTab; a start inside the media player skips the count-in |
| S7 | Mixing off | no synth worker or AudioWorklet created, no extra main-thread work |
| S8 | Mixing on | CPU and main-thread cost comparable to plain synthesizer mode, no decoded audio in memory |
| S9 | External media (YouTube) | best-effort: in sync after `mediaSyncOffsetInMilliseconds` tuning **(untested)** |
| S10 | Loop wrap at 0.5× / 1× / 1.5× | the range's first beat clicks on every repetition within the first-click tolerance (S4b); no extra or missing clicks; ≤ 30 ms added per wrap (spike 4: 0 missing clicks at all three speeds, < 15 ms per wrap at 1×, ~24 ms at 0.5× / 1.5×) |
| S11 | Levels | metronome clearly audible over a mastered backing track at default levels (by ear, manual test); nothing clips (spike 5: click peak −11.4 dBFS, short-term level ~8 dB under the recording's; nothing over 0 dBFS at default levels) |

## 2. Decisions (made with the requester, in order)

| Ref | Decision |
|---|---|
| Target | A JS fix usable in the requester's own projects first (a patch: patch-package / `pnpm patch`). Upstream PR later, optional |
| Base | Latest upstream `develop` (1.9.0 alpha); consumers upgrade |
| Approach | **Timestamp lock + gentle speed nudging + per-speed latency calibration** (spike "2b"). Rejected: seek-on-drift (offsets < threshold never corrected), decode-and-mix (pitch shifts when slowed, 78.5 MB RAM, no YouTube) |
| Switch | Boolean setting `player.enableSynthesizerWithMedia` (default `false`) |
| Public additions | `player.mediaSyncOffsetInMilliseconds` (default 0) and runtime `api.backingTrackVolume` and `api.synthVolume` (both default 1) |
| Probe | Silent latency probe per speed, run **in the background after load** for 1×, 0.5×, 0.75×, 1.25×, 1.5×; other speeds on first use; cached per session |
| Count-in | **One bar** in the time signature at the start position (as today: 3 clicks in 3/4, 6 in 6/8), at the tempo from the **sync points** at the start position; if there are none, the score's tempo |
| External media | **Included in v1, best-effort** (fitted clock + manual offset) |
| Default tracks | Synth tracks **play by default** when mixing is on; existing mute/solo/volume apply |
| Code home | Shared TS for the synth "follow media" part; web-only (`platform/javascript`) for the combined player, sync controller and probe |
| Output mode | Mixing requires `PlayerOutputMode.WebAudioAudioWorklets` (default). ScriptProcessor → media only + warning |
| Verification | Keep the spike's measurement page as a playground demo ("sync lab") |
| Delivery | A patch (tarball for a first try) for **both**: patch-package in `alphaTabWebsite`, `pnpm patch` in `notation-hero/web` (see §11) |

## 3. Architecture

```text
 <audio> backing track ──createMediaElementSource──► mediaGain ───┐
                                                                   ├──► masterGain ──► limiter ──► destination
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
| Output limiter | `DynamicsCompressorNode` after `masterGain` (threshold −1 dBFS, ratio 20) so the sum of media and synth can't clip; mixing mode only. The spike's −3 dB would squash a mastered recording's own peaks (spike 5: −2.3 dBFS) | `platform/javascript/MediaSynthPlayer.ts` | web |
| `MediaSyncController` | Start/seek handshakes, settle, nudge, re-sync, learning | `platform/javascript/MediaSyncController.ts` (new; pure logic, unit-testable) | web (logic is platform-neutral) |
| Media clocks | Backing-track clock (routed `<audio>`) and external-media clock (fitted) | `platform/javascript/MediaClock.ts` (new) | web |
| `MediaLatencyProbe` | Measures `<audio>` time-stretch latency per speed | `platform/javascript/MediaLatencyProbe.ts` (new) | web |
| Wiring | Create `MediaSynthPlayer` when the setting is on | `AlphaTabApiBase.ts`, `IUiFacade`, `BrowserUiFacade.ts` | shared + web |
| Sync-lab diagnostics | `@internal` surface on `MediaSynthPlayer` for the sync lab (§9): the `AudioContext`, tap points (the media source node and the synth worklet node), controller stats (re-sync times, learned start leads and media-start latencies per speed, probe latencies) and a drift log that stays off unless the lab turns it on. Not public API (§7). The spike's lab read ~20 spike-player internals for spikes 4–7, and its drift log grew on every reading | `platform/javascript/MediaSynthPlayer.ts` | web |

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
   — the same mapping the cursor uses (`BackingTrackPlayer`), so what you see and hear agree. With no sync points the
   target is `nextMediaTime` itself (media time is MIDI time at 1×): that call then returns the media time unscaled,
   so `× playbackSpeed` would play at speed² tempo while the stamps still match the media. `seekToMediaTime` uses the
   same rule. The cursor keeps today's mapping there, off by the speed factor (not changed, see below).
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
is not playing). It renders as one stream with the song: no `output.resetSamples()` at the boundary while
following (today's count-in end flushes the output). Its end frame is reported (`countInEnd`, §5) so the
media start can be scheduled (§6.2).

**Not changed:** the normal (non-following) synth path, the exporter, the media players' cursor
logic.

The spike's `MixSpikePlayer` and `_spike*` methods are a reference only. The implementation is
written fresh, with tests, following §4–§7.

## 5. Worker protocol and AudioWorklet output (web)

New messages (main → worker): `alphaSynth.followMedia`, `alphaSynth.seekToMediaTime`,
`alphaSynth.setRateCorrection`. Extended (worker → main → worklet):
`alphaSynth.output.addSamples { samples, mediaStart?, mediaPerFrame? }`.
New (worklet → main): `alphaSynth.output.mediaTimestamp { frame, mediaTime }` about every 50 ms,
only while the block being output came entirely from stamped chunks, and
`alphaSynth.output.countInEnd { frame }` once the chunk holding the count-in's end is buffered (§6.2).

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
| `positionChanged` (none reaches the app during the count-in: today's synth raises it only once the song itself plays, so the cursor stays at the start position), `finished` (end of the song), `midiLoaded`, `loadedMidiInfo`, `currentPosition`, `timePosition`, `tickPosition` | media player (the clock) |
| `state`, `stateChanged` | `MediaSynthPlayer` itself: `Playing` from an app `play()` (also during the count-in and a delayed media start) until an app `pause()` / `stop()`, a `playOneTimeMidiFile`, `loadMidiFile` or the end of the song. The pauses, seeks and plays inside the start, seek and loop-wrap handshakes (§6.2) emit no `stateChanged` and start no count-in: only an app Play from Paused counts in, as today (today a loop wrap or a seek changes no state and plays no count-in) |
| `midiEventsPlayed`, `soundFontLoaded/Failed`, `loadSoundFont`, `resetSoundFonts`, `setChannel*`, transposition, `metronomeVolume`, `countInVolume` | synth |
| `masterVolume` | backing track: `masterGain` (covers media and synth; the inner players' own volumes stay at 1) · external media: forwarded to the inner `ExternalMediaPlayer` (its handler gets `masterVolume` alone, as today, §7) and applied to the synth through `masterGain` |
| `backingTrackVolume` (new) | backing track: `mediaGain` · external media: not applied; the app sets its own player's level (§7) |
| `synthVolume` (new) | `synthGain` |
| `play/pause/stop`, `playbackSpeed`, `loadMidiFile`, `updateSyncPoints`, `loadBackingTrack` | both, through the controller |
| `playOneTimeMidiFile` (`playBeat` / `playNote`) | both, through the controller: if playing, pause the media and the synth (the app sees `Paused`, as with today's synth-only player and the API docs: "This will stop the any other current ongoing playback"); the synth leaves follow mode (`followMedia(false)`, §4) and plays it on its own clock; the next Play follows the media again through the start handshake (§6.2). Following would map the media's position onto the one-time MIDI, fire all of it at once and pause the synth. Spike 7: `Paused` 0–1 ms after the click, the beat 8–12 ms after it, the next Play in sync in 11 of 12 starts |
| `playbackRange`, `isLooping`, `playbackRangeChanged` | `MediaSynthPlayer` itself (loop wrap, §6.2); the inner players run without them. Setting `playbackRange` seeks to its start (when not null) and raises `playbackRangeChanged` with the range it holds, as `AlphaSynthBase` does today. With `isLooping` off, at the range end it fires `finished` and stops both (back to the range start), as today |
| `ready` / `readyForPlayback` | when both are ready (then warm up the worklet, start the background probe). If the synth can't run — worker or worklet creation fails, no `player.soundFont` is set, or `soundFontLoadFailed` fires — readiness follows the media player alone and playback is media-only, with a warning (as for ScriptProcessor, §2). Each case needs a signal that reaches `MediaSynthPlayer` (spike 10): an `error` listener on the synth worker (today only `message` is heard, so a worker that fails to load reports nothing), a failure event from `AlphaSynthAudioWorkletOutput` when the warm-up worklet's module fails to load (today only logged), and a SoundFont download failure raised on the player instance (today `loadSoundFontFromUrl` raises it on `api.player`, the wrapper). Only `MediaSynthPlayer` acts on them; synth-only mode keeps today's behavior. Without `player.soundFont`, a SoundFont loaded later through `api.loadSoundFont()` (the documented alternative) ends the fallback: warm up the worklet, start the probe, and the synth joins from the next Play |
| `output` | the media output's members passed through (`audioElement`, `handler`, `updatePosition`, `timeUpdate`, …), so `output.audioElement` and an external-media `handler` keep working. `enumerateOutputDevices` / `setOutputDevice` / `getOutputDevice` use the synth output's own (the shared `AudioContext`'s `setSinkId` / `sinkId`, behind its support check), because a captured `<audio>` is no longer heard directly and the external-media output ignores device calls. With external media only the synth moves; the app moves its own player |

Routing: the backing track's `<audio>` goes through `createMediaElementSource` into the synth's
`AudioContext` (one clock, one output latency; spike: `currentTime` equals graph time within ~1 ms
at 1×). Output-device selection then follows the `AudioContext`, through `output`'s device methods (above).

### 6.2 `MediaSyncController` — rules

Inputs: worklet stamps `(frame, synthMediaTime)`, a media clock giving `mediaTimeAt(frame)`.
`drift = synthMediaTime − mediaTimeAt(frame)` (+ = synth ahead).

| Rule | Value (internal constants) |
|---|---|
| Act only on **two consecutive readings that agree within 3 ms** (use their mean) | 3 ms |
| Settling window after play/seek/speed change | 1.5 s |
| Re-sync threshold while settling | 12 ms at 1× (above two of Chrome's 5.3 ms `<audio>` start steps), 15 ms at other speeds (time-stretch jitter). While settling at 1×, smaller offsets are closed by a faster nudge (gain 300 ms instead of 3000 ms, still ±2 %), not by a re-sync, so sounding notes aren't cut (spike 4: 0 re-syncs in 30 starts; at 4 ms, 10 re-syncs in 6 of 15 starts, and with unmuted drums each one cut them to silence) |
| Re-sync threshold when locked | 120 ms |
| Nudge | `correction = 1 − clamp(EMA(drift) / 3000 ms, ±2%)`, EMA factor 0.3 |
| Re-sync lead | learned from the first agreed drift after each re-sync (clamped 0–100 ms) |
| **Start handshake** | learned start lead L, **one per speed** (median of the first 3 readings after Play). If the synth is slower (L > 0) the **media start is delayed by L**. If the media is slower, the synth starts L earlier in the song. At 1× the synth starts **at** the target, never past it: a positive offset is caught up after the first beat by the faster settling nudge (gain 300 ms, still ±2 %; the 1× offset measured 0.1–1.6 ms, spike 5). At any other speed both start ~60 ms of media time before the target (Chrome's time-stretch distorts the first tens of ms, above and below 1×), and the synth starts where the media will be heard (latency offset applied), still before the target (spike 6: at 0.5× the first two clicks within +15 ms; starting at the target had the 2nd click up to +57 ms late). A beat at the start position is always rendered (spike 4: 0 skips at 0.5× / 1× / 1.5×) |
| **Seek handshake** | Backing track: a seek while playing restarts through the start handshake (pause both, seek both, play both; no count-in, no `stateChanged`, §6.1). External media (can't be held): synth silent until the first position update after the jump, then restarts at the target (same rule) |
| **Loop wrap** | `MediaSynthPlayer` owns `playbackRange` and `isLooping`. Just before the range end (the song's end when no range is set: `isLooping` alone loops the whole song, as today) it fires `finished` (as today), then pauses both, seeks both to the range start (~60 ms earlier at speeds other than 1×) and restarts them through the start handshake, with no count-in and no `stateChanged` (§6.1), so the range's first beat plays on every repetition (spike 4: 0 missing clicks at 0.5× / 1× / 1.5×; the backing track owning the wrap added 29–50 ms per wrap at 1× and lost beats at 1.5×) |
| Speed change | apply speed to both, use the new speed's latency (probe value, else the §6.4 guess), re-sync, settle. The re-sync is needed: every change puts Chrome's media 15–43 ms behind the synth (spike 11), so a held tempo sweep re-syncs, and cuts the synth's sounding notes, at every step |
| Count-in | the worker renders the count-in (one bar, §2) and then the song as one stamped stream (no buffer reset at the boundary). Once the chunk holding the boundary is buffered, the worklet reports its context frame (`countInEnd`); the media's `play()` is issued a learned media-start latency (one per speed) before that frame, with the start handshake's media pre-roll. The controller waits until the media plays; if `countInEnd` hasn't arrived by the count-in's length plus 250 ms, the media starts anyway and playback is media-only (§6.1). Spike 6's hand-offs ran at most 4.8 ms late, so this fires only when the hand-off never comes. Cursor stays at the start position meanwhile (spike 6: downbeat 1× ±1.3 ms, 1.5× 0…+2.7 ms, 0.5× with pre-roll +4.5…+13.9 ms, never skipped) |
| **External media start** | Through alphaTab (`play()` while the media is paused, e.g. the app's own Play button): count-in and start handshake as for the backing track; the handler's `play()` is issued a learned media-start latency before the downbeat (spike 6: YouTube's clock starts ~45 ms after `playVideo()`, ±3 ms in 17 of 20 starts). If the media hasn't started by the downbeat (buffering), the synth restarts at the media's position once it advances (as after an external-media seek). Started by the media (its position already advancing when `play()` is called, e.g. play pressed inside YouTube, which reaches the app ~220 ms late): no count-in and no start-lead learning; the synth starts at the media's position and locks through the settling re-sync |

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
session. If it fails, the latency is 0. While the active speed has no measured value yet (not probed
yet, or the `AudioContext` not running yet), use a straight-line guess between the nearest measured
speeds (outside them, the nearest value; none measured: 0), and probe that speed next, ahead of the
background list. A value that arrives during playback is applied like a speed change (re-sync,
settle). Spike values (Chrome): 1×: 0, 0.5×: 60, 0.75×: 27, 1.25×: −4, 1.5×: −4 ms. Spike 5 at
speeds outside the list (0.25×: 80, 0.6×: 54, 0.83×: 20, 0.9×: 18, 1.1×: −4, 2×: −6 ms): the guess
was at most 7.3 ms off between 0.5× and 1.5× and 20 ms off at 0.25×; using 0 was 4–80 ms off. Chrome
probably skips time-stretching at exactly 1×, so speeds near 1 keep most of the stretch latency
(0.9×: 18 ms).

## 7. Public API

```ts
// settings (JSON: player.*)
enableSynthesizerWithMedia: boolean = false;     // run the synth along a backing track / external media
mediaSyncOffsetInMilliseconds: number = 0;       // + = synth plays later; manual fine-tune

// runtime (AlphaTabApiBase + IAlphaSynth implementations)
backingTrackVolume: number = 1;                  // the backing track's own level (masterVolume still scales both); not applied to external media
synthVolume: number = 1;                         // the synth's level against the media when mixing is on
```

`backingTrackVolume` is added to `IAlphaSynth` (public interface, so a minor break for third-party
implementations): `AlphaSynth` / worker synth ignore it; `BackingTrackPlayer` applies
`masterVolume × backingTrackVolume` to its `<audio>` (so it also works without mixing); `ExternalMediaPlayer`
ignores it and its handler keeps getting `masterVolume` alone, as today: an app that writes its player's
volume back into `masterVolume` (alphaTab's external-media sample does, on `volumechange`) would otherwise
drive the media and the synth toward 0;
`AlphaSynthWrapper` remembers it across player switches like `masterVolume`. `synthVolume` is added the
same way: `MediaSynthPlayer` applies it to `synthGain`; every other implementation ignores it
(`masterVolume` already scales a lone synth); `AlphaSynthWrapper` remembers it too.

External media: hide the player's own controls (YouTube: `controls: 0`, `disablekb: 1`) so starts go
through the app's Play button and keep their count-in (§6.2); don't overlay the player, YouTube's terms
forbid it.

Levels: at default levels the click sits about 8 dB under a mastered recording (spike 5). If it is too
quiet, lower `backingTrackVolume` (0.35 ≈ −9 dB; external media: the player's own volume) or raise `synthVolume`; the output limiter keeps
raised levels from clipping.

Behaviour of existing calls when mixing is on:

| Call | Effect |
|---|---|
| `metronomeVolume`, `countInVolume` | work in media modes (synth) |
| `changeTrackVolume/Mute/Solo`, transposition | synth tracks |
| Synth tracks (default) | active (not muted) when mixing is on; existing mute/solo/volume states apply (§2) |
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
media-only player. Web also returns `null`, and logs a warning, when `outputMode` is not
`WebAudioAudioWorklets` or AudioWorklets are unavailable (no `AudioWorkletNode`, or not a secure
context, where `createWorkerPlayer` already falls back to ScriptProcessor with only a debug log). `_setupOrDestroyPlayer` today only recreates the player when the *mode* changes; it
must also recreate it when `enableSynthesizerWithMedia` changes (via `updateSettings()`).

## 8. Fixes included, and coordination

| Item | Handling |
|---|---|
| Count-in freeze / rewind in media modes | Mixed mode: solved by design (§4, §6). Non-mixed modes: separate session "Fix count-in freeze in backing-track/external-media modes" (task chip) — keep both changes mergeable. External media: count-in only when alphaTab starts the media (§6.2) |
| `playNote` / `playBeat` during playback | Mixed mode: pauses both and plays on the synth's own clock (§6.1). Non-mixed modes (spike 7): the media jumps to the song start and plays ~0.4 s, then returns, to the right place at 1× and to the old position ÷ speed otherwise (2×: 43.9 s → 22.0 s). Out of scope here; tracked separately (task chip "Investigate playNote/playBeat rewinding backing tracks"). Near the song start the same path can freeze the page; the count-in freeze fix ([CoderLine/alphaTab#2932](https://github.com/CoderLine/alphaTab/pull/2932)) covers that loop |
| `midiEventsPlayed` silent in media modes | Fixed when mixing is on (real synth events). Non-mixed modes unchanged (out of scope) |
| Worklet request accounting | Fixed for all modes (§5) |

## 9. Testing

| Layer | Tests |
|---|---|
| Unit (vitest, Node) | Sequencer `fillMidiEventQueueUntil`; follow mode dispatches events at the right media times (sync points, tempo changes 135↔145 BPM, 0.5×/1.5×), using the repo's `syncpoints-testfile.gp`, and the same file with no sync points at 0.5×/1.5× (target = media time, not media time × speed) |
| | Chunk stamps consistent (`mediaStart + frames × mediaPerFrame` = next `mediaStart`); `seekToMediaTime`; rate correction |
| | `MediaSyncController` with fed readings: agreement rule, settle thresholds, nudge sign/limits, re-sync, lead learning, start handshake (media delay vs synth pre-roll, start at target never past it, one start lead per speed, media pre-roll and compensated start at speeds other than 1×), seek = restart, loop wrap, a jumpy-clock sequence that must not re-sync |
| | `MediaSynthPlayer` transport, with fake inner players: Play reports `Playing` at once, also during the count-in, and no `positionChanged` reaches the app until the media plays; a seek during playback and a loop wrap emit no `stateChanged` and play no count-in; setting a range seeks to its start and raises `playbackRangeChanged`; with `isLooping` off the range end fires `finished` and stops |
| | Count-in: one bar in the start bar's time signature, tempo from sync points / fallback, `countInEnd` frame, one stream through the boundary, no freeze, no rewind; external-media start through alphaTab vs started by the media |
| Browser — sync lab | Playground demo (the spike page, cleaned up): generated beep track from the file's sync points, two taps, per-click offsets, "Run measurement", start test with a skip check (the first beat after Play must have its own click) at 0.5× / 1× / 1.5×, including the first Play after page load, that also seeks and changes speed during playback on a beat, loop test (a 2-bar range, ≥ 10 wraps per speed), a listening check with unmuted, sustained tracks (no cut notes or dropouts after Play, a seek or a speed change), latency probe and click offsets also at 0.25× and 2×, count-in test (downbeat vs the media's first beat) at 0.5× / 1× / 1.5×, live readout. Acceptance: S1–S5, S4b, S10 |
| Browser — manual | Your real MP3 with drums/metronome by ear; YouTube demo with the metronome + offset (S9) |
| Browser — target devices | Before delivery (§11): the sync lab's start, loop and count-in tests and the listening check on an iPad (WebKit, in the Web MIDI Browser shim app both apps use there) and an Android tablet (Chrome), loaded over HTTPS (AudioWorklets need a secure context, §7). First note whether mixing runs at all (no media-only warning). Results go beside the §1 targets; acceptance as in the sync-lab row. A device that misses them stays media-only in both apps (each leaves `enableSynthesizerWithMedia` off there) until it passes |
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
- A re-sync that keeps the synth's notes sounding, so a held tempo sweep doesn't cut them at every step (spike 11).

## 13. Risks

| Risk | Mitigation |
|---|---|
| Firefox/Safari: different time-stretch latency or `createMediaElementSource` quirks | The probe measures at runtime; the target-device run (§9: iPad, Android tablet) gates delivery; manual checks before claiming other browsers; worst case the offset setting |
| YouTube precision unknown | Best-effort, fitted clock, manual offset; verified by ear |
| `createMediaElementSource` is one-shot per element and ties output to the `AudioContext` | Created once per output; device selection sets the context's sink (`MediaSynthPlayer.output`, §6.1), not the captured element's |
| AudioContext suspended (autoplay policy) | Existing resume-on-gesture logic; the probe waits until the context runs |
| Hidden probe playback in the background | Silent (never connected to the destination), ~6 s once per session; can be made lazy if needed |
