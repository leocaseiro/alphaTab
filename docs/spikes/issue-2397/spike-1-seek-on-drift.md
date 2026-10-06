# Spike 1 — Seek the synth when it drifts from the media

> Part of the [CoderLine/alphaTab#2397](https://github.com/CoderLine/alphaTab/issues/2397) spike
> ("allow mixing the synthesizer with backing tracks / external media").
> Throwaway code on branch `spike/2397-sync-options`. Method, environment and the
> side-by-side table: [comparison.md](./comparison.md).

## The idea

This is the approach sketched in the issue:

> If the external media time updates indicate a drift of the time axis (simple threshold?),
> we need to seek the synthesizer. As the update should happen quite often, there is no need
> for a smooth correction.

- The backing track (`<audio>`) or external media is the clock. It drives the cursor exactly as
  today.
- The worker synthesizer plays in parallel (metronome and, optionally, the tracks). It follows the
  sync points, so it renders in the backing track's time axis (shared base, see
  [comparison.md](./comparison.md#shared-base-built-once-for-all-spikes)).
- On every media time update (every ~50 ms), the synth's position is compared with the media
  position. If they differ by more than **50 ms**, the synth is seeked to the media position.

```ts
// MixSpikePlayer._seekCheck(): runs on every media time update (~every 50 ms)
const synthNow = this._synthMediaPosition + (now - this._synthMediaPositionAt) * speed; // last report, extrapolated
const drift = synthNow - this._mediaTimeNow();
if (now >= this._ignoreUntil && Math.abs(drift) > this.seekThreshold /* 50 ms */) {
    this._resyncTo(this._mediaTimeNow()); // seek: buffered synth audio is dropped, generation restarts there
}
```

The synth reports its played position about every 20 ms. That position comes from the
worklet's "samples played" counter, relayed worklet → main thread → worker → main thread.

## Results

All numbers are measured inside Web Audio (see the method in [comparison.md](./comparison.md#method)).
**Offset = when the metronome click starts minus when the backing track's beep starts.** Positive
means the click is late. With this measurement, a perfectly aligned click reads about **−0.65 ms**
(see Spike 3).

| Scenario | Clicks | Before settling (first 1.5 s) | Settled mean | Settled p95 \|offset\| | Settled max | Seeks |
|---|---:|---|---:|---:|---:|---:|
| Play from 0:00, 1.0× | 57 | mean 28.8 ms, **one click 101 ms late** | +4.7 ms | 5.3 ms | 5.3 ms | 2 |
| Seek to 1:00, 1.0× | 35 | mean 4.9 ms | +4.7 ms | 5.3 ms | 5.3 ms | 1 |
| Seek to 1:40, 0.5× | 17 | mean 22.3 ms | +12.0 ms | 26.6 ms | 26.6 ms | 2 |
| Seek to 2:10, 1.5× | 21 | mean −21.8 ms | −22.2 ms | 24.3 ms | 24.3 ms | 2 |

The "Seeks" column includes the seek that alphaTab's own play/seek/speed change triggers. A
drift-triggered seek happened only once, at the start.

## What you would hear

- **At 1.0× it sounds fine, by luck.** After one seek the synth landed about 5 ms late, which is
  under the threshold, so it stays there for the whole song. The landing point depends on how long the
  seek round trip takes, not on any measurement.
- **Every Play has one late click.** The synth's audio starts about 100 ms after the MP3's
  (worklet creation plus the first buffer round trip). The first beat plays before the drift check
  catches it.
- **At 0.5× and 1.5× nothing corrects anything.** The 0.5× and 1.5× rows match the "no
  correction" baseline exactly, because the drift never exceeded 50 ms. The clicks stay wherever
  the seek landed: +12 ms (and up to 27 ms off) at 0.5×, and −22 ms at 1.5×.
- **Any offset under the threshold stays forever.** In the worst case that's 49 ms, which a
  drummer hears as a flam.

## Pros / cons (from the measurements)

| Pros | Cons |
|---|---|
| Smallest controller (~25 lines on top of the shared base) | Precision isn't controlled. Anything under the threshold stays, between 5 and 50 ms depending on luck |
| Works the same for `<audio>` and external media (YouTube) | Every correction is a seek: buffered synth audio is dropped and ringing notes are cut |
| Matches the maintainer's original idea | The first click after Play is ~100 ms late |
| No extra messages besides one position report every 20 ms | Speed-dependent `<audio>` latency (see comparison.md) isn't seen or corrected |

## How to reproduce

```text
npm run dev   (in the worktree, after `npm ci` and `npm run generate-typescript`)
open http://localhost:5173/demos/sync-spike/?mode=seek&src=beeps
click "Run measurement" (about 75 s, muted unless "audible" is checked)
```

`src=mp3` with `listen=1` plays your real MP3 with the metronome, for listening (no measurement).

Code: `packages/alphatab/src/platform/javascript/MixSpikePlayer.ts` (`_seekCheck`) plus the shared base.
