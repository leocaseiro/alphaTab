import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { Settings } from '@coderline/alphatab/Settings';
import { MidiFileSequencer } from '@coderline/alphatab/synth/MidiFileSequencer';

const stub: any = {
  masterVolume: 0, metronomeVolume: 0, outSampleRate: 44100, currentTempo: 120, timeSignatureNumerator: 4,
  timeSignatureDenominator: 4, activeVoiceCount: 0, noteOffAll() {}, resetSoft() {}, resetPresets() {}, loadPresets() {},
  setupMetronomeChannel() {}, synthesizeSilent() {}, dispatchEvent() {}, synthesize() { return []; },
  applyTranspositionPitches() {}, setChannelTranspositionPitch() {}, channelSetMute() {}, channelSetSolo() {},
  resetChannelStates() {}, channelSetMixVolume() {}, hasSamplesForProgram() { return true; }, hasSamplesForPercussion() { return true; }
};
// constant 120 BPM, 8 bars of 4/4 = 16 s; audio assumed aligned 1:1 with the score at 1x
const score = ScoreLoader.loadAlphaTex(`\\tempo 120 . \\ts 4 4 C4*4 | C4*4 | C4*4 | C4*4 | C4*4 | C4*4 | C4*4 | C4*4`);
const midi = new MidiFile();
const gen = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(midi));
gen.generate();
const dur = 16000;
const media = 10000; // media time (ms in the recording)
for (const [label, sp] of [['no sync points (generator.syncPoints)', gen.syncPoints], ['identity sync points (generateSyncPoints(score, true))', MidiFileGenerator.generateSyncPoints(score, true)]] as const) {
  for (const speed of [0.5, 1, 1.5]) {
    const seq = new MidiFileSequencer(stub);
    seq.loadMidi(midi);
    seq.mainUpdateSyncPoints([...sp]);
    seq.playbackSpeed = speed;
    const from = seq.mainTimePositionFromBackingTrack(media, dur);
    const midiTarget = from * speed; // spec section 4 step 2
    const cursorTick = seq.currentTimePositionToTickPosition(from); // what BackingTrackPlayer's cursor gets
    console.log(`${label.padEnd(54)} n=${sp.length} speed ${speed}: fromBackingTrack=${from.toFixed(1)} midiTarget(x speed)=${midiTarget.toFixed(1)} cursorTick=${cursorTick} (expected MIDI 10000 ms = tick ${10000 * 960 / 500})`);
  }
}
