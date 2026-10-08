// F-1 spike: what today's AlphaSynthBase-derived media player (ExternalMediaPlayer) emits
// on Play with a count-in, a seek during playback, a loop wrap, the range end with looping off,
// and setting a playback range. Read-only: imports the worktree's sources.
import { readFileSync } from 'node:fs';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { Settings } from '@coderline/alphatab/Settings';
import { ExternalMediaPlayer, type IExternalMediaSynthOutput } from '@coderline/alphatab/synth/ExternalMediaPlayer';
import { PlaybackRange } from '@coderline/alphatab/synth/PlaybackRange';
import { PlayerState } from '@coderline/alphatab/synth/PlayerState';

const FILE = new URL('../../../../packages/alphatab/test-data/audio/syncpoints-testfile.gp', import.meta.url);

function prepare() {
    const score = ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(FILE)), new Settings());
    const midi = new MidiFile();
    const generator = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(midi));
    generator.generate();
    const player = new ExternalMediaPlayer(500);
    const output = player.output as IExternalMediaSynthOutput;
    const log: string[] = [];
    output.handler = {
        backingTrackDuration: 600000,
        playbackRate: 1,
        masterVolume: 1,
        seekTo: t => log.push(`handler.seekTo(${Math.round(t)})`),
        play: () => log.push('handler.play'),
        pause: () => log.push('handler.pause')
    };
    player.loadMidiFile(midi);
    player.loadBackingTrack(score);
    player.updateSyncPoints(generator.syncPoints);
    player.stateChanged.on(e => log.push(`stateChanged(${PlayerState[e.state]}, stopped=${e.stopped})`));
    player.finished.on(() => log.push('finished'));
    player.playbackRangeChanged.on(e =>
        log.push(`playbackRangeChanged(${e.playbackRange ? `${e.playbackRange.startTick}-${e.playbackRange.endTick}` : 'null'})`)
    );
    return { player, output, log };
}

function feedUntil(output: IExternalMediaSynthOutput, log: string[], marker: string, fromMs: number) {
    for (let t = fromMs; t < 120000; t += 20) {
        output.updatePosition(t);
        if (log.includes(marker)) {
            return t;
        }
    }
    return -1;
}

describe('F-1 today', () => {
    it('play() with countInVolume > 0 reports Playing at once', () => {
        const { player, log } = prepare();
        player.countInVolume = 1;
        log.length = 0;
        player.play();
        console.log('[count-in play]', JSON.stringify(log), 'state=', PlayerState[player.state],
            'isPlayingCountIn=', (player as any).sequencer.isPlayingCountIn);
    });

    it('seek during playback: no stateChanged', () => {
        const { player, output, log } = prepare();
        player.play();
        for (let t = 0; t < 1000; t += 20) output.updatePosition(t);
        log.length = 0;
        player.timePosition = 5000;
        console.log('[seek while playing]', JSON.stringify(log), 'state=', PlayerState[player.state]);
    });

    it('setting playbackRange seeks and raises playbackRangeChanged', () => {
        const { player, log } = prepare();
        log.length = 0;
        const r = new PlaybackRange();
        r.startTick = 3840;
        r.endTick = 7680;
        player.playbackRange = r;
        player.playbackRange = null;
        console.log('[set range, then null]', JSON.stringify(log));
    });

    it('loop wrap: finished + seek, no stateChanged', () => {
        const { player, output, log } = prepare();
        const r = new PlaybackRange();
        r.startTick = 3840;
        r.endTick = 7680;
        player.playbackRange = r;
        player.isLooping = true;
        player.play();
        log.length = 0;
        const at = feedUntil(output, log, 'finished', 0);
        console.log('[loop wrap] at media ms', at, JSON.stringify(log.slice(0, 6)), 'state=', PlayerState[player.state]);
    });

    it('range end with isLooping off: finished then stop', () => {
        const { player, output, log } = prepare();
        const r = new PlaybackRange();
        r.startTick = 3840;
        r.endTick = 7680;
        player.playbackRange = r;
        player.isLooping = false;
        player.play();
        log.length = 0;
        const at = feedUntil(output, log, 'finished', 0);
        console.log('[range end, no loop] at media ms', at, JSON.stringify(log.slice(0, 6)), 'state=', PlayerState[player.state],
            'tick=', player.tickPosition);
    });
});
