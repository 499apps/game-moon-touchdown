/**
 * Procedural textures, all generated on the device from a seeded PRNG (no image files):
 * regolith detail (decorative small craters, a normal map plus a brightness map), crinkled foil,
 * an original Earth, and soft round sprites for dust and glows.
 */
import * as THREE from 'three';
import { createRng, type Rng } from '../kit/prng';
import type { SunDirection } from './shade';

/** Seeded, tileable 2D value noise on an integer lattice of `period` cells. */
export function makeValueNoise(rng: Rng, period: number): (x: number, y: number) => number {
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const at = (i: number, j: number): number => {
    const ii = ((i % period) + period) % period;
    const jj = ((j % period) + period) % period;
    return grid[jj * period + ii] as number;
  };
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j);
    const b = at(i + 1, j);
    const c = at(i, j + 1);
    const d = at(i + 1, j + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function dataTexture(data: Uint8Array<ArrayBuffer>, size: number, srgb: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Height field to a tangent-space normal map (wraps at the edges). */
function heightToNormals(h: Float32Array, size: number, strength: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size * size * 4);
  const at = (i: number, j: number) => h[((j + size) % size) * size + ((i + size) % size)] as number;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) * strength;
      const dy = (at(i, j + 1) - at(i, j - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const k = (j * size + i) * 4;
      out[k] = Math.round((-dx / len) * 127.5 + 127.5);
      out[k + 1] = Math.round((-dy / len) * 127.5 + 127.5);
      out[k + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[k + 3] = 255;
    }
  }
  return out;
}

export interface RegolithDetail {
  normal: THREE.DataTexture;
  albedo: THREE.DataTexture;
}

/** Crater count and size of the detail map (a site scales them). */
export interface DetailLook {
  craterDensity: number;
  craterScale: number;
}

/** Smallest and largest crater radius (px) and the crater count at density 1. */
const CRATER_R_MIN = 1.5;
const CRATER_R_MAX = 40;
const CRATER_COUNT = 250;
/** Share of small craters that are fresh: dark floor, bright rim and a bright ray halo. */
const FRESH_SHARE = 0.14;
const FRESH_ALBEDO = 0.12;

/**
 * Crater radius from a uniform u in [0, 1): a truncated power law with N(> r) ~ r^-2, so there
 * are many small craters and few large ones (like real crater counts).
 */
export function craterRadius(u: number, rMin = CRATER_R_MIN, rMax = CRATER_R_MAX): number {
  const k = 1 - u * (1 - (rMin / rMax) ** 2);
  return rMin / Math.sqrt(Math.max(1e-9, k));
}

/** Cast shadows: craters at least this big (px) get one; the darkest shadow keeps this share of light. */
const SHADOW_MIN_R = 2.5;
const SHADOW_FLOOR = 0.3;
/** How far (crater radii) the lit part of the floor moves away from the sun, at most. */
const SHADOW_SHIFT_MAX = 0.62;

/** Shift (crater radii) of the rim shadow for a sun elevation: lower sun, longer shadow. */
export function craterShadowShift(elevation: number): number {
  const t = Math.tan(Math.max(1e-3, elevation));
  return Math.min(SHADOW_SHIFT_MAX, 0.13 / t);
}

/**
 * Cast shadow inside a bowl crater, 0 (lit) .. 1 (full shadow), at an offset (ox, oy) from the
 * crater centre in crater radii. (sx, sy) is the unit direction toward the sun in the same frame.
 * The sun-side rim throws its shadow across the floor, so the lit part of the floor is the crater
 * disc moved `shift` radii away from the sun: a dark crescent on the side toward the sun.
 */
export function craterShadow(ox: number, oy: number, sx: number, sy: number, shift: number): number {
  const d = Math.hypot(ox, oy);
  if (!(d < 1)) return 0;
  const out = Math.hypot(ox + sx * shift, oy + sy * shift);
  const k = Math.min(1, Math.max(0, (out - 0.9) / 0.2));
  const edge = 1 - Math.min(1, Math.max(0, (d - 0.9) / 0.1));
  return k * k * (3 - 2 * k) * edge;
}

/**
 * Decorative regolith detail: seeded craters and grain, tileable. This is NOT elevation data;
 * it only changes shading, never the ground the lander touches.
 *
 * With a sun direction, each crater (2.5 px or more) also gets a soft cast-shadow crescent on its
 * sun side, stored in the albedo alpha. The terrain shader reads that alpha only from the
 * unrotated 150 m sample, whose axes match the world (u = x, v = z), so the shadows point the
 * right way for the fixed sun of the site.
 */
export function makeRegolithDetail(
  seed: number,
  size = 256,
  look: DetailLook = { craterDensity: 1, craterScale: 1 },
  sun?: SunDirection,
): RegolithDetail {
  const rng = createRng(seed);
  const h = new Float32Array(size * size);
  // Extra brightness of fresh craters (floors darker, rims and rays brighter).
  const fresh = new Float32Array(size * size);
  // Light kept after the cast shadows (1 = no shadow).
  const light = new Float32Array(size * size).fill(1);
  const sunLen = sun ? Math.hypot(sun.x, sun.z) : 0;
  const sx = sun && sunLen > 1e-6 ? sun.x / sunLen : 0;
  const sy = sun && sunLen > 1e-6 ? sun.z / sunLen : 0;
  const shift = sun && sunLen > 1e-6 ? craterShadowShift(sun.elevation) : 0;
  const noise = makeValueNoise(rng, 32);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i / size) * 32;
      const v = (j / size) * 32;
      h[j * size + i] = noise(u, v) * 0.6 + noise(u * 2, v * 2) * 0.3;
    }
  }
  // Craters: a power law, many small and few large. Bowl below the ground, raised rim around it.
  const craters = Math.round(CRATER_COUNT * Math.max(0.2, look.craterDensity));
  const rMax = CRATER_R_MAX * Math.max(0.3, look.craterScale);
  for (let c = 0; c < craters; c++) {
    const cx = rng.float(0, size);
    const cy = rng.float(0, size);
    const r = craterRadius(rng.next(), CRATER_R_MIN, rMax);
    const isFresh = r < 12 && rng.chance(FRESH_SHARE);
    const depth = r * (isFresh ? 0.26 : 0.2);
    const reach = Math.ceil(r * (isFresh ? 2.6 : 1.7));
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const px = Math.floor(cx) + dx;
        const py = Math.floor(cy) + dy;
        const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / r;
        if (d > (isFresh ? 2.6 : 1.7)) continue;
        const ii = ((px % size) + size) % size;
        const jj = ((py % size) + size) % size;
        const k = jj * size + ii;
        if (d <= 1.7) {
          let dh = 0;
          if (d < 1) dh -= depth * (1 - d * d);
          dh += depth * 0.35 * Math.exp(-(((d - 1) / 0.28) ** 2));
          h[k] = (h[k] as number) + dh;
        }
        if (shift > 0 && d < 1 && r >= SHADOW_MIN_R) {
          const shade = craterShadow((px + 0.5 - cx) / r, (py + 0.5 - cy) / r, sx, sy, shift);
          if (shade > 0) light[k] = (light[k] as number) * (1 - (1 - SHADOW_FLOOR) * shade);
        }
        if (isFresh) {
          let a = 0;
          if (d < 0.8) a -= FRESH_ALBEDO * (1 - (d / 0.8) ** 2);
          a += FRESH_ALBEDO * Math.exp(-(((d - 1) / 0.22) ** 2));
          if (d > 1) a += 0.4 * FRESH_ALBEDO * Math.exp(-(d - 1) * 1.6);
          fresh[k] = (fresh[k] as number) + a;
        }
      }
    }
  }
  const normal = dataTexture(heightToNormals(h, size, 0.9), size, false);
  // Brightness: crater floors a little darker, rims and grain a little brighter, fresh craters
  // with a dark floor and a bright rim (about +-12%).
  const alb = new Uint8Array(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    const v = Math.max(0, Math.min(1, 0.9 + (h[k] as number) * 0.04 + (fresh[k] as number)));
    const g = Math.round(v * 255);
    alb[k * 4] = g;
    alb[k * 4 + 1] = g;
    alb[k * 4 + 2] = g;
    // Alpha: light left after the cast shadows (read by the terrain shader, unrotated sample only).
    alb[k * 4 + 3] = Math.round(Math.max(SHADOW_FLOOR, Math.min(1, light[k] as number)) * 255);
  }
  const albedo = dataTexture(alb, size, true);
  return { normal, albedo };
}

/** Crinkled foil for the lander's lower stage. */
export function makeFoilNormal(seed: number, size = 128): THREE.DataTexture {
  const rng = createRng(seed);
  const noise = makeValueNoise(rng, 16);
  const h = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i / size) * 16;
      const v = (j / size) * 16;
      // Sharp creases: folded absolute noise.
      h[j * size + i] = Math.abs(noise(u, v) - 0.5) * 2 + Math.abs(noise(u * 2.3, v * 2.3) - 0.5);
    }
  }
  return dataTexture(heightToNormals(h, size, 2.2), size, false);
}

function canvas2d(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

/** An original, simplified Earth: blue oceans, soft green-brown land, swirling white clouds. */
export function makeEarthTexture(seed: number): THREE.Texture {
  const c = canvas2d(512, 256);
  if (!c) return new THREE.Texture();
  const { canvas, ctx } = c;
  const rng = createRng(seed);
  const ocean = ctx.createLinearGradient(0, 0, 0, 256);
  ocean.addColorStop(0, '#2f6fb8');
  ocean.addColorStop(0.5, '#1f5fae');
  ocean.addColorStop(1, '#2f6fb8');
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, 512, 256);
  const lands = ['#5f9a4f', '#7aa65a', '#b39b6b', '#8c9a5a'];
  for (let k = 0; k < 9; k++) {
    const x = rng.float(0, 512);
    const y = rng.float(50, 206);
    ctx.fillStyle = rng.pick(lands);
    for (let b = 0; b < 7; b++) {
      ctx.beginPath();
      ctx.ellipse(x + rng.float(-40, 40), y + rng.float(-22, 22), rng.float(12, 38), rng.float(8, 24), rng.float(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Ice caps.
  ctx.fillStyle = '#eef4fb';
  ctx.fillRect(0, 0, 512, 14);
  ctx.fillRect(0, 242, 512, 14);
  // Cloud swirls.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineCap = 'round';
  for (let k = 0; k < 26; k++) {
    ctx.lineWidth = rng.float(3, 9);
    const x = rng.float(0, 512);
    const y = rng.float(20, 236);
    ctx.beginPath();
    ctx.arc(x, y, rng.float(14, 40), rng.float(0, Math.PI * 2), rng.float(0, Math.PI * 2) + 1.4);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * A short, round-ended chevron that points right (+x), white on transparent, for the tilt cue on
 * the lander halo. The sprite rotation turns it to the commanded tilt.
 */
export function makeChevronSprite(size = 64): THREE.Texture {
  const c = canvas2d(size, size);
  if (!c) return new THREE.Texture();
  const { canvas, ctx } = c;
  const s = size / 64;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // A dark outline first, so the chevron reads on bright ground too.
  ctx.strokeStyle = 'rgba(10, 12, 32, 0.75)';
  ctx.lineWidth = 15 * s;
  ctx.beginPath();
  ctx.moveTo(22 * s, 14 * s);
  ctx.lineTo(42 * s, 32 * s);
  ctx.lineTo(22 * s, 50 * s);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
  ctx.lineWidth = 8 * s;
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft round sprite (white centre fading to transparent), for dust, glows and stars. */
export function makeSoftSprite(size = 64, hardness = 0.25): THREE.Texture {
  const c = canvas2d(size, size);
  if (!c) return new THREE.Texture();
  const { canvas, ctx } = c;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(hardness, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
