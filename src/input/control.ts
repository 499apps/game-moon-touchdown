/**
 * Pure control logic between the devices and the page, so it is unit tested (no DOM here):
 * - KeyTracker: which flight keys are held, and which key events the page must keep from the
 *   browser (no page scroll, no second click on a focused button);
 * - handover: who flies the engine after this frame's input (a player engine input while Help
 *   flies hands the engine to the player at once, with a "You fly now" toast);
 * - chipView: what the HUD input chip shows (source, who flies the engine, lit key caps);
 * - keyHintDue: when the one-time key hint shows in the first manual flight.
 * src/input/devices.ts and src/main.ts feed it.
 */
import { HELD_CODES, TILT_ACTIVE, keyActionHeld, type Intent } from './mapping';

/** The fields of a KeyboardEvent the tracker reads. */
export interface KeyLike {
  /** KeyboardEvent.code: the physical key, the same on every layout (QWERTY, AZERTY, Dvorak). */
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Tag name of the event target in upper case ('' for the window). */
  targetTag: string;
  /** The target takes text (contenteditable). */
  editable: boolean;
}

export interface KeyResult {
  /** A flight key went down now (not a repeat): it counts as new input. */
  pressed: boolean;
  /** The page calls preventDefault (no scroll, no button activation by a repeat). */
  preventDefault: boolean;
}

const NONE: KeyResult = { pressed: false, preventDefault: false };
const TYPING_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const BUTTON_TAGS: ReadonlySet<string> = new Set(['BUTTON', 'A', 'SUMMARY']);

/**
 * Held flight keys. `capture` is true while the flight owns the keyboard (no card or drawer
 * open): then the flight keys never reach the browser, so arrows and their auto-repeat never
 * scroll the page. Space is the kit's primary action; its auto-repeat is held back too.
 */
export class KeyTracker {
  readonly held = new Set<string>();

  down(k: KeyLike, capture: boolean): KeyResult {
    if (k.editable || TYPING_TAGS.has(k.targetTag)) return NONE;
    // Browser shortcuts (Ctrl+W, Cmd+S, Alt+arrows) are never flight keys.
    if (k.ctrlKey || k.metaKey || k.altKey) return NONE;
    if (k.code === 'Space') {
      return { pressed: false, preventDefault: capture && k.repeat && !BUTTON_TAGS.has(k.targetTag) };
    }
    if (!HELD_CODES.has(k.code)) return NONE;
    // A repeat for a key the tracker dropped (focus left and came back) holds it again.
    const fresh = !this.held.has(k.code);
    this.held.add(k.code);
    return { pressed: fresh && !k.repeat, preventDefault: capture };
  }

  /** Key up. Returns true when the held set changed. */
  up(code: string): boolean {
    // macOS sends no keyup for other keys while Cmd is down: drop them all with Cmd.
    if (code === 'MetaLeft' || code === 'MetaRight') return this.clear();
    return this.held.delete(code);
  }

  /** Drop every held key (window blur, page hidden, pause). Returns true when any was held. */
  clear(): boolean {
    const had = this.held.size > 0;
    this.held.clear();
    return had;
  }
}

/** Where control input comes from. 'helper' = Help flies the engine. */
export type ControlSource = 'keyboard' | 'touch' | 'pad';
export type LastSource = ControlSource | 'helper' | null;

/** Engine and tilt input in one intent. */
export interface Activity {
  engine: boolean;
  tilt: boolean;
}

export function activityOf(i: Intent): Activity {
  return {
    engine: i.lever !== null || i.leverRate !== 0,
    tilt: Math.hypot(i.tiltX, i.tiltZ) > TILT_ACTIVE,
  };
}

/** Each device's intent for one frame (null = device off or absent). */
export interface DeviceIntents {
  keyboard: Intent;
  touch: Intent | null;
  pad: Intent | null;
}

/** The device giving input this frame (keyboard, then touch, then pad), or null. */
export function activeSource(d: DeviceIntents): ControlSource | null {
  const busy = (i: Intent | null): boolean => {
    if (!i) return false;
    const a = activityOf(i);
    return a.engine || a.tilt;
  };
  if (busy(d.keyboard)) return 'keyboard';
  if (busy(d.touch)) return 'touch';
  if (busy(d.pad)) return 'pad';
  return null;
}

/** A short toast: "You fly now" or "Help flies the engine". */
export type Toast = 'you' | 'help' | null;

export const TOAST_TEXT: Readonly<Record<'you' | 'help', string>> = {
  you: 'You fly now',
  help: 'Help flies the engine',
};

export interface Handover {
  assist: boolean;
  toast: Toast;
}

/**
 * Who flies the engine after this frame's input. Engine input from the player while Help flies
 * hands the engine to the player at once: Help turns off and the toast says "You fly now". Help
 * never moves the lever after that. Tilt input does not turn Help off: Help keeps the engine and
 * the player steers (the input chip shows both).
 */
export function handover(assist: boolean, input: Activity): Handover {
  if (assist && input.engine) return { assist: false, toast: 'you' };
  return { assist, toast: null };
}

/** The toast for a Help switch: on = "Help flies the engine", off = "You fly now". */
export function toastFor(assistOn: boolean): Toast {
  return assistOn ? 'help' : 'you';
}

/** Key caps on the chip: W, S and the four tilt directions. */
export interface LitKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  away: boolean;
  toward: boolean;
}

export interface ChipView {
  /** Which glyphs show: key caps, the touch slider and pad, or the gamepad. */
  device: ControlSource;
  /** Who flies the engine. The player always steers. */
  engine: 'help' | 'you';
  keys: LitKeys;
  /** Live engine and tilt input from the shown device (lights the touch and pad glyphs). */
  engineLive: boolean;
  tiltLive: boolean;
  /** Text for screen readers (the chip shows icons and key caps). */
  text: string;
}

export interface ChipInput {
  assist: boolean;
  touchOn: boolean;
  last: LastSource;
  held: ReadonlySet<string>;
  /** Engine and tilt input this frame from any device. */
  activity: Activity;
}

/** What the HUD input chip shows. */
export function chipView(o: ChipInput): ChipView {
  const device: ControlSource =
    o.last === 'keyboard' || o.last === 'touch' || o.last === 'pad' ? o.last : o.touchOn ? 'touch' : 'keyboard';
  const keys: LitKeys = {
    up: keyActionHeld(o.held, 'throttleUp'),
    down: keyActionHeld(o.held, 'throttleDown'),
    left: keyActionHeld(o.held, 'tiltLeft'),
    right: keyActionHeld(o.held, 'tiltRight'),
    away: keyActionHeld(o.held, 'tiltAway'),
    toward: keyActionHeld(o.held, 'tiltToward'),
  };
  return {
    device,
    engine: o.assist ? 'help' : 'you',
    keys,
    engineLive: o.activity.engine,
    tiltLive: o.activity.tilt,
    text: o.assist ? 'Help flies the engine. You steer.' : 'You fly the engine and steer.',
  };
}

/** Seconds without a flight key, after Help turns off, before the one-time key hint shows. */
export const KEY_HINT_DELAY = 3;

export interface KeyHintInput {
  /** The lander flies and the game is not paused. */
  flying: boolean;
  assist: boolean;
  /** The keyboard is the control device (the touch pad is off). */
  keyboard: boolean;
  /** The hint already showed on this page, or the player has landed solo before. */
  done: boolean;
  /** Seconds since Help turned off or the last player input, whichever is later. */
  idle: number;
}

/** The first manual flight shows the key hint once when no key is pressed for 3 s. */
export function keyHintDue(o: KeyHintInput): boolean {
  return o.flying && !o.assist && o.keyboard && !o.done && o.idle >= KEY_HINT_DELAY;
}
