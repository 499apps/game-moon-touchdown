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
/** Lever curve exponent: more travel near hover (about 16% thrust, a quarter of the way up) than near full power. */
export const LEVER_CURVE = 2;
/**
 * Lever units per second while a throttle key is held. With the first-press step below, W from
 * off reaches hover (lever about 0.3) in about 0.26 s and the top in about 1.1 s. From the hover
 * notch the first part of a press is gentler (KEY_FINE_SHARE below).
 */
export const KEY_LEVER_RATE = 0.85;
/**
 * A new "more engine" press (key or stick) with the lever at or near off jumps the lever here at
 * once: the engine lights on the same frame (just above the lowest throttle), then the rate ramps.
 */
export const KEY_START_LEVER = 0.08;
/** Lever units per second at full gamepad stick or trigger. */
export const PAD_LEVER_RATE = 0.8;
/**
 * Hover notch (F6). When the player lets go of the engine (key, stick or slider), the lever slides
 * back into the hover notch at this rate (lever units per second), so the lander keeps its speed
 * down instead of braking or falling on by itself. Full to hover takes about 0.18 s.
 */
export const LEVER_NOTCH_RATE = 4;
/** The lever counts as in the notch within this distance (lever units); a tap there changes nothing. */
export const LEVER_NOTCH_EPS = 0.01;
/**
 * A "more engine" press (key or stick) that starts in the notch ramps at this share of its rate
 * for the first KEY_FINE_SPAN of lever above the notch: small corrections near hover stay small
 * for a child who reacts late. A press from below the notch (engine off) keeps the full rate.
 */
export const KEY_FINE_SHARE = 0.3;
export const KEY_FINE_SPAN = 0.45;
/** Share of full tilt a held tilt key asks for. */
export const KEY_TILT = 0.6;
/** Tilt units per second (full deflection in a quarter second). */
export const TILT_SLEW = 4;
/** Tilt units per second for keys: a key is all or nothing, so the command follows it in 50 ms. */
export const KEY_TILT_SLEW = 12;
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
  /** Tilt command slew (units per second) when faster than TILT_SLEW (keys); unset = TILT_SLEW. */
  tiltSlew?: number;
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
  const on = (a: KeyAction): number => (keyActionHeld(held, a) ? 1 : 0);
  const tiltX = (on('tiltRight') - on('tiltLeft')) * KEY_TILT;
  const tiltZ = (on('tiltToward') - on('tiltAway')) * KEY_TILT;
  const out: Intent = {
    lever: null,
    leverRate: (on('throttleUp') - on('throttleDown')) * KEY_LEVER_RATE,
    tiltX,
    tiltZ,
  };
  if (tiltX !== 0 || tiltZ !== 0) out.tiltSlew = KEY_TILT_SLEW;
  return out;
}

/** A key for this action is held. */
export function keyActionHeld(held: ReadonlySet<string>, a: KeyAction): boolean {
  return KEYS[a].some((c) => held.has(c));
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
    if (i.tiltSlew !== undefined) out.tiltSlew = Math.max(out.tiltSlew ?? 0, i.tiltSlew);
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

/**
 * Turns intents into smooth, rate-limited controls. A new "more engine" rate (key or stick) with
 * the lever below KEY_START_LEVER steps it there first, so the engine answers on the same frame.
 *
 * Hover notch (F6), only while the page tells the shaper where hover is (setHoverLever):
 * - after the player's own engine input ends (key up, stick back, thumb off the slider), the
 *   lever slides into the notch, so "hands off" means "keep this speed";
 * - a "more engine" press that starts in the notch ramps gently at first (KEY_FINE_SHARE);
 * - setLever (Help hands the engine back) and reset leave the lever where it is until the player
 *   moves the engine.
 */
export class ControlShaper {
  private lever = 0;
  private tx = 0;
  private tz = 0;
  /** A "more engine" rate was asked in the last update (to find a new press). */
  private wasUp = false;
  /** Hover lever (the notch), or null when unknown (no notch, no fine ramp). */
  private notch: number | null = null;
  /** The player moved the lever since the last setLever or reset (the notch may pull). */
  private played = false;
  /** The gentle ramp of the current press lasts below this lever (-1 = no gentle ramp). */
  private fineUntil = -1;
  /** The lever reached the notch by itself; a small notch drift (fuel burn) then leaves it put. */
  private seated = false;

  get leverPosition(): number {
    return this.lever;
  }

  /** Where the hover notch is now (lever units), or null for no notch. */
  get hoverLever(): number | null {
    return this.notch;
  }

  /** Set the lever (new run, or the assist hands control back at its current throttle). */
  setLever(v: number): void {
    this.lever = clampN(Number.isFinite(v) ? v : 0, 0, 1);
    this.played = false;
    this.seated = false;
    this.fineUntil = -1;
  }

  /** The hover notch for this frame (the lever that gives hover throttle), or null for none. */
  setHoverLever(v: number | null): void {
    this.notch = v === null || !Number.isFinite(v) ? null : clampN(v, 0, 1);
  }

  reset(lever = 0): void {
    this.setLever(lever);
    this.tx = 0;
    this.tz = 0;
    this.wasUp = false;
  }

  update(intent: Intent, dt: number): ShapedControls {
    const up = intent.lever === null && intent.leverRate > 0;
    const engine = intent.lever !== null || intent.leverRate !== 0;
    const notch = this.notch;
    const before = this.lever;
    if (intent.lever !== null) this.lever = clampN(intent.lever, 0, 1);
    else if (intent.leverRate !== 0) {
      if (up && !this.wasUp) {
        const inNotch = notch !== null && Math.abs(this.lever - notch) <= LEVER_NOTCH_EPS;
        this.fineUntil = inNotch && notch !== null ? notch + KEY_FINE_SPAN : -1;
        if (this.lever < KEY_START_LEVER) this.lever = KEY_START_LEVER;
      }
      const rate = up && this.lever < this.fineUntil ? intent.leverRate * KEY_FINE_SHARE : intent.leverRate;
      this.lever = clampN(this.lever + rate * dt, 0, 1);
    } else if (this.played && notch !== null && this.lever !== notch && !(this.seated && Math.abs(this.lever - notch) <= LEVER_NOTCH_EPS)) {
      // Hands off: slide into the hover notch and stop exactly on it, never past it.
      const gap = notch - this.lever;
      const reach = LEVER_NOTCH_RATE * Math.max(0, dt);
      this.lever = Math.abs(gap) <= reach ? notch : this.lever + Math.sign(gap) * reach;
      if (this.lever === notch) this.seated = true;
    }
    // Only input that moved the lever arms the notch: a tap (the slider is relative) changes nothing.
    if (engine && this.lever !== before) {
      this.played = true;
      this.seated = false;
    }
    this.wasUp = up;
    const slew = Math.max(TILT_SLEW, intent.tiltSlew ?? TILT_SLEW);
    this.tx = rateLimit(this.tx, clampN(intent.tiltX, -1, 1), slew, dt);
    this.tz = rateLimit(this.tz, clampN(intent.tiltZ, -1, 1), slew, dt);
    return {
      lever: this.lever,
      throttle: leverToThrottle(this.lever),
      tiltX: this.tx * MAX_TILT,
      tiltZ: this.tz * MAX_TILT,
      tiltActive: Math.hypot(intent.tiltX, intent.tiltZ) > TILT_ACTIVE,
    };
  }
}
