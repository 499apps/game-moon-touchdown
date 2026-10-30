/**
 * Touchdown predictor: integrates the current state forward with the pilot input held constant
 * (the hover assist keeps working inside the prediction, the same as in flight) until a footpad
 * meets the ground. Uses a coarser step than the flight and interpolates the contact moment.
 *
 * While the player holds a key, the pad or a stick, the input is a short press, not a plan: with
 * `fade` set, a held tilt fades to the helper's lean and a held throttle to hover over `fade`
 * seconds (fadeTilt / fadeThrottle say which input is live). Without it the input is held as is
 * (the no-input case, checked against the full sim).
 */
import { G_MOON, MIN_THROTTLE } from './constants';
import { resolveCommand, heightAboveGround, type PilotInput } from './flight';
import { judgeTouchdown, type Outcome } from './judge';
import { clamp, cloneLander, hoverThrottle, stepLander, tiltAngle, type LanderState, type Vec3 } from './lander';
import { assistTilt, type AssistMemory } from './assist';
import type { Terrain } from './terrain';

export interface PredictOptions {
  /** Step (s). Default 1/15. */
  dt?: number;
  /** Look ahead at most this long (s). Default 90. */
  horizon?: number;
  /** Keep a trail point every N steps. Default 3. */
  trailEvery?: number;
  g?: number;
  /** Seconds over which live player input fades (0 or unset: held as is). */
  fade?: number;
  /** The tilt input is live: it fades to the helper's lean. */
  fadeTilt?: boolean;
  /** The engine input is live (manual flight): it fades to the hover throttle. */
  fadeThrottle?: boolean;
}

/** Default fade (s) for live input, about the length of a short key press and its answer. */
export const LIVE_INPUT_FADE = 1.5;

/** The pilot input `k` (0..1) of the way through the fade. */
export function fadeInput(
  input: PilotInput,
  s: LanderState,
  k: number,
  o: { tilt: boolean; throttle: boolean },
  g = G_MOON,
): PilotInput {
  const w = clamp(k, 0, 1);
  if (w <= 0 || (!o.tilt && !o.throttle)) return input;
  const out: PilotInput = { ...input };
  if (o.tilt) {
    const lean = assistTilt(s);
    out.tiltX = lerp(input.tiltX, lean.x, w);
    out.tiltZ = lerp(input.tiltZ, lean.z, w);
  }
  if (o.throttle && !input.assist) {
    const hover = clamp(hoverThrottle(s, g) / Math.max(0.5, Math.cos(tiltAngle(s))), MIN_THROTTLE, 1);
    out.throttle = lerp(input.throttle, hover, w);
    // Manual flight has no helper lean: the faded tilt is the command.
    if (o.tilt) out.tiltActive = true;
  }
  return out;
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
  const fade = o.fade ?? 0;
  const fadeWhat = { tilt: o.fadeTilt === true, throttle: o.fadeThrottle === true };
  const fading = fade > 0 && (fadeWhat.tilt || fadeWhat.throttle);
  for (let k = 1; k <= steps; k++) {
    const now = fading ? fadeInput(input, s, ((k - 1) * dt) / fade, fadeWhat, g) : input;
    const cmd = resolveCommand(s, now, h, mem, dt, g);
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
