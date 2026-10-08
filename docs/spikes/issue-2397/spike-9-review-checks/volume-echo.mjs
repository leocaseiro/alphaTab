// F-7 spike: the ExternalMediaSample wiring (handler sets el.volume; el 'volumechange' -> api.masterVolume)
// with today's handler value (masterVolume) vs the spec's §7 value (masterVolume x backingTrackVolume).
// The fake element follows HTMLMediaElement: volumechange is queued as a task only when the value changes.
function run(label, product, backingTrackVolume, startMaster) {
    return new Promise(resolve => {
        let events = 0;
        const el = {
            _v: 1,
            listeners: [],
            get volume() { return this._v; },
            set volume(v) {
                if (v < 0 || v > 1) throw new Error('IndexSizeError');
                if (v !== this._v) { this._v = v; setTimeout(() => this.listeners.forEach(l => l()), 0); }
            }
        };
        const handler = { set masterVolume(v) { el.volume = v; } };
        const api = {
            _m: 1,
            get masterVolume() { return this._m; },
            set masterVolume(v) {
                this._m = Math.max(v, 0); // SynthConstants.MinVolume = 0
                handler.masterVolume = product ? this._m * backingTrackVolume : this._m;
            }
        };
        el.listeners.push(() => { events++; api.masterVolume = el.volume; });
        api.masterVolume = startMaster;
        setTimeout(() => {
            resolve(`${label}: after 300 ms ${events} volumechange events, masterVolume=${api.masterVolume.toExponential(3)}, element volume=${el.volume.toExponential(3)}`);
        }, 300);
    });
}
console.log(await run('today (handler gets masterVolume)', false, 0.35, 0.8));
console.log(await run('spec §7 (handler gets masterVolume x 0.35)', true, 0.35, 0.8));
console.log(await run('spec §7, backingTrackVolume 1 (default)', true, 1, 0.8));
