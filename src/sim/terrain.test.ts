import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Terrain } from './terrain';

const grid = (size: number) =>
  fc.array(fc.double({ min: -500, max: 500, noNaN: true }), { minLength: size * size, maxLength: size * size });

describe('terrain sampling', () => {
  it('is exact at grid points (property)', () => {
    fc.assert(
      fc.property(grid(6), fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 }), (hs, i, j) => {
        const t = new Terrain(6, 60, Float32Array.from(hs));
        return t.heightAt(t.coordOf(i), t.coordOf(j)) === t.at(i, j);
      }),
    );
  });

  it('is exact at grid points for any spacing (within rounding)', () => {
    fc.assert(
      fc.property(
        grid(5),
        fc.double({ min: 0.5, max: 200, noNaN: true }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        (hs, spacing, i, j) => {
          const t = new Terrain(5, spacing, Float32Array.from(hs));
          return Math.abs(t.heightAt(t.coordOf(i), t.coordOf(j)) - t.at(i, j)) < 1e-6 * (1 + Math.abs(t.at(i, j)));
        },
      ),
    );
  });

  it('is continuous: a tiny move changes the height by at most slope x distance (property)', () => {
    fc.assert(
      fc.property(
        grid(6),
        fc.double({ min: -150, max: 150, noNaN: true }),
        fc.double({ min: -150, max: 150, noNaN: true }),
        fc.double({ min: -0.01, max: 0.01, noNaN: true }),
        fc.double({ min: -0.01, max: 0.01, noNaN: true }),
        (hs, x, z, dx, dz) => {
          const t = new Terrain(6, 60, Float32Array.from(hs));
          let maxStep = 0;
          for (let j = 0; j < 6; j++) {
            for (let i = 0; i < 6; i++) {
              if (i < 5) maxStep = Math.max(maxStep, Math.abs(t.at(i + 1, j) - t.at(i, j)));
              if (j < 5) maxStep = Math.max(maxStep, Math.abs(t.at(i, j + 1) - t.at(i, j)));
            }
          }
          const bound = (maxStep / 60) * (Math.abs(dx) + Math.abs(dz)) * 2 + 1e-9;
          return Math.abs(t.heightAt(x + dx, z + dz) - t.heightAt(x, z)) <= bound;
        },
      ),
    );
  });

  it('clamps outside the grid', () => {
    const t = Terrain.fromFunction(4, 10, (x, z) => x + 2 * z);
    expect(t.heightAt(1e6, 0)).toBeCloseTo(t.heightAt(t.half, 0), 9);
    expect(t.heightAt(-1e6, -1e6)).toBeCloseTo(t.at(0, 0), 9);
    expect(t.contains(0, 0)).toBe(true);
    expect(t.contains(t.half + 1, 0)).toBe(false);
  });

  it('reproduces a plane and its slope', () => {
    const t = Terrain.fromFunction(16, 60, (x, z) => 0.1 * x - 0.05 * z + 3);
    expect(t.heightAt(17, -23)).toBeCloseTo(0.1 * 17 + 0.05 * 23 + 3, 4);
    const g = t.gradientAt(5, 5);
    expect(g.dx).toBeCloseTo(0.1, 5);
    expect(g.dz).toBeCloseTo(-0.05, 5);
    expect(t.slopeAt(5, 5)).toBeCloseTo(Math.atan(Math.hypot(0.1, 0.05)), 5);
    expect(Terrain.flat(8).slopeAt(0, 0)).toBe(0);
  });
});

describe('terrain decoding', () => {
  it('reads int16 little-endian in 0.5 m units with row 0 in the north', () => {
    const size = 3;
    const buf = new ArrayBuffer(size * size * 2);
    const view = new DataView(buf);
    const values = [-4, 0, 4, 10, 20, 30, -32768, 32767, 1];
    values.forEach((v, k) => view.setInt16(k * 2, v, true));
    const t = Terrain.fromInt16(buf, size, 60, 0.5);
    expect(Array.from(t.heights)).toEqual(values.map((v) => v * 0.5));
    // North is -z: the first row sits at z = -half.
    expect(t.heightAt(-60, -60)).toBe(-2);
    expect(t.heightAt(60, -60)).toBe(2);
    expect(t.heightAt(0, 60)).toBe(32767 * 0.5);
  });

  it('rejects short buffers and bad sizes', () => {
    expect(() => Terrain.fromInt16(new ArrayBuffer(10), 4, 60, 0.5)).toThrow();
    expect(() => new Terrain(1, 60, new Float32Array(1))).toThrow();
    expect(() => new Terrain(4, 0, new Float32Array(16))).toThrow();
  });
});
