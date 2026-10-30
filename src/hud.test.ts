import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { assistTargetVs } from './sim/assist';
import { G_MOON, LIMITS, STAR_FUEL_SECONDS } from './sim/constants';
import {
  FUEL_TICK_SECONDS,
  SLOW_CUE_AFTER,
  SLOW_CUE_GAP,
  SlowCue,
  VS_BAR_GREEN,
  VS_BAR_SLOW,
  VS_BAR_YELLOW,
  VS_GREEN,
  VS_MANUAL_CAP,
  VS_RED_BRAKE_SHARE,
  VS_SLOW_SHARE,
  VS_STRICT_HEIGHT,
  VS_YELLOW,
  fuelMarkPercent,
  markerBand,
  speedBand,
  vsBand,
  vsBarMax,
  vsBarPos,
  vsBarZones,
  vsEnvelope,
  vsGreenMiddle,
  vsLimits,
  vsStopLimit,
  type Band,
} from './hud';
import { niceMax } from './graphs';

describe('speed-down bands', () => {
  it('green matches the soft-touchdown limit near the ground', () => {
    expect(VS_GREEN).toBe(LIMITS.vs);
    expect(vsBand(0)).toBe('good');
    expect(vsBand(1.99)).toBe('good');
    expect(vsBand(2)).toBe('warn');
    expect(vsBand(VS_YELLOW - 0.01)).toBe('warn');
    expect(vsBand(VS_YELLOW)).toBe('bad');
    expect(vsBand(2.5, VS_STRICT_HEIGHT - 0.1)).toBe('warn');
  });

  it('fast is fine high up, slow near the ground', () => {
    expect(vsBand(12, 300)).toBe('good');
    expect(vsBand(12, 5)).toBe('bad');
    expect(vsBand(13.5, 300)).toBe('warn');
    expect(vsBand(15, 300)).toBe('bad');
    expect(vsLimits(1000).green).toBeCloseTo(12.5, 9);
  });

  it('the hover helper target speed is always green (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2000, noNaN: true }), (h) => {
        const down = -assistTargetVs(h);
        // Below the strict height the helper flies at 1.5 to 2.1 m/s; at 2.0+ it is yellow by rule.
        if (h < VS_STRICT_HEIGHT && down >= VS_GREEN) return vsBand(down, h) === 'warn';
        return vsBand(down, h) === 'good';
      }),
    );
  });

  it('manual flight: yellow is "fast but stoppable", red is real danger', () => {
    const manual = { assist: false, hoverThrottle: 0.16 };
    // The fuel-star technique (hold 20 m/s up high) is yellow, not red.
    expect(vsBand(20, 300, manual)).toBe('warn');
    expect(vsBand(20, 300)).toBe('bad');
    // Faster than the cap is red at any height.
    expect(vsBand(VS_MANUAL_CAP + 0.1, 600, manual)).toBe('bad');
    // At 45 m, braking at 75% of the spare thrust stops from about 21.5 m/s.
    expect(vsStopLimit(45, 0.16)).toBeCloseTo(21.5, 1);
    expect(vsBand(19, 45, manual)).toBe('warn');
    expect(vsBand(22, 45, manual)).toBe('bad');
    // Green is the same in both modes; below 10 m the strict bands hold.
    expect(vsLimits(300, manual).green).toBe(vsLimits(300).green);
    expect(vsLimits(5, manual)).toEqual(vsLimits(5));
    // The helper on: the old bands.
    expect(vsLimits(300, { assist: true, hoverThrottle: 0.16 })).toEqual(vsLimits(300));
  });

  it('manual red line: braking at the red share from it only just stops in time (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: VS_STRICT_HEIGHT, max: 1500, noNaN: true }),
        fc.double({ min: 0.12, max: 0.25, noNaN: true }),
        (h, hov) => {
          const manual = { assist: false, hoverThrottle: hov };
          const lim = vsLimits(h, manual);
          const helper = vsLimits(h);
          const v = vsStopLimit(h, hov);
          const spare = G_MOON / hov - G_MOON;
          // Constant braking at the red share from v over (h - 10 m) ends at VS_YELLOW.
          const end = v * v - 2 * VS_RED_BRAKE_SHARE * spare * (h - VS_STRICT_HEIGHT);
          return (
            Math.abs(end - VS_YELLOW * VS_YELLOW) < 1e-6 &&
            lim.yellow >= helper.yellow - 1e-9 &&
            lim.yellow <= Math.max(helper.yellow, VS_MANUAL_CAP) + 1e-9 &&
            lim.green < lim.yellow &&
            vsStopLimit(h + 10, hov) >= v &&
            Math.abs(vsBarMax(h, manual) - 2 * lim.yellow) < 1e-9
          );
        },
      ),
    );
  });

  it('the envelope never drops below the touchdown limit and the bar keeps red on the right half', () => {
    fc.assert(
      fc.property(fc.double({ min: -50, max: 3000, noNaN: true }), (h) => {
        const lim = vsLimits(h);
        return (
          vsEnvelope(h) >= VS_GREEN &&
          lim.green < lim.yellow &&
          Math.abs(vsBarMax(h) - 2 * lim.yellow) < 1e-9
        );
      }),
    );
  });
});

describe('slow zone (F6: fly by hand without hovering the fuel away)', () => {
  const hov = fc.double({ min: 0.12, max: 0.25, noNaN: true });
  const high = fc.double({ min: VS_STRICT_HEIGHT, max: 2000, noNaN: true });
  const manualOf = (hoverThrottle: number) => ({ assist: false, hoverThrottle });

  it('the helper speed is green at every height, in manual and helper bands (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2000, noNaN: true }), hov, (h, hv) => {
        const down = -assistTargetVs(h);
        const want: Band = h < VS_STRICT_HEIGHT && down >= VS_GREEN ? 'warn' : 'good';
        return (
          vsBand(down, h, manualOf(hv)) === want &&
          vsBand(down, h, { assist: true, hoverThrottle: hv }) === want &&
          vsBand(down, h) === want
        );
      }),
    );
  });

  it('above 10 m the middle of green is at least 0.75 x the helper speed (property)', () => {
    fc.assert(
      fc.property(high, hov, (h, hv) => {
        const lim = vsLimits(h, manualOf(hv));
        const helper = -assistTargetVs(h);
        const mid = vsGreenMiddle(lim);
        // The design value: 0.925 x safe + 0.25 m/s (DESIGN section 4).
        return mid >= 0.75 * helper && Math.abs(mid - ((1 + VS_SLOW_SHARE) / 2) * vsEnvelope(h) - 0.25) < 1e-9;
      }),
    );
  });

  it('the slow zone sits below green, under the helper speed, in manual flight up high only (property)', () => {
    fc.assert(
      fc.property(high, hov, (h, hv) => {
        const lim = vsLimits(h, manualOf(hv));
        const helper = -assistTargetVs(h);
        return (
          lim.slow > 0 &&
          lim.slow < helper &&
          helper < lim.green &&
          lim.green < lim.yellow &&
          vsBand(lim.slow - 1e-6, h, manualOf(hv)) === 'slow' &&
          vsBand(lim.slow, h, manualOf(hv)) === 'good' &&
          vsLimits(h).slow === 0 &&
          vsLimits(h, { assist: true, hoverThrottle: hv }).slow === 0
        );
      }),
    );
    const manual = manualOf(0.16);
    expect(vsLimits(300, manual).slow).toBeCloseTo(VS_SLOW_SHARE * 12, 9);
    expect(vsBand(6, 300, manual)).toBe('slow');
    expect(vsBand(11, 300, manual)).toBe('good');
    // Helper flight has no slow zone: a slow start high up still reads green.
    expect(vsBand(6, 300)).toBe('good');
    expect(vsBand(6, 300, { assist: true, hoverThrottle: 0.16 })).toBe('good');
  });

  it('below 10 m the strict touchdown bands are unchanged: slow is good near the ground', () => {
    for (const mode of [undefined, manualOf(0.16), { assist: true, hoverThrottle: 0.16 }]) {
      for (const h of [0, 3, 9.99]) {
        expect(vsLimits(h, mode)).toEqual({ slow: 0, green: VS_GREEN, yellow: VS_YELLOW });
        expect(vsBand(0, h, mode)).toBe('good');
        expect(vsBand(0.3, h, mode)).toBe('good');
        expect(vsBand(1.99, h, mode)).toBe('good');
        expect(vsBand(2, h, mode)).toBe('warn');
        expect(vsBand(VS_YELLOW, h, mode)).toBe('bad');
      }
    }
  });

  it('speedBand: climbing counts as no speed down', () => {
    const manual = manualOf(0.16);
    expect(speedBand(1, 300, manual)).toBe('slow');
    expect(speedBand(1, 5, manual)).toBe('good');
    expect(speedBand(1, 300)).toBe('good');
    expect(speedBand(-12, 300)).toBe('good');
    expect(speedBand(-30, 300, manual)).toBe('bad');
    expect(speedBand(Number.NaN, 300, manual)).toBe('slow');
  });

  it('the bar is a zone gauge: monotonic, the zone edges in place, the helper speed on the green part (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2000, noNaN: true }), hov, fc.boolean(), (h, hv, assist) => {
        const mode = { assist, hoverThrottle: hv };
        const lim = vsLimits(h, mode);
        const max = vsBarMax(h, mode);
        const z = vsBarZones(lim);
        const pos = (v: number) => vsBarPos(v, lim, max);
        const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
        let prev = -1;
        for (let i = 0; i <= 60; i++) {
          const p = pos((max * 1.2 * i) / 60);
          if (p < prev - 1e-12 || p < 0 || p > 1) return false;
          prev = p;
        }
        const helper = -assistTargetVs(h);
        const helperOnGreen = h < VS_STRICT_HEIGHT || (pos(helper) > z.slow && pos(helper) < z.green);
        return (
          pos(0) === 0 &&
          near(pos(lim.green), VS_BAR_GREEN) &&
          near(pos(lim.yellow), VS_BAR_YELLOW) &&
          near(pos(max), 1) &&
          pos(max * 3) === 1 &&
          (lim.slow > 0 ? near(pos(lim.slow), VS_BAR_SLOW) && z.slow === VS_BAR_SLOW : z.slow === 0) &&
          // The middle of green in m/s is the middle of the green part on screen.
          near(pos(vsGreenMiddle(lim)), (z.slow + z.green) / 2) &&
          helperOnGreen
        );
      }),
    );
  });

  it('the cue "A bit faster saves fuel" shows after 4 s in the slow zone, only in manual flight', () => {
    const cue = new SlowCue();
    const dt = 1 / 60;
    const run = (seconds: number, band: Band, manual = true, free = true): number => {
      let shown = 0;
      for (let t = 0; t < seconds - 1e-9; t += dt) if (cue.update(dt, { band, manual, free })) shown++;
      return shown;
    };
    expect(run(SLOW_CUE_AFTER - 0.1, 'slow')).toBe(0);
    expect(run(0.2, 'slow')).toBe(1);
    // Once per stay in the slow zone.
    expect(run(10, 'slow')).toBe(0);
    // Leaving the zone resets the stay, but the gap holds the next cue back.
    expect(run(1, 'good')).toBe(0);
    expect(run(SLOW_CUE_AFTER + 1, 'slow')).toBe(0);
    expect(run(SLOW_CUE_GAP, 'slow')).toBe(1);
    // Never while Help flies, never over another call-out, never outside the slow zone.
    cue.reset();
    expect(run(SLOW_CUE_AFTER * 3, 'slow', false)).toBe(0);
    expect(run(SLOW_CUE_AFTER * 3, 'good')).toBe(0);
    expect(run(SLOW_CUE_AFTER * 2, 'slow', true, false)).toBe(0);
    // The slot frees up while the mark is still slow: the cue shows then.
    expect(run(dt * 2, 'slow', true, true)).toBe(1);
  });
});

describe('fuel bar marks', () => {
  it('places the star tick at 30 s and the plain tick at 60 s of the full tank', () => {
    expect(FUEL_TICK_SECONDS).toBe(60);
    expect(fuelMarkPercent(STAR_FUEL_SECONDS, 75)).toBeCloseTo(40, 9);
    expect(fuelMarkPercent(FUEL_TICK_SECONDS, 75)).toBeCloseTo(80, 9);
    // A small tank pins the marks to the right end; bad input stays on the bar.
    expect(fuelMarkPercent(60, 40)).toBe(100);
    expect(fuelMarkPercent(-5, 75)).toBe(0);
    expect(fuelMarkPercent(30, Number.NaN)).toBe(100);
  });
});

describe('touchdown marker colour (R4 finding 1)', () => {
  const bumpyFast = { outcome: 'bumpy' as const, vs: 11.9 };
  const soft = { outcome: 'soft' as const, vs: 1.2 };

  it('manual flight up high follows the HUD speed band, not the prediction', () => {
    const at = (band: Band) => markerBand(bumpyFast, { assist: false, band, altitude: 250 });
    expect(at('slow')).toBe('good');
    expect(at('good')).toBe('good');
    expect(at('warn')).toBe('warn');
    expect(at('bad')).toBe('bad');
    expect(markerBand(bumpyFast, { assist: false, band: 'good', altitude: VS_STRICT_HEIGHT })).toBe('good');
  });

  it('below the strict height and in helper flight it shows the predicted touchdown', () => {
    expect(markerBand(bumpyFast, { assist: false, band: 'good', altitude: VS_STRICT_HEIGHT - 0.1 })).toBe('bad');
    expect(markerBand({ outcome: 'bumpy', vs: 3 }, { assist: false, band: 'good', altitude: 5 })).toBe('warn');
    expect(markerBand(soft, { assist: false, band: 'bad', altitude: 5 })).toBe('good');
    expect(markerBand(bumpyFast, { assist: true, band: 'good', altitude: 250 })).toBe('bad');
    expect(markerBand(soft, { assist: true, band: 'bad', altitude: 250 })).toBe('good');
  });
});

describe('chart scale', () => {
  it('rounds up to a friendly number', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3.2)).toBe(5);
    expect(niceMax(430)).toBe(500);
    expect(niceMax(1000)).toBe(1000);
  });
});
