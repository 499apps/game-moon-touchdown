/**
 * Attitude-thruster puffs: small white gas puffs from the lander's corner thrusters when the
 * player's tilt command changes or is held. The real lander turned with small thrusters like
 * these, and the puffs read from high up in the descent cam (a screen-space minimum size, like the
 * halo), so a child watching the lander sees every tilt key, pad or stick answer at once.
 *
 * - RcsTrigger (pure, unit tested): when to fire, and toward which side.
 * - firingThrusters (pure): the corner thrusters on the side opposite the lean.
 * - RcsPuffs: a fixed pool of additive sprites (no new textures, no allocation per puff).
 */
import * as THREE from 'three';

/** Corner thrusters in the lander body frame (m): +x = right, +z = toward the camera, y up. */
export const THRUSTERS: readonly { readonly x: number; readonly y: number; readonly z: number }[] = [
  { x: -1.32, y: 1.55, z: -1.15 },
  { x: -1.32, y: 1.55, z: 1.15 },
  { x: 1.32, y: 1.55, z: -1.15 },
  { x: 1.32, y: 1.55, z: 1.15 },
];

export const RCS = {
  /** Seconds between bursts while the command changes or is held. */
  interval: 0.09,
  /** Below this change (rad) per frame the command is steady. */
  changeEps: 0.0005,
  /** Above this command (rad, about 1 degree) a tilt is held. */
  holdMin: 0.0175,
  /** Puff life (s), jet speed (m/s), start and end size (m). */
  life: 0.42,
  speed: 11,
  startSize: 1.2,
  endSize: 3.4,
  /** Never smaller than this on screen (px across), so a puff reads at 250 m. */
  minPx: 13,
  /** Pool size: 2 thrusters x 2 puffs x about 5 bursts in a puff life, with room to spare. */
  pool: 24,
} as const;

/**
 * The thrusters that fire for a lean toward (dx, dz): the ones on the opposite side (their
 * position points away from the lean). Two for any direction; none for no direction.
 */
export function firingThrusters(dx: number, dz: number): number[] {
  if (!(Math.hypot(dx, dz) > 1e-9)) return [];
  const out: number[] = [];
  THRUSTERS.forEach((t, i) => {
    if (t.x * dx + t.z * dz < 0) out.push(i);
  });
  return out;
}

/** A burst to fire this frame: the lean direction (not normalised). */
export interface RcsBurst {
  x: number;
  z: number;
}

/**
 * When to fire. A new tilt command fires on the same frame. While the command changes or is held,
 * a burst follows every RCS.interval s. A change toward the other side fires at once. The
 * direction is the change while the command changes (so a release fires back the other way),
 * else the held lean.
 */
export class RcsTrigger {
  private prevX = 0;
  private prevZ = 0;
  private clock = 0;
  private active = false;
  private lastX = 0;
  private lastZ = 0;

  update(cmdX: number, cmdZ: number, dt: number): RcsBurst | null {
    const x = Number.isFinite(cmdX) ? cmdX : 0;
    const z = Number.isFinite(cmdZ) ? cmdZ : 0;
    const dX = x - this.prevX;
    const dZ = z - this.prevZ;
    this.prevX = x;
    this.prevZ = z;
    const changing = Math.hypot(dX, dZ) > RCS.changeEps;
    const held = Math.hypot(x, z) > RCS.holdMin;
    if (!changing && !held) {
      this.active = false;
      return null;
    }
    const dir: RcsBurst = changing ? { x: dX, z: dZ } : { x, z };
    const flipped = this.active && dir.x * this.lastX + dir.z * this.lastZ < 0;
    if (!this.active || flipped) this.clock = 0;
    this.active = true;
    this.clock -= Math.max(0, dt);
    if (this.clock > 0) return null;
    this.clock = RCS.interval;
    this.lastX = dir.x;
    this.lastZ = dir.z;
    return dir;
  }

  reset(): void {
    this.prevX = 0;
    this.prevZ = 0;
    this.clock = 0;
    this.active = false;
    this.lastX = 0;
    this.lastZ = 0;
  }
}

/** A pool of additive puff sprites. */
export class RcsPuffs {
  readonly group = new THREE.Group();
  private readonly sprites: THREE.Sprite[] = [];
  private readonly mats: THREE.SpriteMaterial[] = [];
  private readonly vel: THREE.Vector3[] = [];
  /** Age (s) of each puff; negative = free. */
  private readonly age: number[] = [];
  /** Spawned this frame: the next update does not age it (a slow frame must not hide a new puff). */
  private readonly fresh: boolean[] = [];
  private next = 0;
  private live = 0;

  constructor(map: THREE.Texture, size: number = RCS.pool) {
    this.group.name = 'rcs-puffs';
    for (let i = 0; i < size; i++) {
      const mat = new THREE.SpriteMaterial({
        map,
        color: '#eef7ff',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.renderOrder = 5;
      this.group.add(s);
      this.sprites.push(s);
      this.mats.push(mat);
      this.vel.push(new THREE.Vector3());
      this.age.push(-1);
      this.fresh.push(false);
    }
  }

  /** Puffs alive now (for the test API). */
  get count(): number {
    return this.live;
  }

  /** Start a puff at a world point with a world velocity (m/s). Reuses the oldest when full. */
  spawn(pos: THREE.Vector3, vel: THREE.Vector3): void {
    const n = this.sprites.length;
    let slot = -1;
    for (let k = 0; k < n; k++) {
      const i = (this.next + k) % n;
      if ((this.age[i] as number) < 0) {
        slot = i;
        break;
      }
    }
    if (slot < 0) slot = this.next;
    this.next = (slot + 1) % n;
    const s = this.sprites[slot] as THREE.Sprite;
    s.position.copy(pos);
    (this.vel[slot] as THREE.Vector3).copy(vel);
    if ((this.age[slot] as number) < 0) this.live++;
    this.age[slot] = 0;
    this.fresh[slot] = true;
    s.visible = true;
    (this.mats[slot] as THREE.SpriteMaterial).opacity = 0.85;
    s.scale.setScalar(RCS.startSize);
  }

  /**
   * Age, move and fade the puffs. `pxToWorld` turns screen px into metres at 1 m from the camera
   * (2 tan(fov / 2) / view height), so each puff keeps RCS.minPx across at any distance.
   */
  update(dt: number, camera: THREE.Vector3, pxToWorld: number): void {
    if (this.live === 0) return;
    const drag = Math.exp(-2.5 * dt);
    for (let i = 0; i < this.sprites.length; i++) {
      let a = this.age[i] as number;
      if (a < 0) continue;
      const s = this.sprites[i] as THREE.Sprite;
      const step = this.fresh[i] ? 0 : dt;
      this.fresh[i] = false;
      a += step;
      if (a >= RCS.life) {
        this.age[i] = -1;
        s.visible = false;
        this.live--;
        continue;
      }
      this.age[i] = a;
      const v = this.vel[i] as THREE.Vector3;
      s.position.addScaledVector(v, step);
      if (step > 0) v.multiplyScalar(drag);
      const k = a / RCS.life;
      const world = RCS.startSize + (RCS.endSize - RCS.startSize) * k;
      const minWorld = RCS.minPx * (1 + 0.6 * k) * s.position.distanceTo(camera) * pxToWorld;
      s.scale.setScalar(Math.max(world, minWorld));
      (this.mats[i] as THREE.SpriteMaterial).opacity = 0.85 * Math.pow(1 - k, 1.5);
    }
  }

  clear(): void {
    for (let i = 0; i < this.sprites.length; i++) {
      this.age[i] = -1;
      this.fresh[i] = false;
      (this.sprites[i] as THREE.Sprite).visible = false;
    }
    this.live = 0;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    this.group.removeFromParent();
  }
}
