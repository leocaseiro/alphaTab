import { readFileSync } from 'node:fs';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { Settings } from '@coderline/alphatab/Settings';
for (const f of ['packages/alphatab/test-data/audio/syncpoints-testfile.gp', 'packages/alphatab/test-data/temp/pelados.gp']) {
  const score = ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(f)), new Settings());
  const tempos: string[] = [];
  let sync = 0;
  for (const mb of score.masterBars) {
    for (const a of mb.tempoAutomations) tempos.push(`bar ${mb.index}: ${a.value}`);
    sync += mb.syncPoints?.length ?? 0;
  }
  console.log(f.split('/').pop(), 'score.tempo', score.tempo, 'bars', score.masterBars.length, 'syncPoints', sync, 'backingTrack', !!score.backingTrack);
  console.log('  distinct tempos:', [...new Set(score.masterBars.flatMap(m => m.tempoAutomations.map(a => a.value)))].join(', '));
  console.log('  first 12 automations:', tempos.slice(0, 12).join(' | '), tempos.length > 12 ? `... (${tempos.length} total)` : '');
}
