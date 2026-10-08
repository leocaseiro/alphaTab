// FYI-4 spike: a media player (ExternalMediaPlayer extends BackingTrackPlayer) is ready for playback
// with no SoundFont at all today.
import { readFileSync } from 'node:fs';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { Settings } from '@coderline/alphatab/Settings';
import { ExternalMediaPlayer } from '@coderline/alphatab/synth/ExternalMediaPlayer';

const FILE = new URL('../../../../packages/alphatab/test-data/audio/syncpoints-testfile.gp', import.meta.url);

describe('FYI-4 today', () => {
    it('media player readiness without a SoundFont', () => {
        const score = ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(FILE)), new Settings());
        const midi = new MidiFile();
        new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(midi)).generate();
        const player = new ExternalMediaPlayer(500);
        let readyForPlaybackEvents = 0;
        player.readyForPlayback.on(() => readyForPlaybackEvents++);
        const before = player.isReadyForPlayback;
        player.loadMidiFile(midi);
        console.log('[no SoundFont] isReadyForPlayback before MIDI =', before, ', after MIDI =', player.isReadyForPlayback,
            ', isSoundFontLoaded =', player.isSoundFontLoaded, ', readyForPlayback events =', readyForPlaybackEvents);
    });
});
