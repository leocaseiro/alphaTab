// Spike 8 (CoderLine/alphaTab#2397): output limiter settings.
// Paste into the console of any page (run 2026-10-08 in the playground page, Chromium).
// Worst case for clipping: a click crest lands exactly on a recording crest.
// "Recording": 100 Hz sine peaking at -2.3 dBFS; "click": 20 ms 1 kHz burst peaking at
// -11.4 dBFS x synthVolume (both levels from spike 5), at 1 s and 2 s. Offline render, 48 kHz.
const SR = 48000, DUR = 3.0;
const dB = (x) => 20 * Math.log10(x);
const lin = (d) => Math.pow(10, d / 20);
const A_CLICK = lin(-11.4), CLICKS = [1.0, 2.0];

function source(synthVolume, recordingPeakDb = -2.3) {
  const aRec = lin(recordingPeakDb), n = Math.round(SR * DUR), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = aRec * Math.cos(2 * Math.PI * 100 * t);
    for (const c of CLICKS) {
      const u = t - c;
      if (Math.abs(u) <= 0.010) {
        const edge = Math.min(1, (0.010 - Math.abs(u)) / 0.001);
        v += synthVolume * A_CLICK * edge * Math.cos(2 * Math.PI * 1000 * u);
      }
    }
    x[i] = v;
  }
  return x;
}

// cfg: DynamicsCompressorNode parameters (null = no limiter); trimDb: gain after it
async function render(synthVolume, cfg, trimDb = 0, recordingPeakDb = -2.3) {
  const ctx = new OfflineAudioContext(1, Math.round(SR * DUR), SR);
  const buf = ctx.createBuffer(1, Math.round(SR * DUR), SR);
  buf.copyToChannel(source(synthVolume, recordingPeakDb), 0);
  const src = ctx.createBufferSource(); src.buffer = buf;
  let node = src;
  if (cfg) {
    const comp = ctx.createDynamicsCompressor();
    for (const [k, v] of Object.entries(cfg)) comp[k].value = v;
    node = node.connect(comp);
  }
  const trim = ctx.createGain(); trim.gain.value = lin(trimDb);
  node.connect(trim).connect(ctx.destination); src.start();
  const y = (await ctx.startRendering()).getChannelData(0);
  const peakIn = (a, b) => { let p = 0; for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) p = Math.max(p, Math.abs(y[i])); return p; };
  let over = 0; for (const v of y) if (Math.abs(v) > 1) over++;
  return { peak: +dB(peakIn(0, DUR)).toFixed(2), over0: over, recordingOnly: +dB(peakIn(0.5, 0.9)).toFixed(2) };
}

// Web Audio's automatic make-up gain for knee 0: 0.6 x the gain reduction at 0 dBFS input
const makeupDb = (threshold, ratio) => -0.6 * (threshold + (0 - threshold) / ratio);
const hard = (threshold) => ({ threshold, ratio: 20, knee: 0, attack: 0.001, release: 0.1 });
const configs = {
  none: [null, 0],
  asSpecified: [{ threshold: -1, ratio: 20 }, 0],          // knee 30, attack 3 ms, release 250 ms (defaults)
  proposedHardKnee: [hard(-1), 0],
  spikeOriginal: [hard(-3), 0],
  hardKneeTrim: [hard(-1), -makeupDb(-1, 20)],
  minus2: [hard(-2), 0],
  minus2Trim: [hard(-2), -makeupDb(-2, 20)],
  minus3Trim: [hard(-3), -makeupDb(-3, 20)],
};
const results = {};
for (const [name, [cfg, trim]] of Object.entries(configs)) {
  for (const sv of [1, 2, 3]) results[`${name}/synthVolume${sv}`] = await render(sv, cfg, trim);
  results[`${name}/hotRecording-0.3/synthVolume1`] = await render(1, cfg, trim, -0.3);
}
console.table(results);
