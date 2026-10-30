import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../kit/prng';
import { LEG_DROP, LIMITS } from './constants';
import { assistTargetVs, createAssistMemory } from './assist';
import { Flight, IDLE_INPUT, runScript, type FlightEvent, type PilotInput, type ScriptStep } from './flight';
import { predictTouchdown } from './predictor';
import { SITES, startConditions } from './sites';
import { Terrain } from './terrain';

const FLAT = Terrain.flat(64, 60, 0);
const ASSIST: PilotInput = { ...IDLE_INPUT, assist: true };

function touchdowns(events: FlightEvent[]) {
  return events.filter((e): e is Extract<FlightEvent, { type: 'touchdown' }> => e.type === 'touchdown');
}

describe('flight', () => {
  it('detects footpad contact and judges a free fall from 10 m as bumpy', () => {
    const f = new Flight(FLAT, { pos: { x: 0, y: 10 + LEG_DROP, z: 0 }, vel: { x: 0, y: 0, z: 0 }, fuel: 500 });
    expect(f.altitude).toBeCloseTo(10, 9);
    const events = runScript(f, [], 10_000);
    const td = touchdowns(events);
    expect(td).toHaveLength(1);
    expect(f.phase).toBe('landed');
    const r = f.result;
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.touchdown.vs).toBeCloseTo(Math.sqrt(2 * 1.62 * 10), 1);
    expect(r.verdict.outcome).toBe('bumpy');
    expect(r.verdict.reasons).toContain('fast');
    expect(r.stars.stars).toBe(0);
    // Settled on the ground and frozen.
    expect(f.altitude).toBe(0);
    expect(f.state.pos.y).toBeCloseTo(LEG_DROP, 9);
    expect(f.step(ASSIST)).toEqual([]);
  });

  it('hover assist eases the descent rate toward 1.5 m/s at the ground', () => {
    expect(assistTargetVs(0)).toBe(-1.5);
    expect(assistTargetVs(1000)).toBe(-12);
    expect(assistTargetVs(50)).toBeCloseTo(-4.5, 9);
  });

  it('hover assist lands softly from random starts over flat ground (property)', () => {
    fc.assert(
      fc.property(
        fc.record({
          height: fc.double({ min: 350, max: 700, noNaN: true }),
          descent: fc.double({ min: 0, max: 15, noNaN: true }),
          drift: fc.double({ min: 0, max: 8, noNaN: true }),
          dir: fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
          fuel: fc.double({ min: 700, max: 900, noNaN: true }),
        }),
        (p) => {
          const f = new Flight(FLAT, {
            pos: { x: 0, y: p.height + LEG_DROP, z: 0 },
            vel: { x: Math.cos(p.dir) * p.drift, y: -p.descent, z: Math.sin(p.dir) * p.drift },
            fuel: p.fuel,
          });
          runScript(f, [{ tick: 0, input: ASSIST }], 60 * 400);
          const r = f.result;
          if (!r) return false;
          return r.verdict.outcome === 'soft' && r.touchdown.vs < LIMITS.vs && r.touchdown.vs > 0.5;
        },
      ),
      { numRuns: 25 },
    );
  });

  it('raises the 60 s fuel call-out once', () => {
    const f = new Flight(FLAT, { pos: { x: 0, y: 1e5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, fuel: 150 });
    expect(f.fuelSeconds).toBeGreaterThan(60);
    const events = runScript(f, [{ tick: 0, input: { ...IDLE_INPUT, throttle: 0.2 } }], 60 * 30);
    const sixty = events.filter((e) => e.type === 'callout' && e.seconds === 60);
    expect(sixty).toHaveLength(1);
    expect(f.fuelSeconds).toBeLessThanOrEqual(60);
  });

  it('runs out of fuel cleanly: no negative fuel, a single fuel-out event', () => {
    const f = new Flight(FLAT, { pos: { x: 0, y: 1e5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, fuel: 5 });
    const events = runScript(f, [{ tick: 0, input: { ...IDLE_INPUT, throttle: 1 } }], 600);
    expect(events.filter((e) => e.type === 'fuel-out')).toHaveLength(1);
    expect(f.state.fuel).toBe(0);
    expect(f.fuelSeconds).toBe(0);
  });
});

describe('determinism', () => {
  function scripted(seed: number) {
    const rng = createRng(seed);
    const script: ScriptStep[] = [];
    for (let k = 0; k < 40; k++) {
      script.push({
        tick: k * 45,
        input: {
          throttle: rng.float(0, 0.4),
          tiltX: rng.float(-0.3, 0.3),
          tiltZ: rng.float(-0.3, 0.3),
          tiltActive: rng.chance(0.5),
          assist: rng.chance(0.3),
        },
      });
    }
    return script;
  }

  it('the same seed and input script replay identically', () => {
    const terrain = Terrain.fromFunction(64, 60, (x, z) => 20 * Math.sin(x / 400) + 15 * Math.cos(z / 300));
    const site = SITES[2];
    expect(site).toBeDefined();
    if (!site) return;
    const run = () => {
      const start = startConditions(site, createRng(1234), terrain);
      const f = new Flight(terrain, start);
      const events = runScript(f, scripted(99), 60 * 120);
      return { start, events, trace: f.trace, state: f.state, result: f.result };
    };
    const a = run();
    const b = run();
    expect(b).toEqual(a);
    expect(a.trace.length).toBeGreaterThan(10);
  });

  it('different seeds give different starts', () => {
    const site = SITES[0];
    if (!site) throw new Error('no site');
    const a = startConditions(site, createRng(1), FLAT);
    const b = startConditions(site, createRng(2), FLAT);
    expect(a).not.toEqual(b);
  });

  it('start conditions stay inside the site ranges (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: SITES.length - 1 }), fc.integer(), (i, seed) => {
        const site = SITES[i];
        if (!site) return false;
        const s = startConditions(site, createRng(seed), FLAT);
        const dist = Math.hypot(s.pos.x, s.pos.z);
        const drift = Math.hypot(s.vel.x, s.vel.z);
        return (
          dist >= site.offset.min - 1e-9 &&
          dist <= site.offset.max + 1e-9 &&
          s.pos.y >= site.height.min - 1e-9 &&
          s.pos.y <= site.height.max + 1e-9 &&
          drift >= site.drift.min - 1e-9 &&
          drift <= site.drift.max + 1e-9 &&
          s.fuel === site.fuel
        );
      }),
    );
  });
});

describe('predictor', () => {
  const hilly = Terrain.fromFunction(64, 60, (x, z) => 0.04 * x + 12 * Math.sin(z / 300));

  it('agrees with the full sim for constant inputs (property)', () => {
    fc.assert(
      fc.property(
        fc.record({
          height: fc.double({ min: 80, max: 350, noNaN: true }),
          vy: fc.double({ min: -8, max: 0, noNaN: true }),
          vx: fc.double({ min: -3, max: 3, noNaN: true }),
          vz: fc.double({ min: -3, max: 3, noNaN: true }),
          throttle: fc.double({ min: 0.1, max: 0.15, noNaN: true }),
          tiltX: fc.double({ min: -0.1, max: 0.1, noNaN: true }),
          tiltZ: fc.double({ min: -0.1, max: 0.1, noNaN: true }),
        }),
        (p) => {
          const start = {
            pos: { x: 0, y: hilly.heightAt(0, 0) + p.height, z: 0 },
            vel: { x: p.vx, y: p.vy, z: p.vz },
            fuel: 900,
          };
          const input: PilotInput = { throttle: p.throttle, tiltX: p.tiltX, tiltZ: p.tiltZ, tiltActive: true, assist: false };
          const f = new Flight(hilly, start);
          const pred = predictTouchdown(hilly, f.state, input, createAssistMemory(), { horizon: 150 });
          runScript(f, [{ tick: 0, input }], 60 * 160);
          const r = f.result;
          if (!pred || !r) return false;
          return (
            Math.abs(pred.t - r.touchdown.time) < 0.3 &&
            Math.abs(pred.vs - r.touchdown.vs) < 0.2 &&
            Math.abs(pred.x - r.touchdown.x) < 1.5 &&
            Math.abs(pred.z - r.touchdown.z) < 1.5 &&
            pred.outcome === r.verdict.outcome
          );
        },
      ),
      { numRuns: 30 },
    );
  });

  it('returns null when the lander climbs away', () => {
    const f = new Flight(FLAT, { pos: { x: 0, y: 200, z: 0 }, vel: { x: 0, y: 5, z: 0 }, fuel: 900 });
    const p = predictTouchdown(FLAT, f.state, { ...IDLE_INPUT, throttle: 0.5 }, createAssistMemory(), { horizon: 30 });
    expect(p).toBeNull();
  });

  it('keeps the assist working inside the prediction', () => {
    const f = new Flight(FLAT, { pos: { x: 0, y: 300, z: 0 }, vel: { x: 2, y: -5, z: 0 }, fuel: 900 });
    const p = predictTouchdown(FLAT, f.state, ASSIST, f.assistMemory(), { horizon: 200 });
    expect(p).not.toBeNull();
    expect(p?.vs ?? 99).toBeLessThan(LIMITS.vs);
    expect(p?.outcome).toBe('soft');
  });
});
