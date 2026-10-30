/**
 * Engine dust: near the ground the exhaust blows regolith sideways in fast, flat sheets (there
 * is no air on the Moon to slow it). Pooled points with per-point fade; seeded, so test replays
 * look the same. Counts follow the quality tier and reduced motion.
 */
import * as THREE from 'three';
import type { Rng } from '../kit/prng';

interface Grain {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  floor: number;
}

export class Dust {
  readonly points: THREE.Points;
  private readonly grains: Grain[] = [];
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly rng: Rng;
  private readonly max: number;
  private carry = 0;

  constructor(rng: Rng, max: number, sprite: THREE.Texture) {
    this.rng = rng;
    this.max = Math.max(16, Math.round(max));
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 4);
    for (let i = 0; i < this.max; i++) {
      this.grains.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, floor: 0 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 1.6,
        sizeAttenuation: true,
        map: sprite,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  private spawn(x: number, y: number, z: number, speed: number, up: number, life: number): void {
    const g = this.grains.find((p) => !p.alive);
    if (!g) return;
    const a = this.rng.float(0, Math.PI * 2);
    const s = speed * this.rng.float(0.45, 1.1);
    const r0 = this.rng.float(0.8, 2.6);
    g.alive = true;
    g.x = x + Math.cos(a) * r0;
    g.z = z + Math.sin(a) * r0;
    g.y = y + 0.25;
    g.floor = y + 0.1;
    g.vx = Math.cos(a) * s;
    g.vz = Math.sin(a) * s;
    g.vy = up * this.rng.float(0.3, 1);
    g.age = 0;
    g.life = life * this.rng.float(0.7, 1.25);
  }

  /** Blow dust from the ground point (x, groundY, z) at a rate in grains per second. */
  emit(x: number, groundY: number, z: number, rate: number, dt: number): void {
    this.carry += Math.max(0, rate) * dt;
    let n = Math.floor(this.carry);
    this.carry -= n;
    n = Math.min(n, 40);
    for (let i = 0; i < n; i++) this.spawn(x, groundY, z, 30, 2.2, 1.3);
  }

  /** A soft puff at touchdown. */
  puff(x: number, groundY: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) this.spawn(x, groundY, z, 7, 1.6, 1.8);
  }

  update(dt: number, g: number): void {
    let n = 0;
    for (const p of this.grains) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      p.vy -= g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < p.floor) {
        p.y = p.floor;
        p.vy = 0;
        p.vx *= 0.9;
        p.vz *= 0.9;
      }
      const k = p.age / p.life;
      const fade = (1 - k) * Math.min(1, k * 8) * 0.55;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = 0.78;
      this.col[n * 4 + 1] = 0.74;
      this.col[n * 4 + 2] = 0.68;
      this.col[n * 4 + 3] = fade;
      n++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (const p of this.grains) p.alive = false;
    this.carry = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  get alive(): number {
    return this.points.geometry.drawRange.count;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.points.removeFromParent();
  }
}
