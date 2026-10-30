import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { craterRadius } from './textures';

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
