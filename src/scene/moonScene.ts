/**
 * Moon Touchdown scene: real terrain under a low sun, a black sky with stars and the Earth, the
 * glowing target ring, the lander with plume, engine light and dust, the predicted touchdown
 * marker with its ghost trail, and a chase camera that drops low for the touchdown.
 *
 * The scene never changes the sim: each frame it draws the state it is given.
 */
import * as THREE from 'three';
import type { Rng } from '../kit/prng';
import type { Tier } from '../kit/quality';
import type { KitRenderer } from '../kit/renderer';
import { clamp, damp, lerp } from '../kit/scene-helpers';
import { palette } from '../kit/theme';
import { DEG, G_MOON, TARGET_RADIUS } from '../sim/constants';
import type { Outcome } from '../sim/judge';
import { thrustDir, type LanderState } from '../sim/lander';
import type { Prediction } from '../sim/predictor';
import type { Terrain } from '../sim/terrain';
import { Dust } from './dust';
import { LanderModel } from './landerModel';
import type { SunDirection } from './shade';
import { Sky } from './sky';
import { TerrainView, type Lod, type TerrainSource } from './terrainView';
import { makeRegolithDetail, makeSoftSprite } from './textures';

export type ScenePhase = 'pick' | 'ready' | 'flying' | 'landed';

export interface SceneView {
  phase: ScenePhase;
  lander: LanderState;
  /** Lowest footpad height above the ground (m). */
  altitude: number;
  /** Applied throttle (0 = engine off). */
  throttle: number;
  prediction: Prediction | null;
  /** Seconds since touchdown (0 before). */
  landedFor: number;
  outcome: Outcome | null;
  paused: boolean;
}

export interface MoonSceneOptions {
  reducedMotion: boolean;
  /** Frozen test clock: no flicker, no idle drift. */
  frozen: boolean;
}

/** Sun 12 degrees up, from the east-south-east: long shadows that run west across the view. */
const SUN_AZIMUTH = 100 * DEG;
const SUN_ELEVATION = 12 * DEG;
export const SUN: SunDirection = {
  x: Math.sin(SUN_AZIMUTH),
  z: -Math.cos(SUN_AZIMUTH),
  elevation: SUN_ELEVATION,
};

const LOD_BY_TIER: Readonly<Record<Tier, Lod>> = { high: 256, medium: 128, low: 64 };
const TRAIL_MAX = 64;
const UP = new THREE.Vector3(0, 1, 0);

const OUTCOME_COLOR = {
  soft: new THREE.Color(palette.lime),
  close: new THREE.Color(palette.lemon),
  bumpy: new THREE.Color(palette.coral),
};

export class MoonScene {
  private readonly kit: KitRenderer;
  private readonly rng: Rng;
  private readonly motion: number;
  private readonly frozen: boolean;
  private readonly sunDir: THREE.Vector3;
  private readonly sun: THREE.DirectionalLight;
  private readonly sky: Sky;
  private readonly terrainView: TerrainView;
  private readonly lander: LanderModel;
  private readonly dust: Dust;
  private readonly ring: THREE.Group;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private readonly marker: THREE.Mesh;
  private readonly markerMat: THREE.MeshBasicMaterial;
  private readonly trail: THREE.Line;
  private readonly trailPos: Float32Array;
  private readonly sprites: THREE.Texture[] = [];
  private readonly camPos = new THREE.Vector3(0, 400, 900);
  private readonly camLook = new THREE.Vector3();
  private readonly wantPos = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private terrain: Terrain | null = null;
  private snap = true;
  private puffed = false;
  private orbit = 0;
  private aspect = 16 / 9;
  private particleScale: number;

  constructor(kit: KitRenderer, rng: Rng, o: MoonSceneOptions) {
    this.kit = kit;
    this.rng = rng;
    this.motion = o.reducedMotion ? 0 : 1;
    this.frozen = o.frozen;
    this.particleScale = kit.settings.particleScale;
    const scene = kit.scene;
    scene.background = new THREE.Color('#03040b');
    const cam = kit.camera;
    cam.fov = 48;
    cam.near = 0.5;
    cam.far = 45_000;
    cam.updateProjectionMatrix();

    // Lights: the low sun (casts the lander's shadow), a faint blue sky and earthshine fill.
    this.sunDir = new THREE.Vector3(
      SUN.x * Math.cos(SUN.elevation),
      Math.sin(SUN.elevation),
      SUN.z * Math.cos(SUN.elevation),
    ).normalize();
    this.sun = new THREE.DirectionalLight('#fff4e2', 10);
    this.sun.castShadow = kit.settings.shadows;
    this.sun.shadow.mapSize.set(kit.settings.shadowMapSize, kit.settings.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    sc.near = 1;
    sc.far = 4200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    kit.shadowLights.push(this.sun);
    scene.add(new THREE.HemisphereLight('#8ea2d8', '#2c2824', 0.55));
    const fill = new THREE.DirectionalLight('#9fb6ff', 0.5);
    fill.position.set(-0.5, 0.6, 0.7);
    scene.add(fill);

    const glow = makeSoftSprite(64, 0.2);
    const dustSprite = makeSoftSprite(32, 0.35);
    this.sprites.push(glow, dustSprite);

    this.sky = new Sky(rng, this.sunDir, glow, 0.5 + 0.5 * this.particleScale);
    scene.add(this.sky.group);

    const detail = makeRegolithDetail(rng.int(1, 1e9));
    this.sprites.push(detail.normal, detail.albedo);
    this.terrainView = new TerrainView(detail, LOD_BY_TIER[kit.settings.tier]);
    scene.add(this.terrainView.group);

    // Target ring (draped on the ground when a site loads) and a light beacon above it.
    this.ring = new THREE.Group();
    this.ring.name = 'target';
    this.ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.mint).multiplyScalar(1.8),
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
    });
    const beaconGeo = new THREE.CylinderGeometry(1.4, 1.4, 260, 14, 8, true);
    const bc = new Float32Array(beaconGeo.getAttribute('position').count * 4);
    const bp = beaconGeo.getAttribute('position');
    const mint = new THREE.Color(palette.mint);
    for (let i = 0; i < bp.count; i++) {
      const k = (bp.getY(i) + 130) / 260;
      bc[i * 4] = mint.r;
      bc[i * 4 + 1] = mint.g;
      bc[i * 4 + 2] = mint.b;
      bc[i * 4 + 3] = 0.55 * (1 - k) * (1 - k);
    }
    beaconGeo.setAttribute('color', new THREE.BufferAttribute(bc, 4));
    this.beaconMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const beacon = new THREE.Mesh(beaconGeo, this.beaconMat);
    beacon.name = 'beacon';
    beacon.position.y = 130;
    this.ring.add(beacon);
    scene.add(this.ring);

    this.lander = new LanderModel(rng.int(1, 1e9));
    scene.add(this.lander.root);

    this.dust = new Dust(rng, 600 * this.particleScale * (o.reducedMotion ? 0.35 : 1), dustSprite);
    scene.add(this.dust.points);

    this.markerMat = new THREE.MeshBasicMaterial({
      color: OUTCOME_COLOR.soft,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const markerGeo = new THREE.RingGeometry(2.4, 3.3, 40);
    markerGeo.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(markerGeo, this.markerMat);
    this.marker.visible = false;
    this.marker.renderOrder = 4;
    this.trailPos = new Float32Array(TRAIL_MAX * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: palette.sky, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    scene.add(this.marker, this.trail);
  }

  /** Show a site: build the terrain meshes and drape the target ring on the real ground. */
  setSite(src: TerrainSource): void {
    this.terrain = src.terrain;
    this.terrainView.setSource(src, this.rng);
    for (const child of this.ring.children.slice()) {
      if (child.name === 'ring') {
        (child as THREE.Mesh).geometry.dispose();
        child.removeFromParent();
      }
    }
    const t = src.terrain;
    const pts: THREE.Vector3[] = [];
    const segments = 120;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = Math.cos(a) * TARGET_RADIUS;
      const z = Math.sin(a) * TARGET_RADIUS;
      pts.push(new THREE.Vector3(x, t.heightAt(x, z) + 0.8, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, 0.9, 6, true), this.ringMat);
    tube.name = 'ring';
    this.ring.add(tube);
    const beacon = this.ring.getObjectByName('beacon');
    if (beacon) beacon.position.y = t.heightAt(0, 0) + 130;
    this.dust.clear();
    this.snap = true;
  }

  setTier(tier: Tier): void {
    this.terrainView.setLod(LOD_BY_TIER[tier]);
    this.particleScale = this.kit.settings.particleScale;
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    const cam = this.kit.camera;
    // Portrait screens are narrow: a wider vertical view keeps the ground and the ring in frame.
    cam.fov = this.aspect < 1 ? 62 : 48;
    cam.updateProjectionMatrix();
  }

  /** Start of a new run: snap the camera, clear dust and touchdown effects. */
  resetRun(): void {
    this.snap = true;
    this.puffed = false;
    this.dust.clear();
  }

  update(dt: number, t: number, v: SceneView): void {
    const terrain = this.terrain;
    if (!terrain) return;
    const s = v.lander;
    const motion = this.motion;
    const live = !this.frozen && !v.paused;

    // Lander pose, plus a spring dip (soft) or a kind little hop (bumpy) after touchdown.
    const root = this.lander.root;
    root.position.set(s.pos.x, s.pos.y, s.pos.z);
    root.quaternion.setFromUnitVectors(UP, this.tmp.set(...thrustVec(s)));
    this.lander.body.position.y = 0;
    if (v.phase === 'landed' && motion > 0) {
      const lt = v.landedFor;
      if (v.outcome === 'bumpy' && lt < 2.4) {
        root.position.y += 1.6 * Math.abs(Math.sin((Math.PI * lt) / 0.6)) * Math.exp(-1.6 * lt);
        root.rotateZ(0.12 * Math.sin(10 * lt) * Math.exp(-2 * lt));
      } else if (lt < 2) {
        this.lander.body.position.y = -0.18 * Math.exp(-5 * lt) * Math.cos(14 * lt);
      }
    }
    const flicker = live && motion > 0 ? this.rng.next() : 0.5;
    const showEngine = v.phase === 'flying' && !v.paused ? v.throttle : 0;
    this.lander.setEngine(showEngine, flicker, 1);

    // Dust: the plume reaches the ground below about 30 m.
    const ground = terrain.heightAt(s.pos.x, s.pos.z);
    if (v.phase === 'flying' && !v.paused && showEngine > 0 && v.altitude < 30) {
      const near = 1 - v.altitude / 30;
      this.dust.emit(s.pos.x, ground, s.pos.z, 520 * showEngine * near * this.particleScale * (motion > 0 ? 1 : 0.35), dt);
    }
    if (v.phase === 'landed' && !this.puffed) {
      this.puffed = true;
      this.dust.puff(s.pos.x, ground, s.pos.z, Math.round(90 * this.particleScale * (motion > 0 ? 1 : 0.4)));
    }
    if (!v.paused) this.dust.update(dt, G_MOON);

    // Predicted touchdown marker and the ghost trail.
    const p = v.phase === 'flying' ? v.prediction : null;
    this.marker.visible = p !== null;
    this.trail.visible = p !== null;
    if (p) {
      this.marker.position.set(p.x, terrain.heightAt(p.x, p.z) + 0.35, p.z);
      const col = p.outcome === 'soft' ? OUTCOME_COLOR.soft : p.vs < 4 ? OUTCOME_COLOR.close : OUTCOME_COLOR.bumpy;
      this.markerMat.color.copy(col).multiplyScalar(1.4);
      const n = Math.min(TRAIL_MAX, p.trail.length);
      const stride = p.trail.length / n;
      for (let i = 0; i < n; i++) {
        const q = p.trail[Math.min(p.trail.length - 1, Math.floor(i * stride))];
        if (!q) continue;
        // Draw the trail at footpad height so it ends on the marker.
        this.trailPos[i * 3] = q.x;
        this.trailPos[i * 3 + 1] = q.y - 2;
        this.trailPos[i * 3 + 2] = q.z;
      }
      const geo = this.trail.geometry;
      geo.setDrawRange(0, n);
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    // Beacon fades as the lander gets low (it is there to find the ring from high up).
    this.beaconMat.opacity = v.phase === 'pick' ? 1 : clamp((v.altitude - 20) / 150, 0.15, 1);
    this.ringMat.opacity = 0.85 + (live && motion > 0 ? 0.1 * Math.sin(t * 3) : 0.1);

    this.terrainView.updatePatch(s.pos.x, s.pos.z);
    this.updateCamera(dt, v, ground);
    this.updateSun(s);
    this.sky.update(this.kit.camera, live ? t : 0);
  }

  private updateCamera(dt: number, v: SceneView, ground: number): void {
    const terrain = this.terrain;
    if (!terrain) return;
    const s = v.lander;
    const portrait = this.aspect < 1 ? 1.18 : 1;
    const want = this.wantPos;
    const look = this.wantLook;
    if (v.phase === 'pick') {
      // A slow orbit over the site that shows the ring and the lander waiting above it.
      if (!this.frozen && this.motion > 0) this.orbit += dt * 0.03;
      // Low enough that the horizon and the Earth show above the ring.
      const a = this.orbit;
      const g0 = terrain.heightAt(0, 0);
      const r = 900 * portrait;
      const cx = Math.sin(a) * r;
      const cz = Math.cos(a) * r;
      want.set(cx, Math.max(g0 + 230, terrain.heightAt(cx, cz) + 60), cz);
      look.set(s.pos.x * 0.3, g0 + 40, s.pos.z * 0.3);
    } else if (v.phase === 'landed') {
      // Low, close view of the lander on the ground, turning slowly.
      if (!this.frozen && this.motion > 0) this.orbit += dt * 0.12;
      const a = this.orbit;
      const r = 26 * portrait;
      want.set(s.pos.x + Math.sin(a) * r, ground + 6.5, s.pos.z + Math.cos(a) * r);
      look.set(s.pos.x, s.pos.y + 0.4, s.pos.z);
    } else {
      this.orbit = 0;
      const h = Math.max(0, v.altitude);
      const dist = clamp(26 + h * 0.32, 26, 230) * portrait;
      const k = smoothstep(0, 400, h);
      const phi = lerp(0.14, 0.5, k);
      want.set(s.pos.x, s.pos.y + dist * Math.sin(phi), s.pos.z + dist * Math.cos(phi));
      const lh = Math.min(h, 300);
      look.set(s.pos.x, s.pos.y - lh * 0.22, s.pos.z - lh * 0.12);
    }
    // Never below the ground.
    const floor = terrain.heightAt(want.x, want.z) + 4;
    if (want.y < floor) want.y = floor;
    if (this.snap) {
      this.camPos.copy(want);
      this.camLook.copy(look);
      this.snap = false;
    } else {
      const lambda = v.phase === 'flying' ? 4 : 2;
      this.camPos.set(
        damp(this.camPos.x, want.x, lambda, dt),
        damp(this.camPos.y, want.y, lambda, dt),
        damp(this.camPos.z, want.z, lambda, dt),
      );
      this.camLook.set(
        damp(this.camLook.x, look.x, lambda * 1.5, dt),
        damp(this.camLook.y, look.y, lambda * 1.5, dt),
        damp(this.camLook.z, look.z, lambda * 1.5, dt),
      );
    }
    const cam = this.kit.camera;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    // Near plane follows the distance to the subject: sharper depth for the far terrain.
    const subject = cam.position.distanceTo(this.lander.root.position);
    const near = clamp(subject * 0.04, 0.4, 6);
    if (Math.abs(near - cam.near) > 0.05) {
      cam.near = near;
      cam.updateProjectionMatrix();
    }
  }

  private updateSun(s: LanderState): void {
    // The shadow box rides on the sun ray through the lander, so its shadow shows on the ground
    // even from high up (where it falls far off to the west).
    this.sun.target.position.set(s.pos.x, s.pos.y, s.pos.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 400);
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    this.terrainView.dispose();
    this.lander.dispose();
    this.dust.dispose();
    this.sky.dispose();
    for (const c of this.ring.children) (c as THREE.Mesh).geometry?.dispose();
    this.ringMat.dispose();
    this.beaconMat.dispose();
    this.marker.geometry.dispose();
    this.markerMat.dispose();
    this.trail.geometry.dispose();
    (this.trail.material as THREE.Material).dispose();
    for (const tex of this.sprites) tex.dispose();
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
}

function thrustVec(s: LanderState): [number, number, number] {
  const u = thrustDir(s.tiltX, s.tiltZ);
  return [u.x, u.y, u.z];
}
