import { readFileSync } from 'node:fs';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { Settings } from '@coderline/alphatab/Settings';
const score = ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync('packages/alphatab/test-data/audio/syncpoints-testfile.gp')), new Settings());
for (const mb of score.masterBars) {
  const flags = [mb.isRepeatStart ? 'repeatStart' : '', mb.repeatCount ? 'repeatEnd x' + mb.repeatCount : '', mb.alternateEndings ? 'alt=' + mb.alternateEndings : '', mb.timeSignatureNumerator + '/' + mb.timeSignatureDenominator].filter(Boolean).join(' ');
  const sp = (mb.syncPoints ?? []).map(a => JSON.stringify({ms: a.syncPointValue?.millisecondOffset, occ: a.syncPointValue?.barOccurence, bpm: a.syncPointValue?.modifiedTempo})).join(' ');
  console.log('bar', mb.index, flags, sp);
}
