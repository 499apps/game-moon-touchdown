import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  KEY_HINT_DELAY,
  KeyTracker,
  TOAST_TEXT,
  activeSource,
  activityOf,
  chipView,
  handover,
  keyHintDue,
  toastFor,
  type KeyLike,
} from './control';
import { ControlShaper, HELD_CODES, emptyIntent, mapKeyboard, mapTouch, throttleToLever } from './mapping';

const key = (code: string, more: Partial<KeyLike> = {}): KeyLike => ({
  code,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  targetTag: 'BODY',
  editable: false,
  ...more,
});

describe('key tracker', () => {
  it('holds flight keys by code and keeps them from the page while the flight owns the keys', () => {
    const t = new KeyTracker();
    expect(t.down(key('KeyW'), true)).toEqual({ pressed: true, preventDefault: true });
    expect(t.held.has('KeyW')).toBe(true);
    // Auto-repeat: no new press, but still no page scroll.
    expect(t.down(key('ArrowDown'), true).pressed).toBe(true);
    expect(t.down(key('ArrowDown', { repeat: true }), true)).toEqual({ pressed: false, preventDefault: true });
    // With a card open the arrows are the page's (the help card can scroll).
    expect(t.down(key('ArrowUp'), false)).toEqual({ pressed: true, preventDefault: false });
    expect(t.up('KeyW')).toBe(true);
    expect(t.held.has('KeyW')).toBe(false);
  });

  it('drops every held key on blur (clear)', () => {
    const t = new KeyTracker();
    t.down(key('KeyW'), true);
    t.down(key('ArrowLeft'), true);
    expect(t.clear()).toBe(true);
    expect(t.held.size).toBe(0);
    expect(t.clear()).toBe(false);
    // A repeat after the focus came back holds the key again, without a new press.
    expect(t.down(key('KeyW', { repeat: true }), true).pressed).toBe(false);
    expect(t.held.has('KeyW')).toBe(true);
  });

  it('drops every held key on a Cmd keyup (macOS sends no other keyups while Cmd is down)', () => {
    const t = new KeyTracker();
    t.down(key('KeyW'), true);
    expect(t.up('MetaLeft')).toBe(true);
    expect(t.held.size).toBe(0);
  });

  it('ignores browser shortcuts, typing targets and other keys', () => {
    const t = new KeyTracker();
    expect(t.down(key('KeyW', { ctrlKey: true }), true)).toEqual({ pressed: false, preventDefault: false });
    expect(t.down(key('KeyS', { metaKey: true }), true).preventDefault).toBe(false);
    expect(t.down(key('ArrowLeft', { altKey: true }), true).preventDefault).toBe(false);
    expect(t.down(key('KeyW', { targetTag: 'INPUT' }), true).preventDefault).toBe(false);
    expect(t.down(key('KeyW', { editable: true }), true).preventDefault).toBe(false);
    expect(t.down(key('KeyZ'), true)).toEqual({ pressed: false, preventDefault: false });
    expect(t.held.size).toBe(0);
  });

  it('holds back only the Space auto-repeat (the first press is the kit primary action)', () => {
    const t = new KeyTracker();
    expect(t.down(key('Space'), true).preventDefault).toBe(false);
    expect(t.down(key('Space', { repeat: true }), true).preventDefault).toBe(true);
    // A focused button keeps its own Space behaviour (keyboard users).
    expect(t.down(key('Space', { repeat: true, targetTag: 'BUTTON' }), true).preventDefault).toBe(false);
    expect(t.held.has('Space')).toBe(false);
  });

  it('every held code is prevented while captured, never while not (property)', () => {
    const codes = Array.from(HELD_CODES);
    fc.assert(
      fc.property(fc.constantFrom(...codes), fc.boolean(), fc.boolean(), (code, repeat, capture) => {
        const r = new KeyTracker().down(key(code, { repeat }), capture);
        return r.preventDefault === capture;
      }),
    );
  });
});

describe('handover', () => {
  it('player engine input while Help flies turns Help off on the same frame, with "You fly now"', () => {
    expect(handover(true, { engine: true, tilt: false })).toEqual({ assist: false, toast: 'you' });
    expect(TOAST_TEXT.you).toBe('You fly now');
    expect(TOAST_TEXT.help).toBe('Help flies the engine');
  });

  it('tilt input keeps Help on the engine (the player steers)', () => {
    expect(handover(true, { engine: false, tilt: true })).toEqual({ assist: true, toast: null });
  });

  it('nothing changes without Help or without engine input', () => {
    expect(handover(false, { engine: true, tilt: true })).toEqual({ assist: false, toast: null });
    expect(handover(true, { engine: false, tilt: false })).toEqual({ assist: true, toast: null });
  });

  it('the toast for a Help switch says who flies', () => {
    expect(toastFor(true)).toBe('help');
    expect(toastFor(false)).toBe('you');
  });

  it('a W press in a helped flight: Help off and the lever moves on the same frame (no jump down)', () => {
    // The page: Help flies at its throttle; W arrives; handover; the shaper gets the helper's lever.
    const helperThrottle = 0.32;
    const shaper = new ControlShaper();
    const w = mapKeyboard(new Set(['KeyW']));
    const h = handover(true, activityOf(w));
    expect(h.assist).toBe(false);
    shaper.setLever(throttleToLever(helperThrottle));
    const out = shaper.update(w, 1 / 60);
    expect(out.throttle).toBeGreaterThan(helperThrottle);
    // Engine activity comes from keys, the touch slider and the stick alike.
    expect(activityOf(mapTouch({ slider: 0.2, padX: 0, padY: 0 })).engine).toBe(true);
    expect(activityOf(emptyIntent())).toEqual({ engine: false, tilt: false });
  });
});

describe('input source and chip', () => {
  it('names the device giving input (keyboard first)', () => {
    const kb = mapKeyboard(new Set(['ArrowLeft']));
    const touch = mapTouch({ slider: 0.3, padX: 0, padY: 0 });
    expect(activeSource({ keyboard: kb, touch, pad: null })).toBe('keyboard');
    expect(activeSource({ keyboard: emptyIntent(), touch, pad: null })).toBe('touch');
    expect(activeSource({ keyboard: emptyIntent(), touch: null, pad: { lever: null, leverRate: 0.4, tiltX: 0, tiltZ: 0 } })).toBe('pad');
    expect(activeSource({ keyboard: emptyIntent(), touch: mapTouch({ slider: null, padX: 0, padY: 0 }), pad: null })).toBeNull();
  });

  it('lights the held key caps and says who flies the engine', () => {
    const v = chipView({
      assist: true,
      touchOn: false,
      last: 'helper',
      held: new Set(['KeyW', 'ArrowLeft', 'KeyI']),
      activity: { engine: true, tilt: true },
    });
    expect(v.device).toBe('keyboard');
    expect(v.engine).toBe('help');
    expect(v.keys).toEqual({ up: true, down: false, left: true, right: false, away: true, toward: false });
    expect(v.text).toContain('Help flies the engine');
    const you = chipView({ assist: false, touchOn: true, last: null, held: new Set(), activity: { engine: false, tilt: false } });
    expect(you.device).toBe('touch');
    expect(you.engine).toBe('you');
    expect(chipView({ assist: false, touchOn: true, last: 'pad', held: new Set(), activity: { engine: false, tilt: false } }).device).toBe('pad');
  });
});

describe('key hint', () => {
  const base = { flying: true, assist: false, keyboard: true, done: false, idle: KEY_HINT_DELAY };

  it('shows after 3 s without a key in a manual keyboard flight', () => {
    expect(keyHintDue(base)).toBe(true);
    expect(keyHintDue({ ...base, idle: KEY_HINT_DELAY - 0.01 })).toBe(false);
  });

  it('never shows with Help on, with touch controls, when done, or when not flying', () => {
    expect(keyHintDue({ ...base, assist: true })).toBe(false);
    expect(keyHintDue({ ...base, keyboard: false })).toBe(false);
    expect(keyHintDue({ ...base, done: true })).toBe(false);
    expect(keyHintDue({ ...base, flying: false })).toBe(false);
  });
});
