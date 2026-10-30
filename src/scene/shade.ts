/**
 * Baked sun shadows for the terrain (pure maths, no three.js). With the sun 12 degrees above
 * the horizon, crater rims throw long shadows. For each grid point we march toward the sun and
 * find the highest horizon angle; the point is lit when the sun stands above it. A shadow map
 * cannot cover 15 km at useful resolution, so this is computed once per site at load.
 */
import type { Terrain } from '../sim/terrain';

export interface SunDirection {
  /** Unit vector toward the sun, horizontal part (world x = east, z = south). */
  x: number;
  z: number;
  /** Sun elevation above the horizon (rad). */
  elevation: number;
}

/** Steps (in grid cells) of the horizon march: fine near, coarse far, about 7.7 km in total. */
function* marchSteps(): Generator<number> {
  let d = 1;
  while (d <= 128) {
    yield d;
    d += d < 16 ? 1 : d < 48 ? 2 : 4;
  }
}

const STEPS: readonly number[] = Array.from(marchSteps());

/**
 * Light factor per grid point (0 = in shadow, 1 = in sun) with a soft edge of +-softness rad,
 * row-major like Terrain.heights.
 */
export function bakeSunShadow(t: Terrain, sun: SunDirection, softness = 0.035): Float32Array {
  const n = t.size;
  const out = new Float32Array(n * n);
  const len = Math.hypot(sun.x, sun.z) || 1;
  const dx = sun.x / len;
  const dz = sun.z / len;
  const tanEl = Math.tan(sun.elevation);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h0 = t.heights[j * n + i] as number;
      let maxTan = -Infinity;
      for (const d of STEPS) {
        const gi = i + dx * d;
        const gj = j + dz * d;
        if (gi < 0 || gj < 0 || gi > n - 1 || gj > n - 1) break;
        const tan = (t.sampleGrid(gi, gj) - h0) / (d * t.spacing);
        if (tan > maxTan) {
          maxTan = tan;
          // Already deep in shadow: no need to look further.
          if (maxTan > tanEl + 0.2) break;
        }
      }
      const horizon = maxTan === -Infinity ? -Math.PI / 2 : Math.atan(maxTan);
      const k = (sun.elevation - horizon) / (2 * softness) + 0.5;
      out[j * n + i] = k <= 0 ? 0 : k >= 1 ? 1 : k;
    }
  }
  return out;
}

/** Bilinear lookup in a baked grid at grid coordinates (clamped). */
export function sampleBaked(values: Float32Array, n: number, gi: number, gj: number): number {
  const fi = gi < 0 ? 0 : gi > n - 1 ? n - 1 : gi;
  const fj = gj < 0 ? 0 : gj > n - 1 ? n - 1 : gj;
  const i0 = Math.floor(fi);
  const j0 = Math.floor(fj);
  const i1 = i0 + 1 < n ? i0 + 1 : n - 1;
  const j1 = j0 + 1 < n ? j0 + 1 : n - 1;
  const tx = fi - i0;
  const tz = fj - j0;
  const a = values[j0 * n + i0] as number;
  const b = values[j0 * n + i1] as number;
  const c = values[j1 * n + i0] as number;
  const d = values[j1 * n + i1] as number;
  const top = a + (b - a) * tx;
  return top + (c + (d - c) * tx - top) * tz;
}
