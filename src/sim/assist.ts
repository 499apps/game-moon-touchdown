/**
 * Hover assist for younger players: a PI controller on vertical speed and a drift killer.
 *
 * Vertical: hold a descent rate that eases from 12 m/s high up to a gentle 1.5 m/s at the
 * ground (a fixed 1.5 m/s from 700 m would need more fuel than the lander carries).
 * Sideways: when the player gives no tilt, lean against the drift until it stops.
 */
import { DEG, G_MOON, MAX_THRUST, MIN_THROTTLE } from './constants';
import { clamp, clampTilt, massOf, tiltAngle, type LanderState } from './lander';

/** Descent rate at touchdown (m/s). */
export const ASSIST_TOUCHDOWN_VS = 1.5;
/** Fastest descent the assist holds high up (m/s). */
export const ASSIST_MAX_VS = 12;
/** Extra descent rate per metre of height (1/s). */
export const ASSIST_VS_PER_M = 0.06;
/** Vertical speed gains: accel (m/s^2) per m/s of error, and per m of integrated error. */
export const ASSIST_KP = 1.2;
export const ASSIST_KI = 0.15;
/** Lean (rad) per m/s of drift, and the most the assist will lean. */
export const ASSIST_KV = 0.25;
export const ASSIST_MAX_TILT = 15 * DEG;

export interface AssistMemory {
  integral: number;
}

export function createAssistMemory(): AssistMemory {
  return { integral: 0 };
}

/** Wanted vertical velocity (m/s, negative = down) at a height above the ground. */
export function assistTargetVs(height: number): number {
  const h = Math.max(0, Number.isFinite(height) ? height : 0);
  return -clamp(ASSIST_TOUCHDOWN_VS + ASSIST_VS_PER_M * h, ASSIST_TOUCHDOWN_VS, ASSIST_MAX_VS);
}

/** Throttle that tracks the wanted descent rate. Updates the integral in place. */
export function assistThrottle(
  s: LanderState,
  height: number,
  mem: AssistMemory,
  dt: number,
  g = G_MOON,
): number {
  const err = assistTargetVs(height) - s.vel.y;
  const accel = g + ASSIST_KP * err + ASSIST_KI * mem.integral;
  const cosA = Math.max(0.5, Math.cos(tiltAngle(s)));
  const raw = (accel * massOf(s)) / (MAX_THRUST * cosA);
  const out = clamp(raw, MIN_THROTTLE, 1);
  // Anti-windup: integrate only while the throttle is not pinned at a limit.
  if (out === raw) mem.integral = clamp(mem.integral + err * dt, -10, 10);
  return out;
}

/** Lean against the drift so the sideways speed goes to zero. */
export function assistTilt(s: LanderState): { x: number; z: number } {
  return clampTilt(-ASSIST_KV * s.vel.x, -ASSIST_KV * s.vel.z, ASSIST_MAX_TILT);
}
