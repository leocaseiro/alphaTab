# F-17 scratch simulation: does the two-agreeing-readings rule (3 ms) block the 120 ms re-sync
# while the external media clock is frozen (YouTube buffering)?
# Model: updatePosition() every 50 ms (the documented YouTube wiring keeps its interval running during
# BUFFERING); the clock is a linear fit over the last ~2 s of samples (OLS, Theil-Sen, or OLS with
# outlier rejection); worklet stamps every ~50 ms (phase-shifted); synth advances at 1x.
import statistics, random, sys

STALL_START = 10_000.0
STALL_LEN = float(sys.argv[1]) if len(sys.argv) > 1 else 3_000.0  # ms; spike 9 ran 3000 and 500
END = 16_000.0
UPDATE_MS = 50.0
STAMP_MS = 50.0
WINDOW = 2_000.0
random.seed(1)

def media_pos(t):
    if t < STALL_START:
        return t
    if t < STALL_START + STALL_LEN:
        return STALL_START
    return t - STALL_LEN

def ols(xs, ys):
    n = len(xs); mx = sum(xs)/n; my = sum(ys)/n
    sxx = sum((x-mx)**2 for x in xs)
    sxy = sum((x-mx)*(y-my) for x, y in zip(xs, ys))
    b = sxy/sxx if sxx else 0.0
    return b, my - b*mx

def theil_sen(xs, ys):
    slopes = []
    n = len(xs)
    for i in range(n):
        for j in range(i+1, n):
            if xs[j] != xs[i]:
                slopes.append((ys[j]-ys[i])/(xs[j]-xs[i]))
    b = statistics.median(slopes)
    a = statistics.median([y - b*x for x, y in zip(xs, ys)])
    return b, a

def ols_reject(xs, ys):
    b, a = ols(xs, ys)
    for _ in range(3):
        res = [y - (a + b*x) for x, y in zip(xs, ys)]
        mad = statistics.median([abs(r) for r in res]) or 1e-9
        keep = [(x, y) for (x, y), r in zip(zip(xs, ys), res) if abs(r) <= 3*1.4826*mad + 2]
        if len(keep) < 3:
            break
        b, a = ols([k[0] for k in keep], [k[1] for k in keep])
    return b, a

def run(fit_name, fit, jitter=0.5):
    samples = []  # (t, pos)
    t_next_update = 3.0
    t_next_stamp = 20.0
    synth = 0.0  # synth media time, advances 1:1 with real time
    synth_offset = 0.0
    prev = None
    log = []
    t = 0.0
    dt = 1.0
    resyncs = []
    agreed_during_stall = 0
    readings_during_stall = 0
    first_stall_detect = None
    prev_stamp_t = None
    while t <= END:
        if t >= t_next_update:
            samples.append((t + random.uniform(-jitter, jitter), media_pos(t)))
            t_next_update += UPDATE_MS
        if t >= t_next_stamp and t > 2_100:
            win = [(x, y) for x, y in samples if x >= t - WINDOW]
            b, a = fit([x for x, _ in win], [y for _, y in win])
            clock = a + b*t
            synth_time = t + synth_offset
            drift = synth_time - clock
            in_stall = STALL_START <= t < STALL_START + STALL_LEN + 500
            agreed = None
            if prev is not None and abs(drift - prev) < 3:
                agreed = (drift + prev) / 2
            # proposed stall rule: drift grows by more than half the time between the two readings
            if prev is not None and prev_stamp_t is not None and (drift - prev) > 0.5*(t - prev_stamp_t):
                if first_stall_detect is None and t >= STALL_START:
                    first_stall_detect = t
            if in_stall:
                readings_during_stall += 1
                if agreed is not None:
                    agreed_during_stall += 1
            if agreed is not None and abs(agreed) > 120:
                resyncs.append((round(t), round(agreed, 1), round(b, 3)))
                synth_offset = clock - t  # re-sync to the clock
                prev = None
            else:
                prev = drift
            prev_stamp_t = t
            log.append((t, drift, b, agreed))
            t_next_stamp += STAMP_MS + random.uniform(-1, 1)
        t += dt
    # summarize
    stall_log = [(round(tt), round(d, 1), round(bb, 3), None if ag is None else round(ag, 1))
                 for tt, d, bb, ag in log if STALL_START - 100 <= tt <= STALL_START + STALL_LEN + 2_100]
    max_drift = max(abs(d) for _, d, _, _ in stall_log)
    print(f'== {fit_name}')
    print(f'   stall {STALL_LEN:.0f} ms from t={STALL_START:.0f}; readings in stall(+0.5 s) {readings_during_stall}, agreed {agreed_during_stall}')
    print(f'   re-syncs (t, agreed drift, fit slope): {resyncs}')
    print(f'   max |drift| during stall and 2 s after: {max_drift:.0f} ms')
    print(f'   proposed stall rule first fires at t={first_stall_detect} ({None if first_stall_detect is None else round(first_stall_detect-STALL_START)} ms after the freeze)')
    for row in stall_log[::6]:
        print('     t, drift, slope, agreed:', row)

for name, f in (('OLS fit, last 2 s', ols), ('Theil-Sen fit, last 2 s', theil_sen), ('OLS + outlier rejection, last 2 s', ols_reject)):
    run(name, f)
