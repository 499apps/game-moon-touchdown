import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { assistTargetVs } from './sim/assist';
import { LIMITS, STAR_FUEL_SECONDS } from './sim/constants';
import {
  FUEL_TICK_SECONDS,
  VS_GREEN,
  VS_STRICT_HEIGHT,
  VS_YELLOW,
  fuelMarkPercent,
  vsBand,
  vsBarMax,
  vsEnvelope,
  vsLimits,
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
