import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { craterRadius, craterShadow, craterShadowShift } from './textures';

describe('crater cast shadows', () => {
  const shift = craterShadowShift((12 * Math.PI) / 180);

  it('fall on the sun side of the floor, not the far side', () => {
    // Sun toward +x.
    expect(craterShadow(0.8, 0, 1, 0, shift)).toBeGreaterThan(0.9);
    expect(craterShadow(-0.8, 0, 1, 0, shift)).toBe(0);
    expect(craterShadow(0, 0, 1, 0, shift)).toBe(0);
    // Outside the crater: no shadow.
    expect(craterShadow(1.2, 0, 1, 0, shift)).toBe(0);
  });

  it('a lower sun gives a longer shadow, up to a cap', () => {
    expect(craterShadowShift(0.4)).toBeLessThan(craterShadowShift(0.2));
    expect(craterShadowShift(0.01)).toBeCloseTo(0.62, 9);
  });

  it('stay between 0 and 1 and only inside the bowl (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -2, max: 2, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
        (x, y, a) => {
          const s = craterShadow(x, y, Math.cos(a), Math.sin(a), shift);
          return s >= 0 && s <= 1 && (Math.hypot(x, y) < 1 || s === 0);
        },
      ),
    );
  });
});

describe('crater sizes', () => {
  it('stay between the smallest and the largest radius (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.999999, noNaN: true }), (u) => {
        const r = craterRadius(u, 1.5, 40);
        return r >= 1.5 - 1e-9 && r <= 40 + 1e-6;
      }),
    );
  });

  it('follow a power law: many small craters, few large ones', () => {
    const n = 2000;
    let small = 0;
    let large = 0;
    for (let i = 0; i < n; i++) {
      const r = craterRadius((i + 0.5) / n, 1.5, 40);
      if (r < 3) small++;
      if (r > 20) large++;
    }
    // N(> r) ~ r^-2: about 75% are under 2 x r_min, well under 1% are over 20 px.
    expect(small / n).toBeGreaterThan(0.7);
    expect(large / n).toBeLessThan(0.01);
    expect(craterRadius(0, 1.5, 40)).toBeCloseTo(1.5, 9);
  });
});
