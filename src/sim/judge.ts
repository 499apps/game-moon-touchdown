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

/** Above this height (m), running dry counts as "up high". */
export const FUEL_OUT_HIGH = 20;

export interface FuelAdvice {
  text: string;
  tip: string;
}

/** Kind words when the tank ran dry, by the height where it happened. Never shaming. */
export function fuelOutAdvice(height: number): FuelAdvice {
  if (!(height <= FUEL_OUT_HIGH)) {
    return {
      text: 'Out of fuel up high: start braking a bit later next time.',
      tip: 'Tip: fall faster up high (yellow is OK), then brake hard before the red. Help can also fly the engine for you.',
    };
  }
  return {
    text: 'Out of fuel just above the ground. So close!',
    tip: 'Tip: hover a little less on the way down. Help can also fly the engine for you.',
  };
}

/**
 * Kind words when the tank ran dry while Help was flying the engine. The helper flies a slow,
 * careful profile; it ran dry because it started with too little fuel, not because of the child.
 */
export function helperFuelOutAdvice(): FuelAdvice {
  return {
    text: 'Help started too late to save fuel.',
    tip: 'Tip: tap Help earlier next time, as soon as the Help sign shows.',
  };
}

/**
 * The reason line when the landing was soft but the fuel star was missed. It matches the speed
 * gauge: yellow means fast but safe to stop, red means brake now.
 */
export const FUEL_STAR_TIP = `Keep ${STAR_FUEL_SECONDS} s of fuel for another star: fall fast in the yellow up high, then brake hard before the red.`;

/** Debrief fuel line: what was left and where the star is. */
export function fuelLeftText(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `Fuel left: ${s} s (star at ${STAR_FUEL_SECONDS} s)`;
}

/** Debrief line: what the helper would have left from the same start. */
export function helperLeftText(seconds: number): string {
  return `Helper would have left ~${Math.max(0, Math.round(seconds))} s`;
}

/** Short, kind words for each bump reason. */
export const BUMP_TEXT: Readonly<Record<BumpReason, string>> = {
  fast: 'Too fast down, so the legs went boing. Aim for under 2 m/s.',
  drift: 'Still sliding sideways. Tilt against the drift arrow first.',
  tilt: 'Leaning over at touchdown. Level out just before the ground.',
  slope: 'The ground here is a steep hill. Look for a flat spot.',
};
