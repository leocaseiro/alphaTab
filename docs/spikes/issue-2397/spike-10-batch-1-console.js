// Spike 10 (CoderLine/alphaTab#2397): checks for review lap 2, batch 1 (findings F-8, F-12, FYI-4).
// Run 2026-10-09 in the playground's control page (http://localhost:5188/demos/control/index.html),
// which exposes window.alphaTab. Click the page once first (browsers only start audio after a click),
// paste this file into the console, then run `await spike10.runAll()` (or one test at a time).
// Each test builds its own hidden AlphaTabApi on today's code and destroys it afterwards. The patches
// (Worker, AudioWorklet.prototype.addModule, console.error) are restored after each test.
const spike10 = (() => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const SOUNDFONT = '/font/sonivox/sonivox.sf2';
    const SCORE = '/test-data/audio/syncpoints-testfile.gp'; // has a backing track
    const bytes = async url => new Uint8Array(await (await fetch(url)).arrayBuffer());
    const stateName = s => (s === 1 ? 'Playing' : s === 0 ? 'Paused' : String(s));

    function makeApi(player) {
        const el = document.createElement('div');
        el.style.cssText = 'position:absolute;left:-10000px;top:0;width:900px;height:300px';
        document.body.appendChild(el);
        const settings = new alphaTab.Settings();
        settings.fillFromJson({ core: { fontDirectory: '/font/bravura/', useWorkers: false }, player });
        const api = new alphaTab.AlphaTabApi(el, settings);
        const t0 = performance.now();
        const events = [];
        const rec = name => arg =>
            events.push({
                t: Math.round(performance.now() - t0),
                event: name,
                detail: arg?.message ?? (arg && 'state' in arg ? stateName(arg.state) : undefined)
            });
        api.playerReady.on(rec('api.playerReady'));
        api.soundFontLoaded.on(rec('api.soundFontLoaded'));
        api.error.on(rec('api.error'));
        api.playerStateChanged.on(rec('api.playerStateChanged'));
        api.player.readyForPlayback.on(rec('wrapper.readyForPlayback'));
        api.player.soundFontLoadFailed.on(rec('wrapper.soundFontLoadFailed'));
        const instance = api.player.instance;
        instance?.soundFontLoadFailed.on(rec('instance.soundFontLoadFailed'));
        return {
            api,
            events,
            t0,
            instanceClass: instance?.constructor?.name ?? null,
            done: () => {
                api.destroy();
                el.remove();
            }
        };
    }

    async function waitReady(h, timeoutMs) {
        const start = performance.now();
        while (!h.api.isReadyForPlayback && performance.now() - start < timeoutMs) {
            await sleep(100);
        }
        return h.api.isReadyForPlayback ? Math.round(performance.now() - h.t0) : null;
    }

    // F-8 (a): the synth worker's script fails to load (404), as when a bundler drops the worker file
    async function workerFails() {
        const RealWorker = window.Worker;
        const workerEvents = [];
        window.Worker = function (_url, options) {
            const w = new RealWorker('/spike-10-missing-worker.js', options);
            w.addEventListener('error', e => workerEvents.push({ type: e.type, message: e.message || null }));
            return w;
        };
        let h;
        try {
            h = makeApi({ playerMode: alphaTab.PlayerMode.EnabledSynthesizer, soundFont: SOUNDFONT });
            h.api.load(await bytes(SCORE));
            await sleep(6000);
            return {
                instanceClass: h.instanceClass,
                workerEvents,
                apiEvents: h.events,
                isReadyForPlayback: h.api.isReadyForPlayback
            };
        } finally {
            window.Worker = RealWorker;
            h?.done();
        }
    }

    // F-8 (b): the audio worklet's module fails to load (control: the real module)
    async function workletFails(control) {
        const realAdd = AudioWorklet.prototype.addModule;
        const realError = console.error;
        const logged = [];
        if (!control) {
            AudioWorklet.prototype.addModule = () => Promise.reject(new Error('spike 10: worklet module failed'));
        }
        console.error = (...args) => {
            logged.push(args.map(String).join(' ').slice(0, 200));
            realError.apply(console, args);
        };
        let h;
        try {
            h = makeApi({
                playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
                outputMode: alphaTab.PlayerOutputMode.WebAudioAudioWorklets,
                soundFont: SOUNDFONT
            });
            h.api.load(await bytes(SCORE));
            const readyAfterMs = await waitReady(h, 10000);
            h.api.masterVolume = 0; // silent: only the clock matters
            h.api.play();
            await sleep(3000);
            return {
                control,
                instanceClass: h.instanceClass,
                readyAfterMs,
                stateAfterPlay: stateName(h.api.playerState),
                timePositionMsAfter3s: Math.round(h.api.timePosition),
                errorsLogged: logged,
                apiEvents: h.events
            };
        } finally {
            AudioWorklet.prototype.addModule = realAdd;
            console.error = realError;
            h?.done();
        }
    }

    // F-8 (c): the SoundFont download fails (network error) vs. a bad file (HTTP 404 body)
    async function soundFontFails(url) {
        let h;
        try {
            h = makeApi({ playerMode: alphaTab.PlayerMode.EnabledSynthesizer, soundFont: url });
            h.api.load(await bytes(SCORE));
            await sleep(4000);
            return { url, instanceClass: h.instanceClass, apiEvents: h.events, isReadyForPlayback: h.api.isReadyForPlayback };
        } finally {
            h?.done();
        }
    }

    // F-12: what the output-device calls do per player mode. Never calls enumerateOutputDevices on
    // the Web Audio outputs, because that asks for microphone permission (to read device labels).
    async function deviceCalls() {
        const fakeDevice = { deviceId: 'spike-10-device', label: 'Spike 10 headphones', isDefault: false };
        const out = { audioContextHasSetSinkId: 'setSinkId' in AudioContext.prototype };
        let h = makeApi({ playerMode: alphaTab.PlayerMode.EnabledExternalMedia });
        try {
            h.api.load(await bytes(SCORE));
            await sleep(1500);
            out.externalMedia = {
                instanceClass: h.instanceClass,
                enumerate: await h.api.enumerateOutputDevices(),
                setResolves: await h.api.setOutputDevice(fakeDevice).then(() => true, e => String(e)),
                getAfterSet: await h.api.getOutputDevice()
            };
        } finally {
            h.done();
        }
        h = makeApi({ playerMode: alphaTab.PlayerMode.EnabledSynthesizer, soundFont: SOUNDFONT });
        try {
            h.api.load(await bytes(SCORE));
            await waitReady(h, 10000);
            out.synth = {
                instanceClass: h.instanceClass,
                getOutputDevice: await h.api.getOutputDevice(),
                setDefaultResolves: await h.api.setOutputDevice(null).then(() => true, e => String(e))
            };
        } finally {
            h.done();
        }
        // a <audio> captured by createMediaElementSource: setSinkId still resolves, so callers see success
        const ctx = new AudioContext();
        const a = new Audio();
        ctx.createMediaElementSource(a).connect(ctx.destination);
        out.capturedElement = {
            setSinkIdResolves: await a.setSinkId('').then(() => true, e => String(e)),
            sinkId: a.sinkId
        };
        await ctx.close();
        return out;
    }

    // FYI-4: backing track with no SoundFont URL, then a SoundFont loaded through api.loadSoundFont()
    async function lateSoundFont() {
        const h = makeApi({ playerMode: alphaTab.PlayerMode.EnabledBackingTrack });
        try {
            h.api.load(await bytes(SCORE));
            const readyAfterMs = await waitReady(h, 8000);
            const instance = h.api.player.instance;
            const calls = [];
            const original = instance.loadSoundFont.bind(instance);
            instance.loadSoundFont = (data, append) => {
                calls.push({ bytes: data?.length ?? null, append });
                return original(data, append);
            };
            h.api.loadSoundFont(await bytes(SOUNDFONT));
            await sleep(1500);
            return {
                instanceClass: instance.constructor.name,
                readyWithoutSoundFontAfterMs: readyAfterMs,
                soundFontSettingAfterApiLoad: h.api.settings.player.soundFont,
                instanceLoadSoundFontCalls: calls,
                apiEvents: h.events
            };
        } finally {
            h.done();
        }
    }

    async function runAll() {
        const results = { date: new Date().toISOString(), userAgent: navigator.userAgent };
        results.f8WorkerFails = await workerFails();
        results.f8WorkletFails = await workletFails(false);
        results.f8WorkletControl = await workletFails(true);
        results.f8SoundFontNetworkError = await soundFontFails('http://127.0.0.1:1/spike-10.sf2');
        results.f8SoundFontHttp404 = await soundFontFails('/font/sonivox/spike-10-missing.sf2');
        results.f12DeviceCalls = await deviceCalls();
        results.fyi4LateSoundFont = await lateSoundFont();
        window.spike10Results = results;
        console.log(JSON.stringify(results, null, 1));
        return results;
    }

    return { workerFails, workletFails, soundFontFails, deviceCalls, lateSoundFont, runAll };
})();
window.spike10 = spike10;
