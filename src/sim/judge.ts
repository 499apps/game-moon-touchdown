/**
 * Landing judge and stars. A touchdown is soft when every limit holds; otherwise it is "bumpy"
 * (the legs bounce, nobody is hurt). The debrief explains each reason kindly.
 */
import { LIMITS, STAR_FUEL_SECONDS, TARGET_RADIUS } from './constants';

export type Outcome = 'soft' | 'bumpy';
export type BumpReason = 'fast' | 'drift' | 'tilt' | 'slope';

export interface Touchdown {
  /** Downward speed at contact (m/s, >= 0). */
  vs: number;
  /** Sideways speed at contact (m/s). */
  hs: number;
  /** Lander tilt at contact (rad). */
  tilt: number;
  /** Ground slope under the lander (rad). */
  slope: number;
  x: number;
  z: number;
  /** Seconds since the start of the run. */
  time: number;
  /** Fuel left (kg) and seconds of hover fuel left. */
  fuel: number;
  fuelSeconds: number;
}

export interface Verdict {
  outcome: Outcome;
  reasons: BumpReason[];
}

export function judgeTouchdown(td: Pick<Touchdown, 'vs' | 'hs' | 'tilt' | 'slope'>): Verdict {
  const reasons: BumpReason[] = [];
  if (!(td.vs < LIMITS.vs)) reasons.push('fast');
  if (!(td.hs < LIMITS.hs)) reasons.push('drift');
  if (!(td.tilt < LIMITS.tilt)) reasons.push('tilt');
  if (!(td.slope < LIMITS.slope)) reasons.push('slope');
  return { outcome: reasons.length === 0 ? 'soft' : 'bumpy', reasons };
}

/** Horizontal distance from the target (the site centre at x = z = 0). */
export function distanceFromTarget(x: number, z: number): number {
  return Math.hypot(x, z);
}

export interface StarBreakdown {
  soft: boolean;
  close: boolean;
  fuel: boolean;
  stars: number;
}

/** One star each: soft touchdown, inside the ring, fuel to spare. Bumpy landings get none. */
export function scoreStars(verdict: Verdict, distance: number, fuelSecondsLeft: number): StarBreakdown {
  const soft = verdict.outcome === 'soft';
  const close = soft && distance <= TARGET_RADIUS;
  const fuel = soft && fuelSecondsLeft >= STAR_FUEL_SECONDS;
  return { soft, close, fuel, stars: (soft ? 1 : 0) + (close ? 1 : 0) + (fuel ? 1 : 0) };
}

/** Short, kind words for each bump reason. */
export const BUMP_TEXT: Readonly<Record<BumpReason, string>> = {
  fast: 'Too fast down, so the legs went boing. Aim for under 2 m/s.',
  drift: 'Still sliding sideways. Tilt against the drift arrow first.',
  tilt: 'Leaning over at touchdown. Level out just before the ground.',
  slope: 'The ground here is a steep hill. Look for a flat spot.',
};
