import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { RCS, RcsTrigger, THRUSTERS, firingThrusters } from './rcsPuffs';

const DT = 1 / 60;
const KEY_CMD = -0.6 * 30 * (Math.PI / 180);

describe('attitude-thruster puffs (R3 finding 1)', () => {
  it('fires on the same frame as a new tilt command', () => {
    const t = new RcsTrigger();
    expect(t.update(0, 0, DT)).toBeNull();
    const b = t.update(KEY_CMD / 3, 0, DT);
    expect(b).not.toBeNull();
    expect(b?.x ?? 0).toBeLessThan(0);
  });

  it('keeps firing every interval while the tilt is held, and stops when it is released and steady', () => {
    const t = new RcsTrigger();
    let bursts = 0;
    for (let i = 0; i < 60; i++) if (t.update(KEY_CMD, 0, DT)) bursts++;
    // One second held: a burst about every RCS.interval s.
    expect(bursts).toBeGreaterThanOrEqual(Math.floor(1 / RCS.interval) - 1);
    expect(bursts).toBeLessThanOrEqual(Math.ceil(1 / RCS.interval) + 1);
    // Release: the change back fires toward the other side at once.
    const back = t.update(0, 0, DT);
    expect(back).not.toBeNull();
    expect(back?.x ?? 0).toBeGreaterThan(0);
    // Steady at zero: no more bursts.
    for (let i = 0; i < 30; i++) expect(t.update(0, 0, DT)).toBeNull();
  });

  it('fires at least once per frame burst even when a frame is longer than the interval (slow hosts)', () => {
    const t = new RcsTrigger();
    for (let i = 0; i < 5; i++) expect(t.update(KEY_CMD, 0, 0.5)).not.toBeNull();
  });

  it('fires the two corner thrusters on the side opposite the lean (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), (a) => {
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        const fire = firingThrusters(dx, dz);
        // Two, or one when a corner lies exactly across the lean.
        if (fire.length < 1 || fire.length > 2) return false;
        return fire.every((i) => {
          const th = THRUSTERS[i];
          return th !== undefined && th.x * dx + th.z * dz < 0;
        });
      }),
      { numRuns: 200 },
    );
    expect(firingThrusters(-1, 0).sort()).toEqual([2, 3]);
    expect(firingThrusters(0, 0)).toEqual([]);
  });
});
