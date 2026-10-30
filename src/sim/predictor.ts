/**
 * Touchdown predictor: integrates the current state forward with the pilot input held constant
 * (the hover assist keeps working inside the prediction, the same as in flight) until a footpad
 * meets the ground. Uses a coarser step than the flight and interpolates the contact moment.
 */
import { G_MOON } from './constants';
import { resolveCommand, heightAboveGround, type PilotInput } from './flight';
import { judgeTouchdown, type Outcome } from './judge';
import { cloneLander, stepLander, tiltAngle, type LanderState, type Vec3 } from './lander';
import type { AssistMemory } from './assist';
import type { Terrain } from './terrain';

export interface PredictOptions {
  /** Step (s). Default 1/15. */
  dt?: number;
  /** Look ahead at most this long (s). Default 90. */
  horizon?: number;
  /** Keep a trail point every N steps. Default 3. */
  trailEvery?: number;
  g?: number;
}

export interface Prediction {
  /** Seconds from now to touchdown. */
  t: number;
  /** Where the lander touches down. */
  x: number;
  y: number;
  z: number;
  /** Downward and sideways speed at touchdown (m/s). */
  vs: number;
  hs: number;
  tilt: number;
  slope: number;
  /** Fuel left at touchdown (kg). */
  fuel: number;
  outcome: Outcome;
  /** Centre-of-mass path from now to touchdown. */
  trail: Vec3[];
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Null when no touchdown happens inside the horizon (climbing, or hovering in place). */
export function predictTouchdown(
  terrain: Terrain,
  state: LanderState,
  input: PilotInput,
  memory: AssistMemory,
  o: PredictOptions = {},
): Prediction | null {
  const dt = o.dt ?? 1 / 15;
  const horizon = o.horizon ?? 90;
  const every = Math.max(1, o.trailEvery ?? 3);
  const g = o.g ?? G_MOON;
  const mem: AssistMemory = { ...memory };
  let s = cloneLander(state);
  let h = heightAboveGround(s, terrain);
  if (h <= 0) return null;
  const t0 = s.t;
  const trail: Vec3[] = [{ ...s.pos }];
  const steps = Math.ceil(horizon / dt);
  for (let k = 1; k <= steps; k++) {
    const cmd = resolveCommand(s, input, h, mem, dt, g);
    const next = stepLander(s, cmd, dt, g);
    const nh = heightAboveGround(next, terrain);
    if (nh <= 0) {
      // Contact inside this step: interpolate by the clearance before and after.
      const f = h / Math.max(1e-9, h - nh);
      const pos = {
        x: lerp(s.pos.x, next.pos.x, f),
        y: lerp(s.pos.y, next.pos.y, f),
        z: lerp(s.pos.z, next.pos.z, f),
      };
      const vy = lerp(s.vel.y, next.vel.y, f);
      const vx = lerp(s.vel.x, next.vel.x, f);
      const vz = lerp(s.vel.z, next.vel.z, f);
      trail.push(pos);
      const vs = Math.max(0, -vy);
      const hs = Math.hypot(vx, vz);
      const tilt = tiltAngle(next);
      const slope = terrain.slopeAt(pos.x, pos.z);
      return {
        t: lerp(s.t, next.t, f) - t0,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vs,
        hs,
        tilt,
        slope,
        fuel: lerp(s.fuel, next.fuel, f),
        outcome: judgeTouchdown({ vs, hs, tilt, slope }).outcome,
        trail,
      };
    }
    s = next;
    h = nh;
    if (k % every === 0) trail.push({ ...s.pos });
  }
  return null;
}
