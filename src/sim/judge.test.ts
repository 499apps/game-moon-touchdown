import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEG, LIMITS, STAR_FUEL_SECONDS, TARGET_RADIUS } from './constants';
import { judgeTouchdown, scoreStars } from './judge';

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
