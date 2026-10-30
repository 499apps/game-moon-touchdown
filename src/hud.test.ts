import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { assistTargetVs } from './sim/assist';
import { G_MOON, LIMITS, STAR_FUEL_SECONDS } from './sim/constants';
import {
  FUEL_TICK_SECONDS,
  VS_GREEN,
  VS_MANUAL_CAP,
  VS_RED_BRAKE_SHARE,
  VS_STRICT_HEIGHT,
  VS_YELLOW,
  fuelMarkPercent,
  vsBand,
  vsBarMax,
  vsEnvelope,
  vsLimits,
  vsStopLimit,
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

describe('chart scale', () => {
  it('rounds up to a friendly number', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3.2)).toBe(5);
    expect(niceMax(430)).toBe(500);
    expect(niceMax(1000)).toBe(1000);
  });
});
