/**
 * Lander dynamics: point mass with a gimballed thrust vector, a rate-limited first-order
 * attitude response, and fuel burn from the rocket equation (mdot = F / (Isp * g0)).
 *
 * Tilt is a 2D vector (tiltX, tiltZ) in radians: the thrust leans toward +x (east) by tiltX and
 * toward +z (south, toward the camera) by tiltZ. Its length is the angle from upright.
 */
import {
  DRY_MASS,
  EXHAUST_VELOCITY,
  G_MOON,
  LEG_DROP,
  LEG_SPREAD,
  MAX_THRUST,
  MAX_TILT,
  MIN_THROTTLE,
  TILT_RATE,
  TILT_TAU,
} from './constants';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface LanderState {
  pos: Vec3;
  vel: Vec3;
  /** Current attitude (rad). */
  tiltX: number;
  tiltZ: number;
  /** Fuel left (kg). */
  fuel: number;
  /** Throttle applied in the last step (0 = off, else 0.1..1). */
  throttle: number;
  /** Seconds since the start of the run. */
  t: number;
}

/** What the lander is asked to do this step. */
export interface Command {
  throttle: number;
  tiltX: number;
  tiltZ: number;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Engine off below 0.5%, otherwise 10%..100% (the engine cannot run lower than 10%). */
export function clampThrottle(t: number): number {
  if (!Number.isFinite(t) || t < 0.005) return 0;
  return clamp(t, MIN_THROTTLE, 1);
}

/** Limit a tilt vector to max (rad), keeping its direction. */
export function clampTilt(x: number, z: number, max = MAX_TILT): { x: number; z: number } {
  const fx = Number.isFinite(x) ? x : 0;
  const fz = Number.isFinite(z) ? z : 0;
  const m = Math.hypot(fx, fz);
  if (m <= max) return { x: fx, z: fz };
  const k = max / m;
  return { x: fx * k, z: fz * k };
}

/** First-order response toward the command, at most TILT_RATE per second. */
export function stepAttitude(
  cur: { x: number; z: number },
  cmd: { x: number; z: number },
  dt: number,
): { x: number; z: number } {
  const k = 1 - Math.exp(-dt / TILT_TAU);
  let dx = (cmd.x - cur.x) * k;
  let dz = (cmd.z - cur.z) * k;
  const m = Math.hypot(dx, dz);
  const lim = TILT_RATE * dt;
  if (m > lim) {
    dx *= lim / m;
    dz *= lim / m;
  }
  return { x: cur.x + dx, z: cur.z + dz };
}

/** Unit thrust direction for a tilt vector. */
export function thrustDir(tx: number, tz: number): Vec3 {
  const a = Math.hypot(tx, tz);
  if (a < 1e-9) return { x: 0, y: 1, z: 0 };
  const s = Math.sin(a) / a;
  return { x: tx * s, y: Math.cos(a), z: tz * s };
}

export function tiltAngle(s: { tiltX: number; tiltZ: number }): number {
  return Math.hypot(s.tiltX, s.tiltZ);
}

export function massOf(s: { fuel: number }): number {
  return DRY_MASS + Math.max(0, s.fuel);
}

/** Fuel flow (kg/s) to hover at this mass. */
export function hoverFlow(mass: number, g = G_MOON): number {
  return (mass * g) / EXHAUST_VELOCITY;
}

/** Throttle that exactly balances gravity when upright. */
export function hoverThrottle(s: { fuel: number }, g = G_MOON): number {
  return (massOf(s) * g) / MAX_THRUST;
}

/** Seconds of hover left: fuel divided by the hover fuel flow at the current mass. */
export function fuelSeconds(s: { fuel: number }, g = G_MOON): number {
  if (s.fuel <= 0) return 0;
  return s.fuel / hoverFlow(massOf(s), g);
}

export function createLander(pos: Vec3, vel: Vec3, fuel: number): LanderState {
  return { pos: { ...pos }, vel: { ...vel }, tiltX: 0, tiltZ: 0, fuel, throttle: 0, t: 0 };
}

export function cloneLander(s: LanderState): LanderState {
  return { ...s, pos: { ...s.pos }, vel: { ...s.vel } };
}

/**
 * One fixed step. Attitude first, then thrust from the new attitude, then a constant-
 * acceleration update (exact for free fall). Mass is taken at the middle of the step.
 */
export function stepLander(s: LanderState, cmd: Command, dt: number, g = G_MOON): LanderState {
  const want = clampTilt(cmd.tiltX, cmd.tiltZ);
  const att = stepAttitude({ x: s.tiltX, z: s.tiltZ }, want, dt);
  let throttle = s.fuel > 0 ? clampThrottle(cmd.throttle) : 0;
  let thrust = throttle * MAX_THRUST;
  let burn = (thrust / EXHAUST_VELOCITY) * dt;
  if (burn > s.fuel) {
    // The last drops of fuel: thrust only for the part of the step they last.
    const k = s.fuel / burn;
    thrust *= k;
    throttle *= k;
    burn = s.fuel;
  }
  const m = DRY_MASS + s.fuel - burn / 2;
  const u = thrustDir(att.x, att.z);
  const ax = (thrust * u.x) / m;
  const ay = (thrust * u.y) / m - g;
  const az = (thrust * u.z) / m;
  const half = 0.5 * dt * dt;
  return {
    pos: {
      x: s.pos.x + s.vel.x * dt + ax * half,
      y: s.pos.y + s.vel.y * dt + ay * half,
      z: s.pos.z + s.vel.z * dt + az * half,
    },
    vel: { x: s.vel.x + ax * dt, y: s.vel.y + ay * dt, z: s.vel.z + az * dt },
    tiltX: att.x,
    tiltZ: att.z,
    fuel: Math.max(0, s.fuel - burn),
    throttle,
    t: s.t + dt,
  };
}

/** Rotate a body-frame vector by the lander tilt (Rodrigues, axis = up x thrust). */
export function rotateByTilt(v: Vec3, tx: number, tz: number): Vec3 {
  const a = Math.hypot(tx, tz);
  if (a < 1e-9) return { ...v };
  const kx = tz / a;
  const kz = -tx / a;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // k = (kx, 0, kz)
  const cx = -kz * v.y; // k x v
  const cy = kz * v.x - kx * v.z;
  const cz = kx * v.y;
  const kv = kx * v.x + kz * v.z;
  return {
    x: v.x * c + cx * s + kx * kv * (1 - c),
    y: v.y * c + cy * s,
    z: v.z * c + cz * s + kz * kv * (1 - c),
  };
}

/** Footpad offsets in the body frame: four legs in an X. */
export const FOOTPADS: readonly Vec3[] = [
  { x: LEG_SPREAD, y: -LEG_DROP, z: LEG_SPREAD },
  { x: -LEG_SPREAD, y: -LEG_DROP, z: LEG_SPREAD },
  { x: LEG_SPREAD, y: -LEG_DROP, z: -LEG_SPREAD },
  { x: -LEG_SPREAD, y: -LEG_DROP, z: -LEG_SPREAD },
];

/** World positions of the four footpads. */
export function footpadPositions(s: LanderState): Vec3[] {
  return FOOTPADS.map((p) => {
    const r = rotateByTilt(p, s.tiltX, s.tiltZ);
    return { x: s.pos.x + r.x, y: s.pos.y + r.y, z: s.pos.z + r.z };
  });
}
