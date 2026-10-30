/**
 * The black lunar sky: a seeded starfield, an original Earth with a thin blue glow, and a warm
 * sun glow low in the east. The group follows the camera so the sky is always "infinitely" far.
 *
 * Artistic note: from these near-side sites the real Earth stands high overhead. It is placed
 * low here (about 3.5 degrees up, a little left of north, ahead of the camera) so players can
 * see it in the clear band between the horizon and the HUD, even in the low touchdown view.
 */
import * as THREE from 'three';
import type { Rng } from '../kit/prng';
import { makeEarthTexture } from './textures';

const SKY_RADIUS = 30_000;
const EARTH_DISTANCE = 26_000;
const EARTH_RADIUS = 620;
/** Earth direction: azimuth from north (rad, + = east) and elevation (rad). */
export const EARTH_AZIMUTH = -0.18;
export const EARTH_ELEVATION = (3.5 * Math.PI) / 180;

export class Sky {
  readonly group = new THREE.Group();
  private readonly earth: THREE.Mesh;
  private readonly textures: THREE.Texture[] = [];

  constructor(rng: Rng, sunDir: THREE.Vector3, glow: THREE.Texture, starScale: number) {
    this.group.name = 'sky';
    const count = Math.round(1800 * starScale);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const tints = [new THREE.Color('#ffffff'), new THREE.Color('#cfe0ff'), new THREE.Color('#fff1d0')];
    for (let i = 0; i < count; i++) {
      // Uniform on the upper part of the sphere (a little below the horizon too).
      const y = rng.float(-0.15, 1);
      const a = rng.float(0, Math.PI * 2);
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * SKY_RADIUS;
      pos[i * 3 + 1] = y * SKY_RADIUS;
      pos[i * 3 + 2] = Math.sin(a) * r * SKY_RADIUS;
      const tint = rng.pick(tints);
      const b = 0.35 + 0.65 * Math.pow(rng.next(), 2.5);
      col[i * 3] = tint.r * b;
      col[i * 3 + 1] = tint.g * b;
      col[i * 3 + 2] = tint.b * b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        size: 2.2,
        sizeAttenuation: false,
        vertexColors: true,
        map: glow,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    stars.frustumCulled = false;
    stars.renderOrder = -2;

    const earthTex = makeEarthTexture(rng.int(1, 1e9));
    this.textures.push(earthTex);
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS, 48, 24),
      new THREE.MeshStandardMaterial({
        map: earthTex,
        roughness: 0.65,
        metalness: 0,
        envMapIntensity: 0,
        emissive: new THREE.Color('#0d2550'),
        emissiveIntensity: 0.5,
      }),
    );
    const az = EARTH_AZIMUTH;
    const el = EARTH_ELEVATION;
    this.earth.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(EARTH_DISTANCE);
    this.earth.rotation.set(0.35, 1.2, 0.1);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: '#5f9fff',
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.setScalar(EARTH_RADIUS * 3.1);
    halo.position.copy(this.earth.position);

    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: '#ffe2b0',
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sun.scale.setScalar(2400);
    sun.position.copy(sunDir).multiplyScalar(EARTH_DISTANCE);

    this.group.add(stars, halo, this.earth, sun);
  }

  /** Keep the sky centred on the camera. `t` turns the Earth very slowly. */
  update(camera: THREE.Camera, t: number): void {
    this.group.position.copy(camera.position);
    this.earth.rotation.y = 1.2 + t * 0.01;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
    for (const t of this.textures) t.dispose();
    this.group.removeFromParent();
  }
}
