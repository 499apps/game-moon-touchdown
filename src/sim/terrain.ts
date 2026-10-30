/**
 * Terrain height field: a square grid of heights (m) with bilinear sampling, matching the LOLA
 * cut in public/data/terrain (256 x 256 points, 60 m apart, row 0 = north).
 *
 * World axes: x = east, z = south, y = up (the same as three.js). The grid centre (the landing
 * site) is at x = z = 0, so grid column i sits at x = (i - (size - 1) / 2) * spacing.
 */

export class Terrain {
  readonly size: number;
  readonly spacing: number;
  readonly heights: Float32Array;
  /** Half the side length (m). */
  readonly half: number;

  constructor(size: number, spacing: number, heights: Float32Array) {
    if (!Number.isInteger(size) || size < 2) throw new Error(`terrain: bad size ${size}`);
    if (!(spacing > 0)) throw new Error(`terrain: bad spacing ${spacing}`);
    if (heights.length !== size * size) {
      throw new Error(`terrain: expected ${size * size} heights, got ${heights.length}`);
    }
    this.size = size;
    this.spacing = spacing;
    this.heights = heights;
    this.half = ((size - 1) * spacing) / 2;
  }

  /** Side length of the square (m). */
  get extent(): number {
    return (this.size - 1) * this.spacing;
  }

  /** World x (or z) of grid column (or row) i. */
  coordOf(i: number): number {
    return (i - (this.size - 1) / 2) * this.spacing;
  }

  /** Grid column (or row) of world x (or z), not clamped, may be fractional. */
  indexOf(v: number): number {
    return v / this.spacing + (this.size - 1) / 2;
  }

  /** Height at a grid point; indices are clamped to the grid. */
  at(i: number, j: number): number {
    const n = this.size;
    const ii = i < 0 ? 0 : i >= n ? n - 1 : i;
    const jj = j < 0 ? 0 : j >= n ? n - 1 : j;
    return this.heights[jj * n + ii] as number;
  }

  /** Bilinear height in grid coordinates (clamped to the edges). */
  sampleGrid(gi: number, gj: number): number {
    const n = this.size;
    const fi = gi < 0 ? 0 : gi > n - 1 ? n - 1 : gi;
    const fj = gj < 0 ? 0 : gj > n - 1 ? n - 1 : gj;
    const i0 = Math.floor(fi);
    const j0 = Math.floor(fj);
    const i1 = i0 + 1 < n ? i0 + 1 : n - 1;
    const j1 = j0 + 1 < n ? j0 + 1 : n - 1;
    const tx = fi - i0;
    const tz = fj - j0;
    const h = this.heights;
    const h00 = h[j0 * n + i0] as number;
    const h10 = h[j0 * n + i1] as number;
    const h01 = h[j1 * n + i0] as number;
    const h11 = h[j1 * n + i1] as number;
    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    return top + (bottom - top) * tz;
  }

  /** Bilinear height at world (x, z). */
  heightAt(x: number, z: number): number {
    return this.sampleGrid(this.indexOf(x), this.indexOf(z));
  }

  /** Height gradient (dh/dx, dh/dz) by central differences over +-r metres. */
  gradientAt(x: number, z: number, r = 3): { dx: number; dz: number } {
    const dx = (this.heightAt(x + r, z) - this.heightAt(x - r, z)) / (2 * r);
    const dz = (this.heightAt(x, z + r) - this.heightAt(x, z - r)) / (2 * r);
    return { dx, dz };
  }

  /** Ground slope (rad) averaged over the lander footprint (+-r metres). */
  slopeAt(x: number, z: number, r = 3): number {
    const g = this.gradientAt(x, z, r);
    return Math.atan(Math.hypot(g.dx, g.dz));
  }

  /** True when (x, z) lies on the grid. */
  contains(x: number, z: number): boolean {
    return Math.abs(x) <= this.half && Math.abs(z) <= this.half;
  }

  /** A flat field (tests, and the stand-in shown before the real data loads). */
  static flat(size = 256, spacing = 60, height = 0): Terrain {
    return new Terrain(size, spacing, new Float32Array(size * size).fill(height));
  }

  /** Build a field from a function of world (x, z). */
  static fromFunction(size: number, spacing: number, f: (x: number, z: number) => number): Terrain {
    const heights = new Float32Array(size * size);
    const c = (size - 1) / 2;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) heights[j * size + i] = f((i - c) * spacing, (j - c) * spacing);
    }
    return new Terrain(size, spacing, heights);
  }

  /**
   * Decode the int16 little-endian grid written by scripts/terrain/fetch.py. Each value counts
   * `unit` metres (0.5 m) relative to the site centre.
   */
  static fromInt16(buffer: ArrayBuffer, size: number, spacing: number, unit: number): Terrain {
    const count = size * size;
    if (buffer.byteLength < count * 2) {
      throw new Error(`terrain: ${buffer.byteLength} bytes, expected ${count * 2}`);
    }
    const view = new DataView(buffer);
    const heights = new Float32Array(count);
    for (let k = 0; k < count; k++) heights[k] = view.getInt16(k * 2, true) * unit;
    return new Terrain(size, spacing, heights);
  }
}
