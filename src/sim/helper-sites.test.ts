/**
 * Fuel budget on the real terrain of every site (public/data/terrain/<slug>.bin), from seeded
 * starts (FIXLIST F-07, F-11 and F2):
 *
 * (a) The hover helper always lands softly with 10 s or more of fuel, but below the fuel star
 *     (left in [10, 25) s), so the star is never free.
 * (b) An efficient pilot (falls fast up high, brakes late and hard, hovers little, tilts only
 *     while the engine pushes) keeps 30 s or more on sites 1-3. Sites 4-6 are printed only.
 * (c) The helper takes over softly from mid-flight states when the fuel left is at least its
 *     estimated need (assistFuelNeed).
 *
 * Every block prints a console.table before it asserts, so the measured numbers show even when a
 * check fails. Use them to re-tune SITES[].fuel.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createRng } from '../kit/prng';
import { assistFuelNeed } from './assist';
import { DEG, G_MOON, MIN_THROTTLE, STAR_FUEL_SECONDS } from './constants';
import { Flight, IDLE_INPUT, flyHelper, type FlightEvent, type PilotInput } from './flight';
import { clamp, clampTilt, fuelSeconds, hoverThrottle, tiltAngle } from './lander';
import { GRID, SITES, startConditions, type SiteInfo } from './sites';
import { Terrain } from './terrain';

/** Seeds per site. Each run is about 5,000 fixed steps. */
const SEEDS = 16;
const MAX_TICKS = 60 * 400;

/** Helper fuel left must be in [HELPER_MIN_LEFT, HELPER_MAX_LEFT) s on every site and seed. */
const HELPER_MIN_LEFT = 10;
const HELPER_MAX_LEFT = 25;

interface FsLike {
  readFileSync(path: URL): Uint8Array;
}

// A non-literal specifier keeps node types out of the browser tsconfig.
const FS_MODULE = 'node:fs';

async function loadTerrain(slug: string): Promise<Terrain> {
  const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FsLike;
  const bytes = fs.readFileSync(new URL(`../../public/data/terrain/${slug}.bin`, import.meta.url));
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return Terrain.fromInt16(buf, GRID.size, GRID.spacing, GRID.unit);
}

const terrains = new Map<string, Terrain>();

beforeAll(async () => {
  for (const site of SITES) terrains.set(site.slug, await loadTerrain(site.slug));
});

function terrainOf(site: SiteInfo): Terrain {
  const t = terrains.get(site.slug);
  if (!t) throw new Error(`no terrain for ${site.slug}`);
  return t;
}

interface RunSummary {
  seed: number;
  soft: boolean;
  reasons: string;
  fuelLeft: number;
  fuelStar: boolean;
  heard60: boolean;
  heard30: boolean;
  fuelOut: boolean;
  time: number;
  distance: number;
}

function summarize(seed: number, f: Flight, events: readonly FlightEvent[]): RunSummary {
  const r = f.result;
  return {
    seed,
    soft: r?.verdict.outcome === 'soft',
    reasons: r ? r.verdict.reasons.join(',') : 'no touchdown',
    fuelLeft: r ? r.touchdown.fuelSeconds : 0,
    fuelStar: r ? r.stars.fuel : false,
    heard60: events.some((e) => e.type === 'callout' && e.seconds === 60),
    heard30: events.some((e) => e.type === 'callout' && e.seconds === 30),
    fuelOut: events.some((e) => e.type === 'fuel-out'),
    time: r ? r.touchdown.time : 0,
    distance: r ? r.distance : 0,
  };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const lo = (xs: readonly number[]): number => round1(Math.min(...xs));
const hi = (xs: readonly number[]): number => round1(Math.max(...xs));

// ---------- (b) The efficient pilot ----------

/** What the HUD shows: height, speeds, tilt and the hover mark on the engine bar. */
interface HudReadout {
  altitude: number;
  vy: number;
  vx: number;
  vz: number;
  tilt: number;
  hoverThrottle: number;
}

function readHud(f: Flight): HudReadout {
  const s = f.state;
  return {
    altitude: f.altitude,
    vy: s.vel.y,
    vx: s.vel.x,
    vz: s.vel.z,
    tilt: tiltAngle(s),
    hoverThrottle: hoverThrottle(s),
  };
}

/**
 * A careful but thrifty pilot, the kind of flying the fuel star asks for:
 * - engine off until the fall reaches 20 m/s, then hold 20 m/s (fall faster up high);
 * - brake on a constant-deceleration curve that uses 60% of the spare thrust (a 40% safety
 *   margin), so it reaches 1.6 m/s at 6 m (brake later and harder);
 * - below 6 m, ease from 1.6 to 1.0 m/s (little hovering);
 * - lean against the drift only while the engine pushes, up to 12 deg, 7 deg below 20 m
 *   (no wasted tilt, level at touchdown).
 */
const PILOT = {
  maxFall: 20,
  brakeShare: 0.6,
  gate: 6,
  gateVs: 1.6,
  kp: 2,
  kv: 0.25,
  maxTilt: 12 * DEG,
  levelHeight: 20,
  levelTilt: 7 * DEG,
} as const;

function efficientPilot(hud: HudReadout, g = G_MOON): PilotInput {
  const h = Math.max(0, hud.altitude);
  const down = -hud.vy;
  // Full thrust gives g / hover throttle when upright.
  const aMax = g / Math.max(1e-3, hud.hoverThrottle);
  const aPlan = PILOT.brakeShare * (aMax - g);
  let ref: number;
  let feedForward = 0;
  if (h <= PILOT.gate) {
    ref = 1 + ((PILOT.gateVs - 1) * h) / PILOT.gate;
  } else {
    const brake = Math.sqrt(PILOT.gateVs * PILOT.gateVs + 2 * aPlan * (h - PILOT.gate));
    if (brake < PILOT.maxFall) {
      ref = brake;
      // The curve slows by aPlan * down / ref per second: brake that hard in advance.
      feedForward = Math.min(2 * aPlan, (aPlan * Math.max(0, down)) / brake);
    } else {
      ref = PILOT.maxFall;
    }
  }
  const up = g + feedForward + PILOT.kp * (down - ref);
  const raw = up / aMax / Math.max(0.5, Math.cos(hud.tilt));
  const throttle = raw < MIN_THROTTLE / 2 ? 0 : clamp(raw, MIN_THROTTLE, 1);
  // Near the ground, lean less so the lander stands level at touchdown.
  const maxLean = h < PILOT.levelHeight ? PILOT.levelTilt : PILOT.maxTilt;
  const lean = throttle > 0 ? clampTilt(-PILOT.kv * hud.vx, -PILOT.kv * hud.vz, maxLean) : { x: 0, z: 0 };
  return { throttle, tiltX: lean.x, tiltZ: lean.z, tiltActive: true, assist: false };
}

/** A pilot who stops the fall early and creeps down at about 2 m/s (burns fuel up high). */
function hoverPilot(hud: HudReadout, g = G_MOON): PilotInput {
  const aMax = g / Math.max(1e-3, hud.hoverThrottle);
  const up = g + 1.5 * (-hud.vy - 2);
  const throttle = clamp(up / aMax / Math.max(0.5, Math.cos(hud.tilt)), MIN_THROTTLE, 1);
  const lean = clampTilt(-0.25 * hud.vx, -0.25 * hud.vz, 12 * DEG);
  return { throttle, tiltX: lean.x, tiltZ: lean.z, tiltActive: true, assist: false };
}

/** A pilot who leaves the engine off. */
function fallPilot(): PilotInput {
  return { ...IDLE_INPUT };
}

type Pilot = (hud: HudReadout) => PilotInput;

function flyManual(f: Flight, pilot: Pilot, untilT = Infinity): FlightEvent[] {
  const events: FlightEvent[] = [];
  while (f.phase === 'flying' && f.tick < MAX_TICKS && f.state.t < untilT) events.push(...f.step(pilot(readHud(f))));
  return events;
}

// ---------- Tests ----------

describe('fuel budget on the real terrain of every site', () => {
  it(`(a) the helper lands softly on every site with ${HELPER_MIN_LEFT}-${HELPER_MAX_LEFT} s left: no free fuel star`, () => {
    const all = SITES.map((site) => {
      const terrain = terrainOf(site);
      const runs: RunSummary[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { flight, events } = flyHelper(terrain, startConditions(site, createRng(seed), terrain), MAX_TICKS);
        runs.push(summarize(seed, flight, events));
      }
      return { site, runs, startSeconds: fuelSeconds({ fuel: site.fuel }) };
    });
    console.table(
      all.map(({ site, runs, startSeconds }) => {
        const left = runs.map((r) => r.fuelLeft);
        return {
          site: site.slug,
          'start fuel (kg)': site.fuel,
          'start (s)': round1(startSeconds),
          'helper left min (s)': lo(left),
          'helper left max (s)': hi(left),
          'used max (s)': round1(startSeconds - Math.min(...left)),
          soft: `${runs.filter((r) => r.soft).length}/${runs.length}`,
          'fuel star': runs.filter((r) => r.fuelStar).length,
          '60 s call': runs.filter((r) => r.heard60).length,
          '30 s call': runs.filter((r) => r.heard30).length,
          'time (s)': `${lo(runs.map((r) => r.time))}-${hi(runs.map((r) => r.time))}`,
        };
      }),
    );
    for (const { site, runs } of all) {
      for (const r of runs) {
        const tag = `${site.slug} seed ${r.seed}`;
        expect.soft(r.soft, `${tag}: ${r.reasons} at ${r.distance.toFixed(0)} m`).toBe(true);
        expect.soft(r.fuelLeft, `${tag}: helper fuel left`).toBeGreaterThanOrEqual(HELPER_MIN_LEFT);
        expect.soft(r.fuelLeft, `${tag}: helper fuel left`).toBeLessThan(HELPER_MAX_LEFT);
        expect.soft(r.fuelStar, `${tag}: no free fuel star`).toBe(false);
        expect.soft(r.fuelOut, `${tag}: the helper never runs dry`).toBe(false);
      }
      // The fuel call-outs are part of a normal helper landing now.
      const heard = runs.filter((r) => r.heard60).length;
      expect.soft(heard, `${site.slug}: runs that heard the 60 s call-out`).toBeGreaterThanOrEqual(Math.ceil(runs.length * 0.75));
    }
  }, 120_000);

  it(`(b) an efficient pilot keeps ${STAR_FUEL_SECONDS} s or more on sites 1-3 (sites 4-6 printed)`, () => {
    const all = SITES.map((site) => {
      const terrain = terrainOf(site);
      const runs: RunSummary[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const f = new Flight(terrain, startConditions(site, createRng(seed), terrain));
        runs.push(summarize(seed, f, flyManual(f, efficientPilot)));
      }
      return { site, runs };
    });
    console.table(
      all.map(({ site, runs }) => {
        const left = runs.map((r) => r.fuelLeft);
        return {
          site: site.slug,
          'start fuel (kg)': site.fuel,
          'pilot left min (s)': lo(left),
          'pilot left max (s)': hi(left),
          soft: `${runs.filter((r) => r.soft).length}/${runs.length}`,
          'fuel star': `${runs.filter((r) => r.fuelStar).length}/${runs.length}`,
          bumps: runs
            .filter((r) => !r.soft)
            .map((r) => `${r.seed}:${r.reasons}`)
            .join(' '),
          'time (s)': `${lo(runs.map((r) => r.time))}-${hi(runs.map((r) => r.time))}`,
        };
      }),
    );
    all.forEach(({ site, runs }, index) => {
      if (index >= 3) return;
      for (const r of runs) {
        const tag = `${site.slug} seed ${r.seed}`;
        expect.soft(r.soft, `${tag}: ${r.reasons} at ${r.distance.toFixed(0)} m`).toBe(true);
        expect.soft(r.fuelLeft, `${tag}: efficient pilot fuel left`).toBeGreaterThanOrEqual(STAR_FUEL_SECONDS);
      }
    });
  }, 120_000);

  it('(c) the helper takes over softly mid-flight when the fuel left covers its need', () => {
    const styles: { name: string; pilot: Pilot; until: number }[] = [
      { name: 'efficient 4 s', pilot: efficientPilot, until: 4 },
      { name: 'efficient 12 s', pilot: efficientPilot, until: 12 },
      { name: 'efficient 20 s', pilot: efficientPilot, until: 20 },
      { name: 'hover 10 s', pilot: hoverPilot, until: 10 },
      { name: 'hover 25 s', pilot: hoverPilot, until: 25 },
      { name: 'engine off 8 s', pilot: fallPilot, until: 8 },
    ];
    interface Case {
      tag: string;
      height: number;
      fuelSeconds: number;
      need: number;
      covered: boolean;
      soft: boolean;
      reasons: string;
      fuelOut: boolean;
      left: number;
    }
    const cases: Case[] = [];
    for (const site of SITES.slice(0, 3)) {
      const terrain = terrainOf(site);
      for (let seed = 1; seed <= 4; seed++) {
        for (const style of styles) {
          const f = new Flight(terrain, startConditions(site, createRng(seed), terrain));
          flyManual(f, style.pilot, style.until);
          if (f.phase !== 'flying') continue;
          const s = f.state;
          const need = assistFuelNeed(f.altitude, s.vel.y, Math.hypot(s.vel.x, s.vel.z), hoverThrottle(s));
          const { flight, events } = flyHelper(terrain, s, MAX_TICKS);
          const r = flight.result;
          cases.push({
            tag: `${site.slug} seed ${seed} ${style.name}`,
            height: f.altitude,
            fuelSeconds: f.fuelSeconds,
            need,
            covered: f.fuelSeconds >= need,
            soft: r?.verdict.outcome === 'soft',
            reasons: r ? r.verdict.reasons.join(',') : 'no touchdown',
            fuelOut: events.some((e) => e.type === 'fuel-out'),
            left: r ? r.touchdown.fuelSeconds : 0,
          });
        }
      }
    }
    console.table(
      cases.map((c) => ({
        case: c.tag,
        'height (m)': Math.round(c.height),
        'fuel (s)': round1(c.fuelSeconds),
        'need (s)': Number.isFinite(c.need) ? round1(c.need) : 'too fast',
        'helper used (s)': round1(c.fuelSeconds - c.left),
        covered: c.covered,
        soft: c.soft,
        'left (s)': round1(c.left),
      })),
    );
    const covered = cases.filter((c) => c.covered);
    // The check is not empty: many mid-flight states have enough fuel for the helper.
    expect(covered.length, 'mid-flight states with enough fuel for the helper').toBeGreaterThanOrEqual(8);
    for (const c of covered) {
      expect.soft(c.soft, `${c.tag}: ${c.reasons}`).toBe(true);
      expect.soft(c.fuelOut, `${c.tag}: the helper ran dry`).toBe(false);
    }
  }, 120_000);
});
