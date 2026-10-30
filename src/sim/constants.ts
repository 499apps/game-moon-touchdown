/**
 * Physical constants and game limits for Moon Touchdown. Plain numbers only (no three.js), so
 * every sim module stays pure and unit tested. Units: metres, seconds, kilograms, newtons,
 * radians.
 */

export const DEG = Math.PI / 180;

/** Surface gravity of the Moon (m/s^2). */
export const G_MOON = 1.62;
/** Standard gravity of the Earth (m/s^2); also the g0 in the rocket equation. */
export const G_EARTH = 9.80665;
export const G0 = G_EARTH;

/** Specific impulse of the descent engine (s). */
export const ISP = 311;
/** Effective exhaust velocity Isp * g0 (m/s). */
export const EXHAUST_VELOCITY = ISP * G0;
/** Full engine thrust (N). */
export const MAX_THRUST = 45_000;
/** Lowest throttle while the engine is lit; 0 means the engine is off. */
export const MIN_THROTTLE = 0.1;
/** Lander mass without fuel (kg). */
export const DRY_MASS = 4_300;

/** Fixed simulation step (s). */
export const DT = 1 / 60;

/** Largest tilt from upright (rad). */
export const MAX_TILT = 30 * DEG;
/** Fastest attitude change (rad/s). */
export const TILT_RATE = 45 * DEG;
/** Time constant of the first-order attitude response (s). */
export const TILT_TAU = 0.25;

/** Footpads sit this far below the centre of mass (m). */
export const LEG_DROP = 2.0;
/** Footpad offset along x and z from the centre line (m); the legs form an X. */
export const LEG_SPREAD = 1.9;

/** Touchdown limits: all must hold for a soft landing. */
export const LIMITS = {
  /** Vertical speed (m/s). */
  vs: 2.0,
  /** Sideways speed (m/s). */
  hs: 1.2,
  /** Lander tilt (rad). */
  tilt: 10 * DEG,
  /** Ground slope under the lander (rad). */
  slope: 12 * DEG,
} as const;

/** Radius of the glowing target ring (m). */
export const TARGET_RADIUS = 40;

/** Fuel call-outs, in seconds of hover fuel left. */
export const CALLOUTS: readonly number[] = [60, 30];

/** Stars: a soft touchdown, inside the ring, and at least this much fuel left (s). */
export const STAR_FUEL_SECONDS = 30;

/** A manual pilot below this much fuel (s) gets a one-time "tap Help" prompt. */
export const LOW_FUEL_PROMPT_SECONDS = 15;
