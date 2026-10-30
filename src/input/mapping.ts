/**
 * Pure input mapping: keyboard, gamepad and touch state -> one intent -> the smoothed pilot
 * input the sim uses. No DOM here, so it is unit tested; src/input/devices.ts feeds it.
 *
 * Screen axes match the chase camera, which looks north: screen right = +x (east), screen up =
 * -z (north). So "tilt right" moves the lander right on the screen.
 */
import { MAX_TILT } from '../sim/constants';

/** Lever travel at the bottom that keeps the engine off. */
export const LEVER_OFF = 0.03;
/** Lever curve exponent: more travel near hover (about 19% thrust) than near full power. */
export const LEVER_CURVE = 2;
/** Lever units per second while a throttle key is held. */
export const KEY_LEVER_RATE = 0.45;
/** Lever units per second at full gamepad stick or trigger. */
export const PAD_LEVER_RATE = 0.8;
/** Share of full tilt a held tilt key asks for. */
export const KEY_TILT = 0.6;
/** Tilt units per second (full deflection in a quarter second). */
export const TILT_SLEW = 4;
export const DEADZONE = 0.15;
/** Below this deflection the player is not tilting (the assist may level the lander). */
export const TILT_ACTIVE = 0.05;

export const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Lever position 0..1 -> throttle (0 = off, else 0.1..1). */
export function leverToThrottle(lever: number): number {
  const l = clampN(Number.isFinite(lever) ? lever : 0, 0, 1);
  if (l <= LEVER_OFF) return 0;
  const k = (l - LEVER_OFF) / (1 - LEVER_OFF);
  return 0.1 + 0.9 * Math.pow(k, LEVER_CURVE);
}

/** Inverse of leverToThrottle (throttle 0 maps to lever 0). */
export function throttleToLever(throttle: number): number {
  if (!(throttle > 0)) return 0;
  const t = clampN(throttle, 0.1, 1);
  const k = Math.pow((t - 0.1) / 0.9, 1 / LEVER_CURVE);
  return LEVER_OFF + k * (1 - LEVER_OFF);
}

/** Radial deadzone with rescale; returns a vector of length <= 1. */
export function deadzone(x: number, y: number, dz = DEADZONE): [number, number] {
  const fx = Number.isFinite(x) ? x : 0;
  const fy = Number.isFinite(y) ? y : 0;
  const m = Math.hypot(fx, fy);
  if (m <= dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [fx * k, fy * k];
}

/** Moves prev toward target by at most rate * dt. */
export function rateLimit(prev: number, target: number, rate: number, dt: number): number {
  return prev + clampN(target - prev, -rate * dt, rate * dt);
}

/** One frame of device intent. */
export interface Intent {
  /** Absolute lever position (touch slider), or null to keep the lever. */
  lever: number | null;
  /** Lever change per second (keys, sticks, triggers). */
  leverRate: number;
  /** Tilt -1..1: +x = right (east), +z = toward the camera (south). */
  tiltX: number;
  tiltZ: number;
}

export const emptyIntent = (): Intent => ({ lever: null, leverRate: 0, tiltX: 0, tiltZ: 0 });

export type KeyAction = 'throttleUp' | 'throttleDown' | 'tiltLeft' | 'tiltRight' | 'tiltAway' | 'tiltToward';

/**
 * KeyboardEvent.code values per action. The help card shows "W/S engine, arrow keys or I J K L
 * tilt"; A/D and E/Q still work but are not shown (E/Q for away/toward was hard to remember).
 */
export const KEYS: Readonly<Record<KeyAction, readonly string[]>> = {
  throttleUp: ['KeyW'],
  throttleDown: ['KeyS'],
  tiltLeft: ['ArrowLeft', 'KeyJ', 'KeyA'],
  tiltRight: ['ArrowRight', 'KeyL', 'KeyD'],
  tiltAway: ['ArrowUp', 'KeyI', 'KeyE'],
  tiltToward: ['ArrowDown', 'KeyK', 'KeyQ'],
};

/** Every code the game reads as held (so the page can track only these). */
export const HELD_CODES: ReadonlySet<string> = new Set(Object.values(KEYS).flat());

export function mapKeyboard(held: ReadonlySet<string>): Intent {
  const on = (a: KeyAction): number => (KEYS[a].some((c) => held.has(c)) ? 1 : 0);
  return {
    lever: null,
    leverRate: (on('throttleUp') - on('throttleDown')) * KEY_LEVER_RATE,
    tiltX: (on('tiltRight') - on('tiltLeft')) * KEY_TILT,
    tiltZ: (on('tiltToward') - on('tiltAway')) * KEY_TILT,
  };
}

/** Standard gamepad: left stick Y = throttle (up = more), right stick = tilt, RT/LT = throttle. */
export interface PadState {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export function mapGamepad(p: PadState): Intent {
  const [, ly] = deadzone(0, p.axes[1] ?? 0);
  const [rx, ry] = deadzone(p.axes[2] ?? 0, p.axes[3] ?? 0);
  const btn = (n: number): number => {
    const b = p.buttons[n];
    if (!b) return 0;
    return Math.max(b.pressed ? 1 : 0, Number.isFinite(b.value) ? b.value : 0);
  };
  return {
    lever: null,
    leverRate: (-ly + btn(7) - btn(6)) * PAD_LEVER_RATE,
    tiltX: rx,
    tiltZ: ry,
  };
}

/** Touch: throttle slider (0..1 while held, else null) and the tilt pad offset (-1..1). */
export interface TouchState {
  slider: number | null;
  padX: number;
  padY: number;
}

export function mapTouch(t: TouchState): Intent {
  const [x, y] = deadzone(t.padX, t.padY, 0.08);
  return {
    lever: t.slider === null ? null : clampN(t.slider, 0, 1),
    leverRate: 0,
    tiltX: x,
    tiltZ: y,
  };
}

/** Merge devices: tilts and rates add (clamped), the last absolute lever wins. */
export function mergeIntents(list: readonly Intent[]): Intent {
  const out = emptyIntent();
  for (const i of list) {
    out.tiltX += i.tiltX;
    out.tiltZ += i.tiltZ;
    out.leverRate += i.leverRate;
    if (i.lever !== null) out.lever = i.lever;
  }
  const m = Math.hypot(out.tiltX, out.tiltZ);
  if (m > 1) {
    out.tiltX /= m;
    out.tiltZ /= m;
  }
  return out;
}

export interface ShapedControls {
  /** Lever 0..1 and the throttle it gives. */
  lever: number;
  throttle: number;
  /** Tilt command (rad). */
  tiltX: number;
  tiltZ: number;
  tiltActive: boolean;
}

/** Turns intents into smooth, rate-limited controls. */
export class ControlShaper {
  private lever = 0;
  private tx = 0;
  private tz = 0;

  get leverPosition(): number {
    return this.lever;
  }

  /** Set the lever (new run, or the assist hands control back at its current throttle). */
  setLever(v: number): void {
    this.lever = clampN(Number.isFinite(v) ? v : 0, 0, 1);
  }

  reset(lever = 0): void {
    this.setLever(lever);
    this.tx = 0;
    this.tz = 0;
  }

  update(intent: Intent, dt: number): ShapedControls {
    if (intent.lever !== null) this.lever = clampN(intent.lever, 0, 1);
    else this.lever = clampN(this.lever + intent.leverRate * dt, 0, 1);
    this.tx = rateLimit(this.tx, clampN(intent.tiltX, -1, 1), TILT_SLEW, dt);
    this.tz = rateLimit(this.tz, clampN(intent.tiltZ, -1, 1), TILT_SLEW, dt);
    return {
      lever: this.lever,
      throttle: leverToThrottle(this.lever),
      tiltX: this.tx * MAX_TILT,
      tiltZ: this.tz * MAX_TILT,
      tiltActive: Math.hypot(intent.tiltX, intent.tiltZ) > TILT_ACTIVE,
    };
  }
}
