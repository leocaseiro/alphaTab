# Spike 10 — Failure signals, output devices and a late SoundFont

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike.
> Run 2026-10-09 while triaging the second design-review lap, in the playground's control page
> (Chromium 152, macOS), on today's code (`develop` @ `25ef76d3` plus the spike code). Each test builds
> its own hidden `AlphaTabApi` and destroys it afterwards; Play runs at volume 0.
> Script: [spike-10-batch-1-console.js](./spike-10-batch-1-console.js).
> Raw numbers: [results-2026-10-08.json](./results-2026-10-08.json) (key `spike10BatchOneChecks`; its
> timestamp is UTC, hence the earlier date).

## Why

Three review findings had only been confirmed by reading the code. Before deciding them, each claim
was run:

- **F-8:** if the synth part fails to load, nothing tells the player, so the media-only fallback the
  design promises can't start.
- **F-12:** output-device calls don't move the mixed sound.
- **FYI-4:** a SoundFont loaded through `api.loadSoundFont()` never ends the media-only fallback.

## 1. The synth worker's script fails to load (F-8)

**Setup.** `window.Worker` patched to load a missing script (HTTP 404), as when a bundler drops the
worker file. Synth mode, a score loaded, watched for 6 s.

| What | Result |
|---|---|
| The browser's `error` event on the worker | fired |
| alphaTab events (`playerReady`, `soundFontLoaded`, `error`, `readyForPlayback`) | none |
| `api.isReadyForPlayback` after 6 s | `false` |

alphaTab never hears about it: `AlphaSynthWebWorkerApi` listens to `message` only
(`AlphaSynthWebWorkerApi.ts:248`).

## 2. The audio worklet's module fails to load (F-8)

**Setup.** `AudioWorklet.prototype.addModule` patched to reject. Synth mode with the worklet output,
Play, then 3 s.

| | Worklet fails | Control (real worklet) |
|---|---|---|
| Ready for playback | after 135 ms | after 136 ms |
| State after Play | Playing | Playing |
| Position after 3 s | **0 ms** | 2896 ms |
| What the app is told | nothing; one console line, `Audio Worklet operation failed` | — |

The output reports ready before its worklet loads (`AlphaSynthAudioWorkletOutput.open()`), so the
player shows Playing while nothing plays and the position never moves.

## 3. The SoundFont fails (F-8)

| Failure | `api.error` | `soundFontLoadFailed` on `api.player` (the wrapper) | `soundFontLoadFailed` on the player instance |
|---|---|---|---|
| Download fails (connection refused) | fired | fired | **not fired** |
| Bad file (an HTTP 404 body) | fired | fired | fired ("Soundfont is not a valid Soundfont2 file") |

A failed download is raised by `AlphaTabApi.loadSoundFontFromUrl` on the wrapper
(`AlphaTabApi.ts:288`), so a player instance that combines two players can't see it. A bad file fails
inside the player, which does see it.

## 4. Count-in hand-off timing (F-8's 250 ms limit)

No new run. Spike 6's 34 count-in hand-offs issued the media's `play()` 0.2–4.8 ms after its
scheduled time (median 1.4 ms). The media normally starts before the count-in ends, so a limit of the
count-in's length plus 250 ms leaves at least 245 ms of headroom and fires only when the hand-off
never comes. The time-limit path itself is untested: there is no `MediaSynthPlayer` yet.

## 5. Output-device calls (F-12)

| Mode | `enumerateOutputDevices` | `setOutputDevice(…)` | `getOutputDevice` afterwards |
|---|---|---|---|
| External media (`ExternalMediaPlayer`) | `[]` | a headphones device: resolves, ignored | `null` |
| Synth (`AlphaSynthWebWorkerApi`) | not called (it asks for microphone permission) | `null` (default): resolves | `null` (default device) |

- This Chromium has `AudioContext.setSinkId`. Today's synth output already uses it, behind alphaTab's
  own support check (`WebAudioHelper.checkSinkIdSupport`).
- An `<audio>` captured by `createMediaElementSource` still accepts `setSinkId('')` without an error,
  so a caller sees success.
- Whether a captured element's sound follows its `setSinkId` is not something this run can tell: that
  needs two output devices and a listener. The Web Audio spec says a captured element's audio is no
  longer heard directly, only through the audio graph.

## 6. A SoundFont loaded through the API (FYI-4)

**Setup.** Backing-track mode with no SoundFont URL, `syncpoints-testfile.gp` loaded, then
`api.loadSoundFont(bytes)`.

| What | Result |
|---|---|
| Ready for playback without a SoundFont | yes, after 45 ms |
| `api.loadSoundFont(bytes)` reaches the player instance | yes: `BackingTrackPlayer.loadSoundFont` called once (1,351,896 bytes) |
| `settings.player.soundFont` afterwards | still `null` |

The instance hears an API-loaded SoundFont, so a combined player can end a media-only fallback at
that point. The URL setting stays empty, so a fallback keyed on the URL alone would never end.

## Confidence

- **High** for sections 1, 2, 3, 5 and 6: today's code, run in the browser, deterministic.
- **Medium** for section 4: the hand-off lateness is measured (spike 6); the time-limit path is not.

Not run: whether a captured `<audio>`'s sound follows `setSinkId` (needs two output devices and a
listener); Safari and Firefox; the fixes themselves (spec changes, and `MediaSynthPlayer` doesn't exist
yet).

## How to reproduce

```text
open http://localhost:5188/demos/control/index.html   (the playground dev server)
paste spike-10-batch-1-console.js into the console, then:  await spike10.runAll()
```
