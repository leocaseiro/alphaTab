import { EventEmitter, EventEmitterOfT } from '@coderline/alphatab/EventEmitter';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { Settings } from '@coderline/alphatab/Settings';
import { BackingTrackPlayer } from '@coderline/alphatab/synth/BackingTrackPlayer';

class Out {
  timeUpdate = new EventEmitterOfT<number>(); backingTrackDuration = 16000; playbackRate = 1; masterVolume = 1; sampleRate = 44100;
  ready = new EventEmitter(); samplesPlayed = new EventEmitterOfT<number>(); sampleRequest = new EventEmitter();
  seekTo(_t: number) {} loadBackingTrack() {} open() { (this.ready as EventEmitter).trigger(); } play() {} destroy() {} pause() {}
  addSamples() {} resetSamples() {} activate() {}
  async enumerateOutputDevices() { return []; } async setOutputDevice() {} async getOutputDevice() { return null; }
}
const score = ScoreLoader.loadAlphaTex(`\\tempo 120 . \\ts 4 4 C4*4 | C4*4 | C4*4 | C4*4 | C4*4 | C4*4 | C4*4 | C4*4`);
for (const [label, mk] of [['no sync points', (g: MidiFileGenerator) => g.syncPoints], ['identity sync points', () => MidiFileGenerator.generateSyncPoints(score, true)]] as const) {
  for (const speed of [0.5, 1, 1.5]) {
    const midi = new MidiFile();
    const gen = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(midi));
    gen.generate();
    const out = new Out();
    const p = new BackingTrackPlayer(out as any, 500);
    p.loadMidiFile(midi);
    p.updateSyncPoints([...mk(gen)]);
    p.playbackSpeed = speed;
    p.play();
    (out.timeUpdate as EventEmitterOfT<number>).trigger(10000); // the recording is at 10 s
    console.log(`${label.padEnd(22)} speed ${speed}: timePosition=${p.timePosition.toFixed(1)} tickPosition=${p.tickPosition} (bar ${Math.floor(p.tickPosition / 3840) + 1}; the recording is in bar 6, tick 19200)`);
  }
}
