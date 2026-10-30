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

/** Height (m) above which the helper holds its fastest descent (175 m). */
export const ASSIST_KNEE_HEIGHT = (ASSIST_MAX_VS - ASSIST_TOUCHDOWN_VS) / ASSIST_VS_PER_M;

/** Seconds the helper takes from a height to touchdown when it already flies its profile speed. */
export function assistProfileTime(height: number): number {
  const h = Math.max(0, Number.isFinite(height) ? height : 0);
  const low = Math.min(h, ASSIST_KNEE_HEIGHT);
  const tLow = Math.log((ASSIST_TOUCHDOWN_VS + ASSIST_VS_PER_M * low) / ASSIST_TOUCHDOWN_VS) / ASSIST_VS_PER_M;
  return tLow + Math.max(0, h - ASSIST_KNEE_HEIGHT) / ASSIST_MAX_VS;
}

/** Safety factor and reserve (s) on the helper fuel estimate (ground under the drift, controller lag). */
export const ASSIST_NEED_FACTOR = 1.05;
export const ASSIST_NEED_RESERVE = 2;

/**
 * Hover-seconds of fuel the helper needs to land softly from here (an upper estimate), or
 * Infinity when even full thrust cannot stop the fall in the height that is left. Uses only what
 * the HUD shows: height, vertical speed, drift speed and the hover throttle.
 *
 * Vertical momentum gives the engine push exactly: push = g * flight time + (speed down now -
 * speed down at touchdown). In hover-seconds that is: flight time + (down - 1.5) / g. The flight
 * time is at most the profile time, plus the slow start when the lander is slower than the profile.
 */
export function assistFuelNeed(height: number, vy: number, hs: number, hoverThr: number, g = G_MOON): number {
  const h = Math.max(0, Number.isFinite(height) ? height : 0);
  const down = Number.isFinite(vy) ? -vy : 0;
  const u = -assistTargetVs(h);
  const hov = Math.max(1e-3, hoverThr);
  // Net braking acceleration at full thrust, upright.
  const spare = g / hov - g;
  if (!(spare > 0)) return Infinity;
  let time = assistProfileTime(h);
  if (down > u) {
    // Too fast: the helper brakes hard. With too little height left, no fuel is enough.
    if ((down * down - u * u) / (2 * spare) > 0.5 * h) return Infinity;
  } else {
    // Too slow or climbing: the helper idles at the lowest throttle until it reaches the
    // profile speed. That stretch covers less ground than the profile would in the same time.
    const sink = g - (MIN_THROTTLE * g) / hov;
    if (!(sink > 0)) return Infinity;
    const tAcc = (u - down) / sink;
    time += (tAcc * (u - down)) / (2 * u);
  }
  // Leaning against the drift costs a little extra push (well under a quarter of its speed).
  const drift = (0.25 * Math.max(0, Number.isFinite(hs) ? hs : 0)) / g;
  const push = time + (down - ASSIST_TOUCHDOWN_VS) / g + drift;
  return ASSIST_NEED_FACTOR * Math.max(0, push) + ASSIST_NEED_RESERVE;
}
