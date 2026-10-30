import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DRY_MASS, DT, EXHAUST_VELOCITY, G_MOON, MAX_THRUST, MAX_TILT, TILT_RATE } from './constants';
import {
  clampThrottle,
  clampTilt,
  createLander,
  footpadPositions,
  fuelSeconds,
  hoverThrottle,
  massOf,
  rotateByTilt,
  stepAttitude,
  stepLander,
  thrustDir,
  type LanderState,
} from './lander';

const OFF = { throttle: 0, tiltX: 0, tiltZ: 0 };

describe('free fall', () => {
  it('matches the analytic solution exactly (constant-acceleration step)', () => {
    let s = createLander({ x: 0, y: 1000, z: 0 }, { x: 3, y: 2, z: -1 }, 500);
    const steps = 600;
    for (let i = 0; i < steps; i++) s = stepLander(s, OFF, DT);
    const t = steps * DT;
    expect(s.pos.y).toBeCloseTo(1000 + 2 * t - 0.5 * G_MOON * t * t, 6);
    expect(s.vel.y).toBeCloseTo(2 - G_MOON * t, 9);
    expect(s.pos.x).toBeCloseTo(3 * t, 9);
    expect(s.pos.z).toBeCloseTo(-t, 9);
    expect(s.fuel).toBe(500);
    expect(s.t).toBeCloseTo(t, 9);
  });

  it('falls the same at any start height and speed (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 10, max: 5000, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.integer({ min: 1, max: 400 }),
        (y0, vy0, steps) => {
          let s = createLander({ x: 0, y: y0, z: 0 }, { x: 0, y: vy0, z: 0 }, 100);
          for (let i = 0; i < steps; i++) s = stepLander(s, OFF, DT);
          const t = steps * DT;
          const want = y0 + vy0 * t - 0.5 * G_MOON * t * t;
          return Math.abs(s.pos.y - want) < 1e-6 * Math.max(1, Math.abs(want));
        },
      ),
    );
  });
});

describe('hover', () => {
  it('thrust equal to weight holds the lander still', () => {
    let s = createLander({ x: 0, y: 500, z: 0 }, { x: 0, y: 0, z: 0 }, 800);
    expect(hoverThrottle(s) * MAX_THRUST).toBeCloseTo(massOf(s) * G_MOON, 6);
    for (let i = 0; i < 600; i++) {
      s = stepLander(s, { throttle: hoverThrottle(s), tiltX: 0, tiltZ: 0 }, DT);
    }
    expect(Math.abs(s.vel.y)).toBeLessThan(1e-3);
    expect(Math.abs(s.pos.y - 500)).toBeLessThan(5e-3);
    expect(s.fuel).toBeLessThan(800);
  });

  it('fuel seconds equal fuel over the hover flow', () => {
    const s = createLander({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 600);
    const flow = ((DRY_MASS + 600) * G_MOON) / EXHAUST_VELOCITY;
    expect(fuelSeconds(s)).toBeCloseTo(600 / flow, 9);
    expect(fuelSeconds({ fuel: 0 })).toBe(0);
  });
});

describe('fuel and mass', () => {
  const command = fc.record({
    throttle: fc.double({ min: -0.5, max: 1.5, noNaN: true }),
    tiltX: fc.double({ min: -1, max: 1, noNaN: true }),
    tiltZ: fc.double({ min: -1, max: 1, noNaN: true }),
  });

  it('fuel never goes negative and mass falls whenever the engine burns (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 60, noNaN: true }), fc.array(command, { minLength: 1, maxLength: 300 }), (fuel0, cmds) => {
        let s: LanderState = createLander({ x: 0, y: 1e5, z: 0 }, { x: 0, y: 0, z: 0 }, fuel0);
        for (const c of cmds) {
          const before = massOf(s);
          const next = stepLander(s, c, DT);
          if (next.fuel < 0) return false;
          if (massOf(next) > before) return false;
          if (next.throttle > 0 && !(next.fuel < s.fuel)) return false;
          s = next;
        }
        return true;
      }),
    );
  });

  it('a full burn gives the rocket-equation delta-v (Tsiolkovsky)', () => {
    const fuel = 900;
    let s = createLander({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, fuel);
    let steps = 0;
    while (s.fuel > 0 && steps < 100_000) {
      s = stepLander(s, { throttle: 1, tiltX: 0, tiltZ: 0 }, DT, 0);
      steps++;
    }
    const want = EXHAUST_VELOCITY * Math.log((DRY_MASS + fuel) / DRY_MASS);
    expect(s.fuel).toBe(0);
    expect(Math.abs(s.vel.y - want) / want).toBeLessThan(1e-3);
    // Burn time is fuel over the full-thrust flow.
    expect(s.t).toBeCloseTo(fuel / (MAX_THRUST / EXHAUST_VELOCITY), 1);
  });

  it('an empty tank gives no thrust', () => {
    const s = createLander({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    const next = stepLander(s, { throttle: 1, tiltX: 0, tiltZ: 0 }, DT);
    expect(next.throttle).toBe(0);
    expect(next.vel.y).toBeCloseTo(-G_MOON * DT, 12);
  });
});

describe('controls', () => {
  it('throttle is off or between 10% and 100%', () => {
    expect(clampThrottle(0)).toBe(0);
    expect(clampThrottle(-1)).toBe(0);
    expect(clampThrottle(Number.NaN)).toBe(0);
    expect(clampThrottle(0.05)).toBe(0.1);
    expect(clampThrottle(0.5)).toBe(0.5);
    expect(clampThrottle(2)).toBe(1);
  });

  it('tilt is limited to 30 degrees and keeps its direction (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: -3, max: 3, noNaN: true }), (x, z) => {
        const t = clampTilt(x, z);
        if (Math.hypot(t.x, t.z) > MAX_TILT + 1e-12) return false;
        return Math.abs(x * t.z - z * t.x) < 1e-9 && x * t.x + z * t.z >= 0;
      }),
    );
  });

  it('attitude moves at most 45 deg/s and settles on the command', () => {
    let a = { x: 0, z: 0 };
    const cmd = { x: MAX_TILT, z: 0 };
    let prev = 0;
    for (let i = 0; i < 180; i++) {
      a = stepAttitude(a, cmd, DT);
      expect(a.x - prev).toBeLessThanOrEqual(TILT_RATE * DT + 1e-12);
      prev = a.x;
    }
    expect(a.x).toBeCloseTo(MAX_TILT, 4);
  });

  it('thrust direction is a unit vector leaning toward the tilt', () => {
    fc.assert(
      fc.property(fc.double({ min: -0.5, max: 0.5, noNaN: true }), fc.double({ min: -0.5, max: 0.5, noNaN: true }), (x, z) => {
        const u = thrustDir(x, z);
        const len = Math.hypot(u.x, u.y, u.z);
        if (Math.abs(len - 1) > 1e-12) return false;
        // Below 1e-6 rad the lander counts as upright.
        if (Math.abs(x) > 1e-6 && Math.sign(u.x) !== Math.sign(x)) return false;
        if (Math.abs(z) > 1e-6 && Math.sign(u.z) !== Math.sign(z)) return false;
        return true;
      }),
    );
  });
});

describe('footpads', () => {
  it('rotating "up" by the tilt gives the thrust direction', () => {
    fc.assert(
      fc.property(fc.double({ min: -0.5, max: 0.5, noNaN: true }), fc.double({ min: -0.5, max: 0.5, noNaN: true }), (x, z) => {
        const r = rotateByTilt({ x: 0, y: 1, z: 0 }, x, z);
        const u = thrustDir(x, z);
        return Math.abs(r.x - u.x) < 1e-12 && Math.abs(r.y - u.y) < 1e-12 && Math.abs(r.z - u.z) < 1e-12;
      }),
    );
  });

  it('rotation keeps lengths', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        (tx, tz, x, y, z) => {
          const r = rotateByTilt({ x, y, z }, tx, tz);
          return Math.abs(Math.hypot(r.x, r.y, r.z) - Math.hypot(x, y, z)) < 1e-9;
        },
      ),
    );
  });

  it('upright footpads sit level below the centre of mass', () => {
    const s = createLander({ x: 10, y: 50, z: -5 }, { x: 0, y: 0, z: 0 }, 100);
    const pads = footpadPositions(s);
    expect(pads).toHaveLength(4);
    for (const p of pads) expect(p.y).toBeCloseTo(48, 12);
  });
});
