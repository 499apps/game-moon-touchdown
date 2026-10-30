/**
 * Procedural textures, all generated on the device from a seeded PRNG (no image files):
 * regolith detail (decorative small craters, a normal map plus a brightness map), crinkled foil,
 * an original Earth, and soft round sprites for dust and glows.
 */
import * as THREE from 'three';
import { createRng, type Rng } from '../kit/prng';

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

function dataTexture(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
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
function heightToNormals(h: Float32Array, size: number, strength: number): Uint8Array {
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

/**
 * Decorative regolith detail: seeded small craters and grain, tileable. This is NOT elevation
 * data; it only changes shading, never the ground the lander touches.
 */
export function makeRegolithDetail(seed: number, size = 256): RegolithDetail {
  const rng = createRng(seed);
  const h = new Float32Array(size * size);
  const noise = makeValueNoise(rng, 32);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i / size) * 32;
      const v = (j / size) * 32;
      h[j * size + i] = noise(u, v) * 0.6 + noise(u * 2, v * 2) * 0.3;
    }
  }
  // Craters: many small, few large. Bowl below the ground, raised rim around it.
  const craters = 70;
  for (let c = 0; c < craters; c++) {
    const cx = rng.float(0, size);
    const cy = rng.float(0, size);
    const r = 2.5 + 22 * Math.pow(rng.next(), 3);
    const depth = r * 0.22;
    const reach = Math.ceil(r * 1.7);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const px = Math.floor(cx) + dx;
        const py = Math.floor(cy) + dy;
        const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / r;
        if (d > 1.7) continue;
        let dh = 0;
        if (d < 1) dh -= depth * (1 - d * d);
        dh += depth * 0.35 * Math.exp(-(((d - 1) / 0.28) ** 2));
        const ii = ((px % size) + size) % size;
        const jj = ((py % size) + size) % size;
        h[jj * size + ii] = (h[jj * size + ii] as number) + dh;
      }
    }
  }
  const normal = dataTexture(heightToNormals(h, size, 0.9), size, false);
  // Brightness: crater floors a little darker, rims and grain a little brighter.
  const alb = new Uint8Array(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    const v = Math.max(0, Math.min(1, 0.95 + (h[k] as number) * 0.04));
    const g = Math.round(v * 255);
    alb[k * 4] = g;
    alb[k * 4 + 1] = g;
    alb[k * 4 + 2] = g;
    alb[k * 4 + 3] = 255;
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
