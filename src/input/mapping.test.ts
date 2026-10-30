import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MAX_TILT } from '../sim/constants';
import {
  ControlShaper,
  KEY_LEVER_RATE,
  KEY_START_LEVER,
  KEY_TILT,
  KEY_TILT_SLEW,
  LEVER_OFF,
  TILT_SLEW,
  deadzone,
  emptyIntent,
  leverToThrottle,
  mapGamepad,
  mapKeyboard,
  mapTouch,
  mergeIntents,
  throttleToLever,
} from './mapping';

const pad = (axes: number[], pressed: number[] = []) => ({
  axes,
  buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});

describe('lever curve', () => {
  it('is off at the bottom, 10% just above, full at the top', () => {
    expect(leverToThrottle(0)).toBe(0);
    expect(leverToThrottle(LEVER_OFF)).toBe(0);
    expect(leverToThrottle(LEVER_OFF + 1e-6)).toBeCloseTo(0.1, 6);
    expect(leverToThrottle(1)).toBeCloseTo(1, 12);
    expect(leverToThrottle(5)).toBeCloseTo(1, 12);
    expect(leverToThrottle(Number.NaN)).toBe(0);
  });

  it('is monotonic (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return leverToThrottle(lo) <= leverToThrottle(hi);
      }),
    );
  });

  it('round-trips through throttleToLever (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, minExcluded: true, max: 1, noNaN: true }), (t) => {
        return Math.abs(leverToThrottle(throttleToLever(t)) - t) < 1e-9;
      }),
    );
    expect(throttleToLever(0)).toBe(0);
  });

  it('gives hover more lever travel than a straight line would', () => {
    // Hover is about 19% thrust: the curve puts it about a third of the way up.
    expect(throttleToLever(0.19)).toBeGreaterThan(0.3);
  });
});

describe('keyboard', () => {
  it('maps W/S to the throttle and the arrows, I J K L, A/D and Q/E to tilt', () => {
    expect(mapKeyboard(new Set(['KeyW'])).leverRate).toBe(KEY_LEVER_RATE);
    expect(mapKeyboard(new Set(['KeyS'])).leverRate).toBe(-KEY_LEVER_RATE);
    expect(mapKeyboard(new Set(['KeyW', 'KeyS'])).leverRate).toBe(0);
    // The arrows tilt in four directions and never move the throttle.
    expect(mapKeyboard(new Set(['ArrowDown'])).leverRate).toBe(0);
    expect(mapKeyboard(new Set(['ArrowUp'])).tiltZ).toBe(-KEY_TILT);
    expect(mapKeyboard(new Set(['ArrowDown'])).tiltZ).toBe(KEY_TILT);
    expect(mapKeyboard(new Set(['KeyK'])).tiltZ).toBe(KEY_TILT);
    expect(mapKeyboard(new Set(['KeyD'])).tiltX).toBe(KEY_TILT);
    expect(mapKeyboard(new Set(['ArrowLeft'])).tiltX).toBe(-KEY_TILT);
    expect(mapKeyboard(new Set(['KeyE'])).tiltZ).toBe(-KEY_TILT);
    expect(mapKeyboard(new Set(['KeyQ'])).tiltZ).toBe(KEY_TILT);
    expect(mapKeyboard(new Set(['KeyI', 'KeyJ'])).tiltX).toBe(-KEY_TILT);
    expect(mapKeyboard(new Set())).toEqual(emptyIntent());
  });
});

describe('gamepad', () => {
  it('left stick up raises the throttle, right stick tilts', () => {
    const i = mapGamepad(pad([0, -1, 1, 0]));
    expect(i.leverRate).toBeGreaterThan(0);
    expect(i.tiltX).toBeCloseTo(1, 9);
    expect(i.tiltZ).toBe(0);
    expect(mapGamepad(pad([0, 0.1, 0.1, -0.1]))).toEqual({ lever: null, leverRate: 0, tiltX: 0, tiltZ: 0 });
  });

  it('triggers trim the throttle', () => {
    expect(mapGamepad(pad([0, 0, 0, 0], [7])).leverRate).toBeGreaterThan(0);
    expect(mapGamepad(pad([0, 0, 0, 0], [6])).leverRate).toBeLessThan(0);
  });

  it('survives missing axes and buttons', () => {
    expect(mapGamepad({ axes: [], buttons: [] })).toEqual({ lever: null, leverRate: 0, tiltX: 0, tiltZ: 0 });
  });
});

describe('touch and merge', () => {
  it('the slider sets the lever while held', () => {
    expect(mapTouch({ slider: 0.4, padX: 0, padY: 0 }).lever).toBe(0.4);
    expect(mapTouch({ slider: null, padX: 0, padY: 0 }).lever).toBeNull();
    expect(mapTouch({ slider: 2, padX: 0, padY: 0 }).lever).toBe(1);
  });

  it('merged tilt never exceeds full deflection (property)', () => {
    const tilt = fc.double({ min: -1, max: 1, noNaN: true });
    fc.assert(
      fc.property(fc.array(fc.tuple(tilt, tilt), { maxLength: 4 }), (list) => {
        const m = mergeIntents(list.map(([x, z]) => ({ lever: null, leverRate: 0, tiltX: x, tiltZ: z })));
        return Math.hypot(m.tiltX, m.tiltZ) <= 1 + 1e-12;
      }),
    );
  });

  it('the last absolute lever wins', () => {
    const m = mergeIntents([
      { lever: 0.2, leverRate: 0, tiltX: 0, tiltZ: 0 },
      { lever: null, leverRate: 0.3, tiltX: 0, tiltZ: 0 },
      { lever: 0.7, leverRate: 0, tiltX: 0, tiltZ: 0 },
    ]);
    expect(m.lever).toBe(0.7);
    expect(m.leverRate).toBeCloseTo(0.3, 12);
  });

  it('deadzone rescales to the unit disc', () => {
    expect(deadzone(0.1, 0)).toEqual([0, 0]);
    const [x] = deadzone(1, 0);
    expect(x).toBeCloseTo(1, 12);
  });
});

describe('control shaper', () => {
  it('slews tilt at a limited rate and reports radians', () => {
    const s = new ControlShaper();
    const dt = 1 / 60;
    const out = s.update({ lever: null, leverRate: 0, tiltX: 1, tiltZ: 0 }, dt);
    expect(out.tiltX).toBeCloseTo(TILT_SLEW * dt * MAX_TILT, 12);
    expect(out.tiltActive).toBe(true);
    let last = out;
    for (let i = 0; i < 60; i++) last = s.update({ lever: null, leverRate: 0, tiltX: 1, tiltZ: 0 }, dt);
    expect(last.tiltX).toBeCloseTo(MAX_TILT, 12);
    expect(s.update(emptyIntent(), dt).tiltActive).toBe(false);
  });

  it('integrates the lever rate and clamps it to 0..1 (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -2, max: 2, noNaN: true }), { maxLength: 200 }), (rates) => {
        const s = new ControlShaper();
        for (const r of rates) {
          const o = s.update({ lever: null, leverRate: r, tiltX: 0, tiltZ: 0 }, 1 / 60);
          if (o.lever < 0 || o.lever > 1) return false;
          if (o.throttle !== leverToThrottle(o.lever)) return false;
        }
        return true;
      }),
    );
  });

  it('a first W press from off lights the engine on the same frame, then ramps', () => {
    const s = new ControlShaper();
    const dt = 1 / 60;
    const w = mapKeyboard(new Set(['KeyW']));
    const first = s.update(w, dt);
    expect(first.lever).toBeCloseTo(KEY_START_LEVER + KEY_LEVER_RATE * dt, 12);
    expect(first.throttle).toBeGreaterThan(0);
    // Holding W ramps at the key rate (no second step).
    const second = s.update(w, dt);
    expect(second.lever - first.lever).toBeCloseTo(KEY_LEVER_RATE * dt, 12);
    // Release and press again above the start lever: no step, only the ramp.
    s.update(emptyIntent(), dt);
    const again = s.update(w, dt);
    expect(again.lever - second.lever).toBeCloseTo(KEY_LEVER_RATE * dt, 12);
  });

  it('W takes off -> hover in 0.35 s or less, and the full range in 1.2 s or less', () => {
    const dt = 1 / 60;
    const w = mapKeyboard(new Set(['KeyW']));
    // The heaviest hover in the game is about 16.8% (DESIGN); check a little more.
    const hover = 0.17;
    const timeTo = (done: (o: { throttle: number; lever: number }) => boolean): number => {
      const s = new ControlShaper();
      for (let i = 1; i <= 600; i++) if (done(s.update(w, dt))) return i * dt;
      return Infinity;
    };
    expect(timeTo((o) => o.throttle >= hover)).toBeLessThanOrEqual(0.35);
    expect(timeTo((o) => o.lever >= 1)).toBeLessThanOrEqual(1.2);
    // The step stays at the low end: one press never jumps past hover.
    expect(leverToThrottle(KEY_START_LEVER)).toBeLessThan(hover);
    expect(leverToThrottle(KEY_START_LEVER)).toBeGreaterThan(0);
  });

  it('S brings the lever down at the same rate and never steps', () => {
    const s = new ControlShaper();
    s.setLever(0.5);
    const out = s.update(mapKeyboard(new Set(['KeyS'])), 1 / 60);
    expect(out.lever).toBeCloseTo(0.5 - KEY_LEVER_RATE / 60, 12);
  });

  it('tilt keys reach the full key tilt command in 50 ms', () => {
    const s = new ControlShaper();
    const left = mapKeyboard(new Set(['ArrowLeft']));
    expect(left.tiltSlew).toBe(KEY_TILT_SLEW);
    let out = s.update(left, 1 / 60);
    for (let i = 0; i < 2; i++) out = s.update(left, 1 / 60);
    expect(out.tiltX).toBeCloseTo(-KEY_TILT * MAX_TILT, 9);
    expect(out.tiltActive).toBe(true);
    // A stick keeps the gentler slew.
    expect(mapGamepad(pad([0, 0, 1, 0])).tiltSlew).toBeUndefined();
  });

  it('setLever hands the throttle back without a jump', () => {
    const s = new ControlShaper();
    s.setLever(throttleToLever(0.19));
    expect(s.update(emptyIntent(), 1 / 60).throttle).toBeCloseTo(0.19, 9);
  });
});
