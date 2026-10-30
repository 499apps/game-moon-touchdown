import { describe, expect, it } from 'vitest';
import { Terrain } from '../sim/terrain';
import { bakeSunShadow, sampleBaked } from './shade';

const SUN = { x: 1, z: 0, elevation: (12 * Math.PI) / 180 };

describe('baked sun shadows', () => {
  it('lights flat ground everywhere', () => {
    const lit = bakeSunShadow(Terrain.flat(32, 60, 5), SUN);
    expect(Array.from(lit).every((v) => v === 1)).toBe(true);
  });

  it('a tall wall on the sun side shades the ground behind it, not in front', () => {
    // Wall 150 m high at x >= 0; the sun is in the +x direction.
    const t = Terrain.fromFunction(32, 60, (x) => (x >= 0 ? 150 : 0));
    const lit = bakeSunShadow(t, SUN);
    const n = t.size;
    const row = 16;
    const wallStart = Math.ceil(t.indexOf(0));
    // Just west of the wall: deep in its shadow (150 m wall, 12 deg sun -> about 700 m).
    expect(lit[row * n + (wallStart - 2)]).toBe(0);
    // Far west (960 m away): back in the sun.
    expect(lit[row * n + 0]).toBe(1);
    // On top of the wall: sunlit.
    expect(lit[row * n + (n - 2)]).toBe(1);
  });

  it('values stay in 0..1 and sampling is exact at grid points', () => {
    const t = Terrain.fromFunction(24, 60, (x, z) => 80 * Math.sin(x / 200) * Math.cos(z / 260));
    const lit = bakeSunShadow(t, { x: 0.6, z: -0.8, elevation: 0.2 });
    for (const v of lit) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(sampleBaked(lit, 24, 5, 7)).toBe(lit[7 * 24 + 5]);
  });
});
