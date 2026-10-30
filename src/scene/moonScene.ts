/**
 * Moon Touchdown scene: real terrain under a low sun, a black sky with stars and the Earth, the
 * glowing target ring, the lander with plume, engine light, halo and dust, the input cues that
 * read from high up (attitude-thruster puffs, a warm halo and plume glow with the engine, a tilt
 * chevron on the halo edge), the predicted
 * touchdown marker with its ghost trail, a soft ground glow under the lander near the ground,
 * and the camera.
 *
 * Camera, by phase:
 * - pick: a slow orbit over the site.
 * - ready: a low hero shot behind and a little below the lander (70 m portrait, 100 m
 *   landscape), with the horizon and the Earth below it. The Go button never covers it.
 * - flying: a swoop (1.5 s, a cut with reduced motion) into the descent cam. High up it looks
 *   steeply down so the lander and the ground under it are both in frame; from 80 m to 30 m it
 *   blends into a low chase cam for the touchdown. The page gives the HUD band and the controls
 *   band (setFrameInsets): the lander stays below the HUD, the ground point above the controls,
 *   and the camera moves back when both do not fit.
 * - landed: a low, slow orbit around the lander.
 *
 * The scene never changes the sim: each frame it draws the state it is given.
 */
import * as THREE from 'three';
import { markerBand, type Band, type MarkerBand } from '../hud';
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
import { EARTH_AZIMUTH, Sky } from './sky';
import { DEFAULT_LOOK, TerrainView, type Lod, type TerrainSource } from './terrainView';
import { RCS, RcsPuffs, RcsTrigger, THRUSTERS, firingThrusters } from './rcsPuffs';
import { makeChevronSprite, makeRegolithDetail, makeSoftSprite, type RegolithDetail } from './textures';

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
  /**
   * The player's shaped tilt command (rad, +x = right, +z = toward the camera), not the lagged
   * sim tilt: the thruster puffs answer it on the frame of the key press. 0 with no input.
   */
  cmdTiltX: number;
  cmdTiltZ: number;
  /** A tilt key, the pad or a stick is held now: a chevron on the halo edge shows the command. */
  tiltHeld: boolean;
  /** Help flies the engine. With `band`, it sets the marker colour (markerBand, R4 finding 1). */
  assist: boolean;
  /** The speed band the HUD shows now. */
  band: Band;
  /**
   * Engine kick (R4 finding 2): a new "more engine" press in the last ENGINE_KICK_MS. The plume
   * glow and the warm halo show at KICK_LEVEL or more, so a short tap from the notch is seen.
   */
  kick: boolean;
}

export interface MoonSceneOptions {
  reducedMotion: boolean;
  /** Frozen test clock: no flicker, no idle drift. */
  frozen: boolean;
}

/** A world point on the screen: normalised device coordinates (-1..1, y up). */
export interface ScreenPoint {
  x: number;
  y: number;
  /** The point is behind the camera (x and y are then mirrored). */
  behind: boolean;
}

/** Sun 12 degrees up, from the east-south-east: long shadows that run west across the view. */
const SUN_AZIMUTH = 100 * DEG;
const SUN_ELEVATION = 12 * DEG;
export const SUN: SunDirection = {
  x: Math.sin(SUN_AZIMUTH),
  z: -Math.cos(SUN_AZIMUTH),
  elevation: SUN_ELEVATION,
};
/** Sun strength: calibrated so flat lit ground reads as mid grey, not white. */
const SUN_INTENSITY = 6.5;

const LOD_BY_TIER: Readonly<Record<Tier, Lod>> = { high: 256, medium: 128, low: 64 };
const TRAIL_MAX = 64;
const UP = new THREE.Vector3(0, 1, 0);

/** Camera: the descent cam above HIGH_CAM_H, the low chase cam below LOW_CAM_H (m). */
const HIGH_CAM_H = 80;
const LOW_CAM_H = 30;
/** Descent cam: elevation of the camera seen from the lander, and its distance (m). */
const HIGH_ELEVATION = 70 * DEG;
const LOW_ELEVATION = 12 * DEG;
const LOW_DISTANCE = 30;
/** Default usable frame (px): below the HUD band at the top, above the controls at the bottom. */
const DEFAULT_FRAME = { top: 70, bottom: 40 } as const;
/** Keep the lander this far (px) below the HUD band; its top sits this far (m) above its centre. */
const LANDER_MARGIN_PX = 8;
const LANDER_TOP = 2.7;
/** Look targets sit this far (m) along the view direction. */
const LOOK_DIST = 100;
/**
 * Ready shot: a low hero shot. Behind the lander and a little below it, so the lander stands
 * against the black sky in the upper middle, above the Go button, with the horizon and the Earth
 * (a little to the left) below it. Closer in portrait.
 */
const READY_BACK = { portrait: 70, landscape: 100 } as const;
const READY_DOWN = 9;
const READY_PITCH = 2 * DEG;
/** The ready camera faces this far (rad) east of the Earth, so the Earth sits left of the lander. */
const READY_EARTH_OFFSET = 0.15;
const SWOOP_TIME = 1.5;
/** Lander halo: size on screen (px), faded out below these heights (m). */
const HALO_PX = 52;
const HALO_FADE = { low: 40, high: 90 } as const;
/**
 * Engine on the halo: above `full` m the halo turns warm and grows up to `scale` times at full
 * throttle; below `low` m it is the plain halo again (the real plume shows by then).
 */
const HALO_THROTTLE = { low: 60, full: 90, scale: 1.3 } as const;
const HALO_COOL = new THREE.Color('#cfe6ff');
const HALO_WARM = new THREE.Color('#ffb066');
/**
 * Plume glow seen from above: a short warm glow this far (m) below the lander along its axis, a
 * fixed size on screen (px across, low to full throttle). It fades out from `high` to `low` m.
 */
const PLUME_GLOW = { drop: 3.2, minPx: 20, maxPx: 46, low: 25, high: 60 } as const;
/**
 * Engine kick (R4 finding 2), visual only: for ENGINE_KICK_MS after a new "more engine" press the
 * plume glow and the warm halo show at KICK_LEVEL of full or more. The engine twin of the puffs.
 * No camera shake, so it is the same with reduced motion.
 */
export const ENGINE_KICK_MS = 150;
const KICK_LEVEL = 0.35;
/** Tilt chevron on the halo edge: size and gap beyond the halo radius (px). */
const CHEVRON = { px: 22, gap: 7 } as const;
/** Ground glow under the lander starts at this height (m). */
const GLOW_HEIGHT = 50;
/** Soft contact shadow under the lander (a visual aid) starts at this height (m). */
const CONTACT_HEIGHT = 20;
/** Beacon: in flight a short pillar (m), so the descent cam does not see a long streak. */
const BEACON_FLIGHT = { min: 14, max: 70, perMetre: 0.25 } as const;
const BEACON_FULL = 260;
/** The predicted touchdown marker is never smaller than this on screen (px across). */
const MARKER_MIN_PX = 30;
const MARKER_RADIUS = 3.3;

const MARKER_COLOR: Readonly<Record<MarkerBand, THREE.Color>> = {
  good: new THREE.Color(palette.lime),
  warn: new THREE.Color(palette.lemon),
  bad: new THREE.Color(palette.coral),
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
  private readonly beacon: THREE.Mesh;
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private readonly marker: THREE.Mesh;
  private readonly markerMat: THREE.MeshBasicMaterial;
  private readonly trail: THREE.Line;
  private readonly trailPos: Float32Array;
  private readonly halo: THREE.Sprite;
  private readonly haloMat: THREE.SpriteMaterial;
  /** Halo fade (0..1) and its engine share (0..1) in the last update. */
  private haloK = 0;
  private haloThr = 0;
  private readonly plumeGlow: THREE.Sprite;
  private readonly plumeGlowMat: THREE.SpriteMaterial;
  private readonly chevron: THREE.Sprite;
  private readonly chevronMat: THREE.SpriteMaterial;
  private readonly rcs: RcsPuffs;
  private readonly rcsTrigger = new RcsTrigger();
  /** Puffs started in this page (drives the small, repeatable jitter). */
  private rcsSeq = 0;
  private readonly cueA: ScreenPoint = { x: 0, y: 0, behind: false };
  private readonly cueB: ScreenPoint = { x: 0, y: 0, behind: false };
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();
  private readonly groundGlow: THREE.Mesh;
  private readonly groundGlowMat: THREE.MeshBasicMaterial;
  private readonly contact: THREE.Mesh;
  private readonly contactMat: THREE.MeshBasicMaterial;
  /** The contact shadow is skipped on the low quality tier. */
  private contactOn: boolean;
  private beaconScale = 1;
  /** Usable frame (px) for the flight camera: the HUD band at the top, the controls at the bottom. */
  private frameTop: number = DEFAULT_FRAME.top;
  private frameBottom: number = DEFAULT_FRAME.bottom;
  private readonly sprites: THREE.Texture[] = [];
  private detail: RegolithDetail;
  private readonly camPos = new THREE.Vector3(0, 400, 900);
  private readonly camLook = new THREE.Vector3();
  private readonly wantPos = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private readonly fromPos = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Vector3();
  private terrain: Terrain | null = null;
  private targetGround = 0;
  private snap = true;
  private puffed = false;
  private orbit = 0;
  private aspect = 16 / 9;
  private viewHeight = 720;
  private particleScale: number;
  private lastPhase: ScenePhase = 'pick';
  /** Seconds into the ready-to-descent swoop; negative when no swoop runs. */
  private swoop = -1;

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
    this.sun = new THREE.DirectionalLight('#fff4e2', SUN_INTENSITY);
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

    this.detail = makeRegolithDetail(rng.int(1, 1e9), 256, DEFAULT_LOOK, SUN);
    this.terrainView = new TerrainView(this.detail, LOD_BY_TIER[kit.settings.tier]);
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
    this.beacon = new THREE.Mesh(beaconGeo, this.beaconMat);
    this.beacon.name = 'beacon';
    this.beacon.position.y = 130;
    this.ring.add(this.beacon);
    scene.add(this.ring);

    this.lander = new LanderModel(rng.int(1, 1e9));
    scene.add(this.lander.root);

    // A soft halo behind the lander, a fixed size on screen, so it reads from high up.
    this.haloMat = new THREE.SpriteMaterial({
      map: glow,
      color: '#cfe6ff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
      toneMapped: false,
    });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.name = 'lander-halo';
    this.halo.renderOrder = 3;
    this.halo.visible = false;
    scene.add(this.halo);

    // The engine seen from above: a short warm glow under the lander, a fixed size on screen.
    this.plumeGlowMat = new THREE.SpriteMaterial({
      map: glow,
      color: '#ffc07a',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
      toneMapped: false,
    });
    this.plumeGlow = new THREE.Sprite(this.plumeGlowMat);
    this.plumeGlow.name = 'plume-glow';
    this.plumeGlow.renderOrder = 3;
    this.plumeGlow.visible = false;
    scene.add(this.plumeGlow);

    // Tilt chevron on the halo edge, toward the commanded tilt (drawn on top of everything).
    const chevronTex = makeChevronSprite(64);
    this.sprites.push(chevronTex);
    this.chevronMat = new THREE.SpriteMaterial({
      map: chevronTex,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
      toneMapped: false,
    });
    this.chevron = new THREE.Sprite(this.chevronMat);
    this.chevron.name = 'tilt-chevron';
    this.chevron.renderOrder = 6;
    this.chevron.visible = false;
    scene.add(this.chevron);

    // Attitude-thruster puffs: a small pool of additive sprites that share the glow texture.
    this.rcs = new RcsPuffs(glow);
    scene.add(this.rcs.group);

    // A soft dark contact shadow right under the lander in the last 20 m (a visual aid: the real
    // sun shadow falls far to the west at a 12 degree sun). Skipped on the low tier.
    this.contactMat = new THREE.MeshBasicMaterial({
      map: glow,
      color: '#000000',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const contactGeo = new THREE.CircleGeometry(1, 32);
    contactGeo.rotateX(-Math.PI / 2);
    this.contact = new THREE.Mesh(contactGeo, this.contactMat);
    this.contact.name = 'contact-shadow';
    this.contact.renderOrder = 1;
    this.contact.visible = false;
    this.contactOn = kit.settings.tier !== 'low';
    scene.add(this.contact);

    // A warm glow on the ground under the lander in the last 50 m (a visual aid).
    this.groundGlowMat = new THREE.MeshBasicMaterial({
      map: glow,
      color: '#ffd9a0',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const glowGeo = new THREE.CircleGeometry(1, 40);
    glowGeo.rotateX(-Math.PI / 2);
    this.groundGlow = new THREE.Mesh(glowGeo, this.groundGlowMat);
    this.groundGlow.name = 'ground-glow';
    this.groundGlow.renderOrder = 2;
    this.groundGlow.visible = false;
    scene.add(this.groundGlow);

    this.dust = new Dust(rng, 600 * this.particleScale * (o.reducedMotion ? 0.35 : 1), dustSprite);
    scene.add(this.dust.points);

    this.markerMat = new THREE.MeshBasicMaterial({
      color: MARKER_COLOR.good,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const markerGeo = new THREE.RingGeometry(2.4, MARKER_RADIUS, 40);
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

  /** Show a site: build the terrain meshes, its own ground detail, and drape the target ring. */
  setSite(src: TerrainSource): void {
    this.terrain = src.terrain;
    // Each site has its own crater density, crater size and colours (decoration only).
    const old = this.detail;
    this.detail = makeRegolithDetail(src.seed, 256, src.look, SUN);
    this.terrainView.setDetail(this.detail);
    old.albedo.dispose();
    old.normal.dispose();
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
    this.targetGround = t.heightAt(0, 0);
    this.beaconScale = 1;
    this.setBeaconHeight(1, true);
    this.dust.clear();
    this.snap = true;
  }

  setTier(tier: Tier): void {
    this.terrainView.setLod(LOD_BY_TIER[tier]);
    this.particleScale = this.kit.settings.particleScale;
    this.contactOn = tier !== 'low';
  }

  /**
   * The usable frame for the flight camera, in view pixels: the HUD band at the top and the
   * controls band at the bottom. The camera keeps the lander below the top band and the ground
   * point above the bottom band.
   */
  setFrameInsets(top: number, bottom: number): void {
    if (Number.isFinite(top)) this.frameTop = Math.max(0, top);
    if (Number.isFinite(bottom)) this.frameBottom = Math.max(0, bottom);
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.viewHeight = Math.max(1, height);
    const cam = this.kit.camera;
    // Portrait screens are narrow: a wider vertical view keeps the ground and the ring in frame.
    cam.fov = this.aspect < 1 ? 62 : 48;
    cam.updateProjectionMatrix();
  }

  /** Start of a new run: snap the camera, clear dust and touchdown effects. */
  resetRun(): void {
    this.snap = true;
    this.puffed = false;
    this.swoop = -1;
    this.dust.clear();
    this.rcs.clear();
    this.rcsTrigger.reset();
  }

  /** Attitude-thruster puffs alive now (test API). */
  get rcsPuffs(): number {
    return this.rcs.count;
  }

  /** The engine's share (0..1) in the halo tint and size now; 0 when the halo is plain or off (test API). */
  get haloThrottle(): number {
    return this.haloThr;
  }

  /** Ground height (m) at a world point, or 0 before a site loads. */
  groundAt(x: number, z: number): number {
    return this.terrain ? this.terrain.heightAt(x, z) : 0;
  }

  /** Ground height (m) at the centre of the target ring. */
  get targetHeight(): number {
    return this.targetGround;
  }

  /** Project a world point with the camera of the last update. */
  project(x: number, y: number, z: number, out: ScreenPoint): ScreenPoint {
    const cam = this.kit.camera;
    const v = this.tmp.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    out.behind = v.z > -cam.near;
    v.applyMatrix4(cam.projectionMatrix);
    out.x = Number.isFinite(v.x) ? v.x : 0;
    out.y = Number.isFinite(v.y) ? v.y : 0;
    return out;
  }

  update(dt: number, t: number, v: SceneView): void {
    const terrain = this.terrain;
    if (!terrain) return;
    const s = v.lander;
    const motion = this.motion;
    const live = !this.frozen && !v.paused;

    // Ready -> flying: swoop from the establishing shot into the descent cam (cut when reduced).
    if (v.phase === 'flying' && this.lastPhase === 'ready') {
      if (motion > 0) this.swoop = 0;
      else this.snap = true;
    }
    if (v.phase !== 'flying') this.swoop = -1;
    this.lastPhase = v.phase;

    // Lander pose, plus a spring dip (soft) or a kind little hop (bumpy) after touchdown.
    const root = this.lander.root;
    root.position.set(s.pos.x, s.pos.y, s.pos.z);
    root.quaternion.setFromUnitVectors(UP, this.tmpQ.set(...thrustVec(s)));
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
    this.fireThrusters(dt, v);

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
      // Never smaller than MARKER_MIN_PX across on screen: grow it with the camera distance.
      const cam = this.kit.camera;
      const far = cam.position.distanceTo(this.marker.position);
      // A length L at distance d spans L * H / (2 d tan(fov / 2)) px; the ring is 2 R across.
      const minScale = (MARKER_MIN_PX * far * Math.tan((cam.fov * DEG) / 2)) / (MARKER_RADIUS * this.viewHeight);
      this.marker.scale.setScalar(Math.max(1, minScale));
      // Manual flight up high: the HUD speed band; low down and with Help: the predicted touchdown.
      const col = MARKER_COLOR[markerBand(p, { assist: v.assist, band: v.band, altitude: v.altitude })];
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

    // The beacon reaches up toward the lander's start height, so the ready shot (seen from the
    // side) shows it. In flight the descent cam looks steeply down, where a tall beam would read
    // as a streak on the ground: it shrinks to a short pillar that follows the height.
    let beaconWant = 1;
    if (v.phase === 'ready') beaconWant = clamp((v.altitude * 0.85) / BEACON_FULL, 1, 2.6);
    else if (v.phase === 'flying' || v.phase === 'landed') {
      beaconWant = clamp(BEACON_FLIGHT.perMetre * v.altitude, BEACON_FLIGHT.min, BEACON_FLIGHT.max) / BEACON_FULL;
    }
    this.beaconScale = live && motion > 0 && v.phase !== 'pick' ? damp(this.beaconScale, beaconWant, 2.5, dt) : beaconWant;
    this.setBeaconHeight(this.beaconScale);
    // Beacon fades as the lander gets low (it is there to find the ring from high up).
    this.beaconMat.opacity = v.phase === 'pick' ? 1 : clamp((v.altitude - 20) / 150, 0.15, 1);
    this.ringMat.opacity = 0.85 + (live && motion > 0 ? 0.1 * Math.sin(t * 3) : 0.1);

    this.updateHalo(v);
    this.updateGroundGlow(v, terrain);

    this.terrainView.updatePatch(s.pos.x, s.pos.z);
    this.updateCamera(dt, v, ground);
    this.updateCues(dt, v);
    this.updateSun(s);
    this.sky.update(this.kit.camera, live ? t : 0);
  }

  private setBeaconHeight(scale: number, force = false): void {
    if (!force && Math.abs(this.beacon.scale.y - scale) < 1e-3) return;
    this.beacon.scale.y = scale;
    this.beacon.position.y = this.targetGround + 130 * scale;
  }

  /** Sprite scale (sizeAttenuation off) for a size on screen in px: scale 1 spans 1 / tan(fov / 2) half-heights. */
  private pxScale(px: number): number {
    const p11 = 1 / Math.tan((this.kit.camera.fov * DEG) / 2);
    return (2 * px) / (p11 * this.viewHeight);
  }

  private updateHalo(v: SceneView): void {
    const on = v.phase === 'ready' || v.phase === 'flying';
    const k = on ? smoothstep(HALO_FADE.low, HALO_FADE.high, v.altitude) : 0;
    // The engine on the halo: warm and bigger with the throttle high up, plain below 60 m. The
    // engine kick of a new press shows at KICK_LEVEL or more.
    const thr =
      v.phase === 'flying' && !v.paused
        ? this.engineShow(v) * smoothstep(HALO_THROTTLE.low, HALO_THROTTLE.full, v.altitude)
        : 0;
    this.haloK = k;
    this.halo.visible = k > 0.01;
    this.haloThr = this.halo.visible ? thr : 0;
    if (!this.halo.visible) return;
    // A square root, so the first press (10% throttle) already shows: a third warm, a little bigger.
    const e = Math.sqrt(thr);
    this.haloMat.opacity = (0.34 + 0.2 * e) * k;
    this.haloMat.color.copy(HALO_COOL).lerp(HALO_WARM, e);
    this.halo.position.copy(this.lander.root.position);
    this.halo.position.y += 0.6;
    this.halo.scale.setScalar(this.pxScale(this.haloPx()));
  }

  /** The engine share (0..1) the halo and the plume glow show: the throttle, or KICK_LEVEL during a kick. */
  private engineShow(v: SceneView): number {
    const thr = clamp(v.throttle, 0, 1);
    return v.kick ? Math.max(thr, KICK_LEVEL) : thr;
  }

  /** Halo size on screen (px): HALO_PX, up to HALO_THROTTLE.scale times with the engine high up. */
  private haloPx(): number {
    return HALO_PX * (1 + (HALO_THROTTLE.scale - 1) * Math.sqrt(this.haloThr));
  }

  /**
   * Attitude-thruster puffs from the shaped tilt command (not the lagged sim tilt): a new command
   * fires on this frame from the two corner thrusters on the side opposite the lean, then a burst
   * follows every RCS.interval s while the command changes or is held.
   */
  private fireThrusters(dt: number, v: SceneView): void {
    if (v.paused) return;
    if (v.phase !== 'flying') {
      this.rcsTrigger.reset();
      return;
    }
    const burst = this.rcsTrigger.update(v.cmdTiltX, v.cmdTiltZ, dt);
    if (!burst) return;
    const m = Math.hypot(burst.x, burst.z);
    // The jet points away from the lean (outward on the far side), with the lander's own speed.
    const jx = -burst.x / m;
    const jz = -burst.z / m;
    const per = this.particleScale >= 0.75 ? 2 : 1;
    const speed = RCS.speed * (this.motion > 0 ? 1 : 0.6);
    const root = this.lander.root;
    root.updateMatrixWorld(true);
    const lv = v.lander.vel;
    for (const i of firingThrusters(burst.x, burst.z)) {
      const t = THRUSTERS[i];
      if (!t) continue;
      for (let k = 0; k < per; k++) {
        this.rcsSeq++;
        const side = jitter(this.rcsSeq) * 0.3;
        const lift = jitter(this.rcsSeq + 0.37) * 0.15;
        const sp = speed * (1 - 0.3 * k);
        root.localToWorld(this.tmpP.set(t.x, t.y, t.z));
        this.tmpV.set(lv.x + (jx - jz * side) * sp, lv.y + lift * sp, lv.z + (jz + jx * side) * sp);
        this.rcs.spawn(this.tmpP, this.tmpV);
      }
    }
  }

  /**
   * Cues that need this frame's camera: the puffs keep a minimum size on screen, the plume glow
   * sits under the lander, and the tilt chevron sits on the halo edge toward the command.
   */
  private updateCues(dt: number, v: SceneView): void {
    const cam = this.kit.camera;
    const tanHalf = Math.tan((cam.fov * DEG) / 2);
    if (!v.paused) this.rcs.update(dt, cam.position, (2 * tanHalf) / this.viewHeight);

    const root = this.lander.root;
    const s = v.lander;
    // Plume glow: from above the real plume hides under the lander, so a warm glow peeks out. A new
    // press shows the engine kick (KICK_LEVEL or more) for ENGINE_KICK_MS.
    const thr = v.phase === 'flying' && !v.paused ? this.engineShow(v) : 0;
    const w = smoothstep(PLUME_GLOW.low, PLUME_GLOW.high, v.altitude);
    this.plumeGlow.visible = thr > 0 && w > 0.01;
    if (this.plumeGlow.visible) {
      const u = thrustDir(s.tiltX, s.tiltZ);
      this.plumeGlow.position.set(
        root.position.x - u.x * PLUME_GLOW.drop,
        root.position.y - u.y * PLUME_GLOW.drop,
        root.position.z - u.z * PLUME_GLOW.drop,
      );
      this.plumeGlowMat.opacity = w * (0.3 + 0.45 * thr);
      this.plumeGlow.scale.setScalar(this.pxScale(lerp(PLUME_GLOW.minPx, PLUME_GLOW.maxPx, thr)));
    }

    // Tilt chevron: on the halo edge, in the screen direction of the commanded tilt.
    const cm = Math.hypot(v.cmdTiltX, v.cmdTiltZ);
    let chev = v.phase === 'flying' && !v.paused && v.tiltHeld && cm > 0.01 && this.haloK > 0.05;
    if (chev) {
      const p = root.position;
      const dx = v.cmdTiltX / cm;
      const dz = v.cmdTiltZ / cm;
      this.project(p.x, p.y, p.z, this.cueA);
      this.project(p.x + dx * 5, p.y, p.z + dz * 5, this.cueB);
      const sx = ((this.cueB.x - this.cueA.x) * this.viewHeight * this.aspect) / 2;
      const sy = ((this.cueB.y - this.cueA.y) * this.viewHeight) / 2;
      const len = Math.hypot(sx, sy);
      if (this.cueA.behind || this.cueB.behind || len < 1e-3) chev = false;
      else {
        const r = this.haloPx() / 2 + CHEVRON.gap;
        const k = (5 * r) / len;
        this.chevron.position.set(p.x + dx * k, p.y + 0.6, p.z + dz * k);
        this.chevronMat.rotation = Math.atan2(sy, sx);
        this.chevronMat.opacity = 0.95 * Math.min(1, this.haloK * 1.5);
        this.chevron.scale.setScalar(this.pxScale(CHEVRON.px));
      }
    }
    this.chevron.visible = chev;
  }

  private updateGroundGlow(v: SceneView, terrain: Terrain): void {
    const s = v.lander;
    const g = terrain.gradientAt(s.pos.x, s.pos.z, 3);
    const groundY = terrain.heightAt(s.pos.x, s.pos.z);
    this.tmpQ.set(-g.dx, 1, -g.dz).normalize();

    // Contact shadow: a soft dark disc right under the lander, darker and tighter near the ground.
    const shadowOn = this.contactOn && (v.phase === 'flying' || v.phase === 'landed') && v.altitude < CONTACT_HEIGHT;
    this.contact.visible = shadowOn;
    if (shadowOn) {
      const c = 1 - Math.max(0, v.altitude) / CONTACT_HEIGHT;
      this.contactMat.opacity = 0.55 * c;
      this.contact.scale.setScalar(lerp(5, 3.4, c));
      this.contact.position.set(s.pos.x, groundY + 0.3, s.pos.z);
      this.contact.quaternion.setFromUnitVectors(UP, this.tmpQ);
    }

    // Ground glow: clear from 50 m (it shows at 20-40 m), brighter and tighter as the lander comes down.
    const on = v.phase === 'flying' && v.altitude < GLOW_HEIGHT;
    this.groundGlow.visible = on;
    if (!on) return;
    const k = 1 - Math.max(0, v.altitude) / GLOW_HEIGHT;
    const fadeIn = Math.min(1, k / 0.15);
    this.groundGlowMat.opacity = fadeIn * (0.32 + 0.38 * k);
    this.groundGlow.scale.setScalar(lerp(12, 5, k));
    this.groundGlow.position.set(s.pos.x, groundY + 0.4, s.pos.z);
    this.groundGlow.quaternion.setFromUnitVectors(UP, this.tmpQ);
  }

  /**
   * Establishing shot: a low hero shot behind the lander and a little below it, looking toward
   * the Earth's side of the sky. The lander stands in the upper middle (clear of the Go button),
   * the horizon and the Earth sit below it and to the left.
   */
  private readyPose(s: LanderState, pos: THREE.Vector3, look: THREE.Vector3): void {
    const az = EARTH_AZIMUTH + READY_EARTH_OFFSET;
    const fx = Math.sin(az);
    const fz = -Math.cos(az);
    const back = this.aspect < 1 ? READY_BACK.portrait : READY_BACK.landscape;
    pos.set(s.pos.x - fx * back, s.pos.y - READY_DOWN, s.pos.z - fz * back);
    const c = Math.cos(READY_PITCH) * LOOK_DIST;
    look.set(pos.x + fx * c, pos.y - Math.sin(READY_PITCH) * LOOK_DIST, pos.z + fz * c);
  }

  /**
   * Flight camera behind (south of) the lander, looking north. The pitch puts the lander and the
   * ground point under it both in frame: steep high up (descent cam), low near the ground.
   *
   * Two limits hold the frame (angles below the horizontal, view-pixel bands from setFrameInsets):
   * - from the bottom: the ground point stays above the controls band;
   * - from the top: the lander (and its top) stays below the HUD band.
   * When the span from the lander to the ground point is wider than the usable band, the camera
   * moves back until it fits: tan(elev + band) = (d sin(elev) + drop) / (d cos(elev)).
   */
  private flightPose(v: SceneView, ground: number, pos: THREE.Vector3, look: THREE.Vector3): void {
    const s = v.lander;
    const h = Math.max(0, v.altitude);
    const portrait = this.aspect < 1;
    const w = smoothstep(LOW_CAM_H, HIGH_CAM_H, h);
    const highDist = clamp(45 + 0.12 * h, 60, 90);
    let dist = lerp(LOW_DISTANCE, highDist, w) * (portrait ? 1.12 : 1);
    const elev = lerp(LOW_ELEVATION, HIGH_ELEVATION, w);
    const half = (this.kit.camera.fov * DEG) / 2;
    const tanHalf = Math.tan(half);
    const view = Math.max(1, this.viewHeight);
    // The usable band, as angles above and below the frame centre.
    const topLim = Math.atan(Math.max(0.05, 1 - (2 * (this.frameTop + LANDER_MARGIN_PX)) / view) * tanHalf);
    const botLim = Math.atan(Math.max(0.05, 1 - (2 * this.frameBottom) / view) * tanHalf);
    const drop = Math.max(0, s.pos.y - ground);
    const band = topLim + botLim;
    if (elev + band < 88 * DEG) {
      const denom = Math.tan(elev + band) * Math.cos(elev) - Math.sin(elev);
      if (denom > 1e-3) dist = Math.min(400, Math.max(dist, (drop / denom) * 1.06 + LANDER_TOP));
    }
    const back = dist * Math.cos(elev);
    const up = dist * Math.sin(elev);
    pos.set(s.pos.x, s.pos.y + up, s.pos.z + back);
    // Angles below the horizontal: to the lander, to its top and to the ground point under it.
    const toLander = elev;
    const toTop = toLander - Math.atan2(LANDER_TOP * Math.cos(elev), dist);
    const toGround = Math.atan2(up + drop, back);
    // Portrait: aim lower, so the ground point stays above the controls.
    let pitch = lerp(toLander, toGround, portrait ? 0.62 : 0.5);
    pitch = Math.max(pitch, toGround - botLim);
    pitch = Math.min(pitch, toTop + topLim);
    pitch = clamp(pitch, 4 * DEG, 86 * DEG);
    look.set(pos.x, pos.y - Math.sin(pitch) * LOOK_DIST, pos.z - Math.cos(pitch) * LOOK_DIST);
  }

  private updateCamera(dt: number, v: SceneView, ground: number): void {
    const terrain = this.terrain;
    if (!terrain) return;
    const s = v.lander;
    const portrait = this.aspect < 1 ? 1.18 : 1;
    const want = this.wantPos;
    const look = this.wantLook;
    let direct = false;
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
    } else if (v.phase === 'ready') {
      this.orbit = 0;
      this.readyPose(s, want, look);
    } else {
      this.orbit = 0;
      this.flightPose(v, ground, want, look);
      if (this.swoop >= 0 && this.swoop < SWOOP_TIME) {
        if (!v.paused) this.swoop += dt;
        const k = easeInOut(clamp(this.swoop / SWOOP_TIME, 0, 1));
        this.readyPose(s, this.fromPos, this.fromLook);
        want.lerpVectors(this.fromPos, want, k);
        look.lerpVectors(this.fromLook, look, k);
        direct = true;
      }
    }
    // Never below the ground.
    const floor = terrain.heightAt(want.x, want.z) + 4;
    if (want.y < floor) want.y = floor;
    if (this.snap || direct) {
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
    // The page projects the ring and the marker for the edge arrows before the next render.
    cam.updateMatrixWorld();
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
    this.haloMat.dispose();
    this.plumeGlowMat.dispose();
    this.chevronMat.dispose();
    this.rcs.dispose();
    this.groundGlow.geometry.dispose();
    this.groundGlowMat.dispose();
    this.contact.geometry.dispose();
    this.contactMat.dispose();
    this.detail.albedo.dispose();
    this.detail.normal.dispose();
    for (const tex of this.sprites) tex.dispose();
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
}

/** Repeatable jitter in -1..1 from a counter (no RNG draw, so the frozen test frames stay the same). */
function jitter(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return 2 * (x - Math.floor(x)) - 1;
}

function easeInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

function thrustVec(s: LanderState): [number, number, number] {
  const u = thrustDir(s.tiltX, s.tiltZ);
  return [u.x, u.y, u.z];
}
