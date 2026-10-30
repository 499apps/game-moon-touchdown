import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEG, LIMITS, STAR_FUEL_SECONDS, TARGET_RADIUS } from './constants';
import {
  FUEL_OUT_HIGH,
  FUEL_STAR_TIP,
  fuelLeftText,
  fuelOutAdvice,
  helperFuelOutAdvice,
  helperLeftText,
  judgeTouchdown,
  scoreStars,
} from './judge';

const ok = { vs: 1, hs: 0.5, tilt: 2 * DEG, slope: 3 * DEG };

describe('landing judge', () => {
  it('passes a gentle, level, slow touchdown', () => {
    expect(judgeTouchdown(ok)).toEqual({ outcome: 'soft', reasons: [] });
  });

  it('uses strict limits at each boundary', () => {
    const below = (v: number) => v - 1e-9;
    expect(judgeTouchdown({ ...ok, vs: below(LIMITS.vs) }).outcome).toBe('soft');
    expect(judgeTouchdown({ ...ok, vs: LIMITS.vs }).reasons).toEqual(['fast']);
    expect(judgeTouchdown({ ...ok, hs: below(LIMITS.hs) }).outcome).toBe('soft');
    expect(judgeTouchdown({ ...ok, hs: LIMITS.hs }).reasons).toEqual(['drift']);
    expect(judgeTouchdown({ ...ok, tilt: below(LIMITS.tilt) }).outcome).toBe('soft');
    expect(judgeTouchdown({ ...ok, tilt: LIMITS.tilt }).reasons).toEqual(['tilt']);
    expect(judgeTouchdown({ ...ok, slope: below(LIMITS.slope) }).outcome).toBe('soft');
    expect(judgeTouchdown({ ...ok, slope: LIMITS.slope }).reasons).toEqual(['slope']);
  });

  it('the limits are 2 m/s, 1.2 m/s, 10 deg and 12 deg', () => {
    expect(LIMITS.vs).toBe(2);
    expect(LIMITS.hs).toBe(1.2);
    expect(LIMITS.tilt / DEG).toBeCloseTo(10, 9);
    expect(LIMITS.slope / DEG).toBeCloseTo(12, 9);
  });

  it('is soft exactly when every value is under its limit (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 6, noNaN: true }),
        fc.double({ min: 0, max: 4, noNaN: true }),
        fc.double({ min: 0, max: 0.6, noNaN: true }),
        fc.double({ min: 0, max: 0.6, noNaN: true }),
        (vs, hs, tilt, slope) => {
          const v = judgeTouchdown({ vs, hs, tilt, slope });
          const all = vs < LIMITS.vs && hs < LIMITS.hs && tilt < LIMITS.tilt && slope < LIMITS.slope;
          return (v.outcome === 'soft') === all && (v.reasons.length === 0) === all;
        },
      ),
    );
  });

  it('treats NaN as bumpy', () => {
    expect(judgeTouchdown({ ...ok, vs: Number.NaN }).outcome).toBe('bumpy');
  });
});

describe('stars', () => {
  const soft = judgeTouchdown(ok);
  const bumpy = judgeTouchdown({ ...ok, vs: 5 });

  it('gives one star per goal for a soft touchdown', () => {
    expect(scoreStars(soft, 10, 100).stars).toBe(3);
    expect(scoreStars(soft, TARGET_RADIUS + 1, 100).stars).toBe(2);
    expect(scoreStars(soft, 10, STAR_FUEL_SECONDS - 1).stars).toBe(2);
    expect(scoreStars(soft, 500, 0).stars).toBe(1);
    expect(scoreStars(soft, TARGET_RADIUS, STAR_FUEL_SECONDS).stars).toBe(3);
  });

  it('gives no stars for a bumpy touchdown', () => {
    expect(scoreStars(bumpy, 0, 500)).toEqual({ soft: false, close: false, fuel: false, stars: 0 });
  });
});

describe('fuel words', () => {
  it('explains running dry kindly, with a tip, up high and near the ground', () => {
    const high = fuelOutAdvice(FUEL_OUT_HIGH + 100);
    expect(high.text).toBe('Out of fuel up high: start braking a bit later next time.');
    expect(high.tip).toMatch(/^Tip: /);
    const low = fuelOutAdvice(FUEL_OUT_HIGH - 5);
    expect(low.text).toMatch(/So close!/);
    expect(low.tip).toMatch(/^Tip: /);
    // NaN height is treated as "up high", never as an error.
    expect(fuelOutAdvice(Number.NaN).text).toBe(high.text);
  });

  it('never uses shaming words (property)', () => {
    const harsh = /\b(fail\w*|bad|wrong|crash\w*|stupid|lose|loser|lost|dead|die|died)\b/i;
    fc.assert(
      fc.property(fc.double({ min: -10, max: 2000, noNaN: true }), (h) => {
        const a = fuelOutAdvice(h);
        return !harsh.test(a.text) && !harsh.test(a.tip);
      }),
    );
    expect(harsh.test(FUEL_STAR_TIP)).toBe(false);
    const helper = helperFuelOutAdvice();
    expect(harsh.test(helper.text) || harsh.test(helper.tip)).toBe(false);
  });

  it('a helper fuel-out talks about Help, never about the child braking', () => {
    const a = helperFuelOutAdvice();
    expect(a.text).toMatch(/Help/);
    expect(a.tip).toMatch(/^Tip: /);
    expect(`${a.text} ${a.tip}`).not.toMatch(/brak/i);
  });

  it('the fuel-star tip uses the speed gauge colours: yellow is fine, red means brake', () => {
    expect(FUEL_STAR_TIP).toMatch(/yellow/);
    expect(FUEL_STAR_TIP).toMatch(/before the red/);
  });

  it('shows the fuel left with the star line, and the helper number to beat', () => {
    expect(fuelLeftText(41.9)).toBe(`Fuel left: 41 s (star at ${STAR_FUEL_SECONDS} s)`);
    expect(fuelLeftText(-3)).toBe(`Fuel left: 0 s (star at ${STAR_FUEL_SECONDS} s)`);
    expect(helperLeftText(17.6)).toBe('Helper would have left ~18 s');
  });
});
