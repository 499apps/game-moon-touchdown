/**
 * Fuel budget and fairness on the real terrain of every site (public/data/terrain/<slug>.bin),
 * from seeded starts (FIXLIST F-07, F-11, F2 and F3):
 *
 * (a) The hover helper always lands softly with 10 s or more of fuel, but below the fuel star
 *     (left in [10, 25) s), so the star is never free.
 * (b) An efficient pilot that flies by the HUD (never in the red speed band: falls fast in the
 *     yellow up high, brakes late and hard, hovers little, tilts only while the engine pushes)
 *     keeps 30 s or more on sites 1-3. Sites 4-6 are printed only.
 * (c) The helper takes over softly mid-flight when the fuel left is at least its estimated need
 *     (assistFuelNeed).
 * (c2) The low-fuel prompt keeps its promise: on every site, a child who taps Help at the moment
 *      the prompt says "help" lands softly and the helper never runs dry.
 * (d) Three stars are possible on every site: a "ring + thrifty" pilot (leans toward the ring, at
 *     most 12 deg, flies by the HUD bands) gets 3 stars on at least 1 seed per site, with a median
 *     fuel left of 33 s or more on sites 1-3.
 * (e) Game feel proxy: a noisy, slow-to-react novice (0.4 s delay, +-15% lever noise) who takes
 *     over from Help at 150 m lands softly in 80% or more of 20 seeds on every site.
 * (f) Real-input novices (R3 finding 2): a bang-bang W/S pilot through ControlShaper (the real
 *     key lever rate and first-press step) and a slider pilot with relative 10% steps, 0.4 s
 *     reaction, take over from Help at 300 m and at 150 m: 80% or more soft on every site. They
 *     tap Help when the game shows "Low fuel: tap Help"; the table shows how many landed by hand.
 *
 * Every block prints a console.table before it asserts, so the measured numbers show even when a
 * check fails. Use them to re-tune SITES[].fuel.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createRng } from '../kit/prng';
import { VS_STRICT_HEIGHT, vsBand, vsEnvelope, vsLimits, type VsMode } from '../hud';
import {
  ControlShaper,
  emptyIntent,
  leverToThrottle,
  mapKeyboard,
  throttleToLever,
  type Intent,
} from '../input/mapping';
import { assistFuelNeed, lowFuelPrompt, type LowFuelPrompt } from './assist';
import { DEG, DT, G_MOON, MIN_THROTTLE, STAR_FUEL_SECONDS } from './constants';
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
  stars: number;
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
    stars: r ? r.stars.stars : 0,
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
function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

// ---------- Pilots ----------

/**
 * What the pilot sees: the HUD (height, speeds, tilt, fuel, the hover mark on the engine bar) and,
 * for steering, where the ring is (on screen, or the edge arrow).
 */
interface HudReadout {
  altitude: number;
  vy: number;
  vx: number;
  vz: number;
  tilt: number;
  hoverThrottle: number;
  fuelSeconds: number;
  x: number;
  z: number;
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
    fuelSeconds: f.fuelSeconds,
    x: s.pos.x,
    z: s.pos.z,
  };
}

/** The HUD bands of a manual flight. */
const manualMode = (hud: HudReadout): VsMode => ({ assist: false, hoverThrottle: hud.hoverThrottle });

/** The speed band the HUD shows now (climbing is always green). */
function hudBand(hud: HudReadout): 'good' | 'warn' | 'bad' {
  if (hud.vy > 0.05) return 'good';
  return vsBand(Math.max(0, -hud.vy), Math.max(0, hud.altitude), manualMode(hud));
}

/**
 * A careful but thrifty pilot who flies by the HUD, the kind of flying the fuel star asks for:
 * - engine off until the fall reaches 20 m/s, then hold it (yellow up high: fast but stoppable);
 * - brake on a constant-deceleration curve that uses 60% of the spare thrust, so it reaches 3 m/s
 *   at 10 m (the strict band: yellow under 4) - later and harder than the helper;
 * - always at least 1 m/s below the red line of the HUD;
 * - below 10 m, ease from 3 to 1.1 m/s (little hovering);
 * - lean against the drift only while the engine pushes, up to 12 deg, 7 deg below 20 m.
 */
const PILOT = {
  maxFall: 20,
  brakeShare: 0.6,
  gate: VS_STRICT_HEIGHT,
  gateVs: 3,
  touchVs: 1.1,
  redMargin: 1,
  kp: 2,
  kv: 0.25,
  maxTilt: 12 * DEG,
  levelHeight: 20,
  levelTilt: 7 * DEG,
} as const;

/** Throttle for a wanted speed down, with a feed-forward for the planned braking. */
function verticalThrottle(hud: HudReadout, maxFall: number, g = G_MOON): number {
  const h = Math.max(0, hud.altitude);
  const down = -hud.vy;
  // Full thrust gives g / hover throttle when upright.
  const aMax = g / Math.max(1e-3, hud.hoverThrottle);
  const aPlan = PILOT.brakeShare * (aMax - g);
  let ref: number;
  let feedForward = 0;
  if (h <= PILOT.gate) {
    ref = PILOT.touchVs + ((PILOT.gateVs - PILOT.touchVs) * h) / PILOT.gate;
  } else {
    const brake = Math.sqrt(PILOT.gateVs * PILOT.gateVs + 2 * aPlan * (h - PILOT.gate));
    if (brake < maxFall) {
      ref = brake;
      // The curve slows by aPlan * down / ref per second: brake that hard in advance.
      feedForward = Math.min(2 * aPlan, (aPlan * Math.max(0, down)) / brake);
    } else {
      ref = maxFall;
    }
  }
  // Fly by the HUD: never closer than redMargin to the red band.
  ref = Math.min(ref, vsLimits(h, manualMode(hud)).yellow - PILOT.redMargin);
  const up = g + feedForward + PILOT.kp * (down - ref);
  const raw = up / aMax / Math.max(0.5, Math.cos(hud.tilt));
  return raw < MIN_THROTTLE / 2 ? 0 : clamp(raw, MIN_THROTTLE, 1);
}

function efficientPilot(hud: HudReadout): PilotInput {
  const throttle = verticalThrottle(hud, PILOT.maxFall);
  // Near the ground, lean less so the lander stands level at touchdown.
  const maxLean = hud.altitude < PILOT.levelHeight ? PILOT.levelTilt : PILOT.maxTilt;
  const lean = throttle > 0 ? clampTilt(-PILOT.kv * hud.vx, -PILOT.kv * hud.vz, maxLean) : { x: 0, z: 0 };
  return { throttle, tiltX: lean.x, tiltZ: lean.z, tiltActive: true, assist: false };
}

/**
 * Ring + thrifty pilot (F3, finding 7): the efficient pilot's vertical flying, plus steering to
 * the ring centre on a stopping curve (only while the engine pushes, at most 12 deg). While high,
 * it plans its fall speed: as fast as it can (up to 20 m/s) while there is still time to reach the
 * ring, but never so slow that the fuel star is lost (a reserve of 34 s).
 */
const RING = {
  cruise: 7,
  accel: 0.3,
  /** Seconds kept to stop the sideways speed before the last metres. */
  arrive: 6,
  /** Fuel (s) the plan keeps for the star, with a little margin. */
  reserve: 34,
  minFall: 8,
  planAbove: 80,
  kv: 0.25,
} as const;

/** Seconds of the last 10 m (from 3 m/s down to 1.1 m/s). */
const GATE_TIME = Math.log(PILOT.gateVs / PILOT.touchVs) / ((PILOT.gateVs - PILOT.touchVs) / PILOT.gate);

/** Seconds to touchdown when the pilot holds `fall` m/s, then brakes on its curve (aPlan). */
function timeToLand(h: number, fall: number, aPlan: number): number {
  const brakeAt = PILOT.gate + (fall * fall - PILOT.gateVs * PILOT.gateVs) / (2 * aPlan);
  return Math.max(0, h - brakeAt) / fall + Math.max(0, fall - PILOT.gateVs) / aPlan + GATE_TIME;
}

/** The fall speed in [minV, maxV] where a decreasing f(v) crosses `want` (bisection). */
function solveFall(f: (v: number) => number, want: number, minV: number, maxV: number): number {
  if (f(maxV) >= want) return maxV;
  if (f(minV) <= want) return minV;
  let a = minV;
  let b = maxV;
  for (let i = 0; i < 24; i++) {
    const m = (a + b) / 2;
    if (f(m) >= want) a = m;
    else b = m;
  }
  return a;
}

function makeRingPilot(): (hud: HudReadout) => PilotInput {
  let fall: number = PILOT.maxFall;
  return (hud) => {
    const h = Math.max(0, hud.altitude);
    const down = -hud.vy;
    const d = Math.hypot(hud.x, hud.z);
    if (h > RING.planAbove) {
      const aMax = G_MOON / Math.max(1e-3, hud.hoverThrottle);
      const aPlan = PILOT.brakeShare * (aMax - G_MOON);
      const time = (v: number) => timeToLand(h, v, aPlan);
      // Time needed to reach the ring: cruise to it, plus the speed-up, plus stopping before the end.
      const toward = d > 1e-6 ? -(hud.x * hud.vx + hud.z * hud.vz) / d : 0;
      const gap = Math.max(0, RING.cruise - toward);
      const tReach = Math.max(0, d - 25) / RING.cruise + (gap * gap) / (2 * RING.accel * RING.cruise) + RING.arrive;
      // The fastest fall that still leaves time to reach the ring...
      const vReach = solveFall(time, tReach, RING.minFall, PILOT.maxFall);
      // ...but never so slow that the flight burns into the fuel-star reserve.
      const budget = hud.fuelSeconds - RING.reserve - Math.max(0, down - 1) / G_MOON - 1;
      const vFuel = time(RING.minFall) <= budget ? RING.minFall : solveFall(time, budget, RING.minFall, PILOT.maxFall);
      fall = clamp(Math.max(vFuel, vReach), RING.minFall, PILOT.maxFall);
    }
    const throttle = verticalThrottle(hud, fall);
    // Wanted sideways velocity: toward the ring centre, slower as it gets close and near the ground.
    let wx = 0;
    let wz = 0;
    if (d > 1) {
      let mag = Math.min(RING.cruise, 0.7 * Math.sqrt(2 * RING.accel * Math.max(0, d - 3)));
      if (h < 30) mag = Math.min(mag, 0.05 * h);
      wx = (-hud.x / d) * mag;
      wz = (-hud.z / d) * mag;
    }
    const maxLean = h < PILOT.levelHeight ? PILOT.levelTilt : PILOT.maxTilt;
    const lean =
      throttle > 0 ? clampTilt(RING.kv * (wx - hud.vx), RING.kv * (wz - hud.vz), maxLean) : { x: 0, z: 0 };
    return { throttle, tiltX: lean.x, tiltZ: lean.z, tiltActive: true, assist: false };
  };
}

/** A pilot who stops the fall early and creeps down at a slow speed (burns fuel up high). */
function creepPilot(speed: number): (hud: HudReadout) => PilotInput {
  return (hud) => {
    const aMax = G_MOON / Math.max(1e-3, hud.hoverThrottle);
    const up = G_MOON + 1.5 * (-hud.vy - speed);
    const throttle = clamp(up / aMax / Math.max(0.5, Math.cos(hud.tilt)), MIN_THROTTLE, 1);
    const lean = clampTilt(-0.25 * hud.vx, -0.25 * hud.vz, 12 * DEG);
    return { throttle, tiltX: lean.x, tiltZ: lean.z, tiltActive: true, assist: false };
  };
}

const hoverPilot = creepPilot(2);

/** A pilot who leaves the engine off. */
function fallPilot(): PilotInput {
  return { ...IDLE_INPUT };
}

type Pilot = (hud: HudReadout) => PilotInput;

interface ManualRun {
  events: FlightEvent[];
  /** Steps flown with the speed gauge in the red band. */
  redSteps: number;
}

function flyManual(f: Flight, pilot: Pilot, untilT = Infinity): ManualRun {
  const events: FlightEvent[] = [];
  let redSteps = 0;
  while (f.phase === 'flying' && f.tick < MAX_TICKS && f.state.t < untilT) {
    const hud = readHud(f);
    if (hudBand(hud) === 'bad') redSteps++;
    events.push(...f.step(pilot(hud)));
  }
  return { events, redSteps };
}

/** The helper's need and the prompt the game shows now (manual flight). */
function promptNow(f: Flight): { need: number; prompt: LowFuelPrompt } {
  const s = f.state;
  const need = assistFuelNeed(f.altitude, s.vel.y, f.horizontalSpeed, hoverThrottle(s));
  return { need, prompt: lowFuelPrompt(f.fuelSeconds, need) };
}

/**
 * A novice: reads the HUD 0.4 s late, aims the speed mark at the middle of the green band, moves
 * the lever with +-15% noise (a new wobble every 0.5 s) and leans against the drift. Levels the
 * lander below 5 m.
 */
const NOVICE = {
  takeover: 150,
  delay: 0.4,
  noise: 0.15,
  noiseEvery: 0.5,
  touchVs: 1.2,
  kp: 0.8,
  kv: 0.2,
  maxTilt: 10 * DEG,
  levelHeight: 5,
  seeds: 20,
  passShare: 0.8,
} as const;

function flyNovice(terrain: Terrain, site: SiteInfo, seed: number): { run: RunSummary; takeoverFuel: number } {
  const f = new Flight(terrain, startConditions(site, createRng(seed), terrain));
  const events: FlightEvent[] = [];
  const help: PilotInput = { ...IDLE_INPUT, assist: true };
  while (f.phase === 'flying' && f.tick < MAX_TICKS && f.altitude >= NOVICE.takeover) events.push(...f.step(help));
  const takeoverFuel = f.fuelSeconds;
  const rng = createRng(seed * 7919 + 17);
  const lag = Math.round(NOVICE.delay / DT);
  const seen: HudReadout[] = [];
  let wobble = 0;
  let wobbleClock = 0;
  while (f.phase === 'flying' && f.tick < MAX_TICKS) {
    seen.push(readHud(f));
    if (seen.length > lag + 1) seen.shift();
    const hud = seen[0] as HudReadout;
    if (wobbleClock <= 0) {
      wobble = rng.float(-NOVICE.noise, NOVICE.noise);
      wobbleClock = NOVICE.noiseEvery;
    }
    wobbleClock -= DT;
    const h = Math.max(0, hud.altitude);
    const down = -hud.vy;
    const target = h < VS_STRICT_HEIGHT ? NOVICE.touchVs : vsEnvelope(h);
    const aMax = G_MOON / Math.max(1e-3, hud.hoverThrottle);
    const want = clamp((G_MOON + NOVICE.kp * (down - target)) / aMax / Math.max(0.5, Math.cos(hud.tilt)), MIN_THROTTLE, 1);
    const throttle = leverToThrottle(throttleToLever(want) * (1 + wobble));
    const maxLean = h < NOVICE.levelHeight ? 0 : NOVICE.maxTilt;
    const lean = clampTilt(-NOVICE.kv * hud.vx, -NOVICE.kv * hud.vz, maxLean);
    events.push(...f.step({ throttle, tiltX: lean.x, tiltZ: lean.z, tiltActive: true, assist: false }));
  }
  return { run: summarize(seed, f, events), takeoverFuel };
}

/**
 * Real-input novices (R3 finding 2): the same path as the game (src/main.ts). Help flies down to
 * the takeover height and hands the engine over at its own throttle (setAssist: no jump). Then the
 * child reads the HUD 0.4 s late and moves only the engine (no steering):
 * - keys: holds W while the speed mark is past the green band (too fast), until the mark crosses
 *   the middle of the green band; holds S while the lander climbs, until the mark is back at the
 *   middle. The keys go through mapKeyboard and ControlShaper.update, so the first-press step and
 *   KEY_LEVER_RATE are the real ones;
 * - slider: the same rule, one relative drag of 10% lever per look (every 0.4 s);
 * - both tap Help when the game shows "Low fuel: tap Help" (the real prompt), and Help lands.
 */
const REAL = {
  reaction: 0.4,
  takeovers: [300, 150],
  sliderStep: 0.1,
  seeds: 12,
  passShare: 0.8,
} as const;

type RealKind = 'keys' | 'slider';

interface RealRun {
  run: RunSummary;
  takeover: number;
  takeoverFuel: number;
  /** The child tapped Help at the low-fuel prompt (Help flew the rest). */
  tookHelp: boolean;
  /** New key presses or slider drags. */
  actions: number;
}

function flyRealNovice(terrain: Terrain, site: SiteInfo, seed: number, kind: RealKind, takeover: number): RealRun {
  const f = new Flight(terrain, startConditions(site, createRng(seed), terrain));
  const events: FlightEvent[] = [];
  const help: PilotInput = { ...IDLE_INPUT, assist: true };
  while (f.phase === 'flying' && f.tick < MAX_TICKS && f.altitude >= takeover) events.push(...f.step(help));
  const takeoverFuel = f.fuelSeconds;
  const shaper = new ControlShaper();
  shaper.setLever(throttleToLever(f.state.throttle));
  const lag = Math.round(REAL.reaction / DT);
  const seen: { hud: HudReadout; prompt: LowFuelPrompt }[] = [];
  /** +1 = slow the fall (W, slide up), -1 = fall faster (S, slide down), 0 = hands off. */
  let dir = 0;
  let look = 0;
  let actions = 0;
  let tookHelp = false;
  while (f.phase === 'flying' && f.tick < MAX_TICKS) {
    seen.push({ hud: readHud(f), prompt: promptNow(f).prompt });
    if (seen.length > lag + 1) seen.shift();
    const view = seen[0] as { hud: HudReadout; prompt: LowFuelPrompt };
    if (view.prompt === 'help') {
      tookHelp = true;
      break;
    }
    const hud = view.hud;
    const h = Math.max(0, hud.altitude);
    const down = -hud.vy;
    const lim = vsLimits(h, manualMode(hud));
    const mid = lim.green / 2;
    const climbing = hud.vy > 0.05;
    if (dir > 0 && down <= mid) dir = 0;
    if (dir < 0 && down >= mid) dir = 0;
    if (dir === 0) {
      if (down >= lim.green) dir = 1;
      else if (climbing) dir = -1;
      if (dir !== 0 && kind === 'keys') actions++;
    }
    let intent: Intent;
    if (kind === 'keys') {
      intent = mapKeyboard(new Set(dir > 0 ? ['KeyW'] : dir < 0 ? ['KeyS'] : []));
    } else {
      intent = emptyIntent();
      look -= DT;
      if (dir !== 0 && look <= 0) {
        intent.lever = clamp(shaper.leverPosition + REAL.sliderStep * dir, 0, 1);
        look = REAL.reaction;
        actions++;
      }
    }
    const c = shaper.update(intent, DT);
    events.push(...f.step({ throttle: c.throttle, tiltX: c.tiltX, tiltZ: c.tiltZ, tiltActive: c.tiltActive, assist: false }));
  }
  // Help after the prompt: the same flight, Help on (a fresh engagement, as in the game).
  while (tookHelp && f.phase === 'flying' && f.tick < MAX_TICKS) events.push(...f.step(help));
  return { run: summarize(seed, f, events), takeover, takeoverFuel, tookHelp, actions };
}

function realNoviceTable(kind: RealKind): { site: SiteInfo; takeover: number; runs: RealRun[] }[] {
  const out: { site: SiteInfo; takeover: number; runs: RealRun[] }[] = [];
  for (const site of SITES) {
    const terrain = terrainOf(site);
    for (const takeover of REAL.takeovers) {
      const runs: RealRun[] = [];
      for (let seed = 1; seed <= REAL.seeds; seed++) runs.push(flyRealNovice(terrain, site, seed, kind, takeover));
      out.push({ site, takeover, runs });
    }
  }
  console.table(
    out.map(({ site, takeover, runs }) => {
      const soft = runs.filter((r) => r.run.soft).length;
      return {
        pilot: kind,
        site: site.slug,
        'takeover (m)': takeover,
        soft: `${soft}/${runs.length}`,
        'by hand': runs.filter((r) => r.run.soft && !r.tookHelp).length,
        'Help at prompt': runs.filter((r) => r.tookHelp).length,
        'ran dry': runs.filter((r) => r.run.fuelOut).length,
        'fuel at takeover min (s)': lo(runs.map((r) => r.takeoverFuel)),
        'left median (s)': round1(median(runs.map((r) => r.run.fuelLeft))),
        'actions median': median(runs.map((r) => r.actions)),
        bumps: runs
          .filter((r) => !r.run.soft)
          .map((r) => `${r.run.seed}:${r.run.reasons}`)
          .join(' '),
      };
    }),
  );
  return out;
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

  it(`(b) an efficient pilot flies by the HUD (never red) and keeps ${STAR_FUEL_SECONDS} s or more on sites 1-3`, () => {
    const all = SITES.map((site) => {
      const terrain = terrainOf(site);
      const runs: (RunSummary & { redSteps: number })[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const f = new Flight(terrain, startConditions(site, createRng(seed), terrain));
        const m = flyManual(f, efficientPilot);
        runs.push({ ...summarize(seed, f, m.events), redSteps: m.redSteps });
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
          'pilot left median (s)': round1(median(left)),
          'pilot left max (s)': hi(left),
          soft: `${runs.filter((r) => r.soft).length}/${runs.length}`,
          'fuel star': `${runs.filter((r) => r.fuelStar).length}/${runs.length}`,
          'red steps (max)': Math.max(...runs.map((r) => r.redSteps)),
          bumps: runs
            .filter((r) => !r.soft)
            .map((r) => `${r.seed}:${r.reasons}`)
            .join(' '),
          'time (s)': `${lo(runs.map((r) => r.time))}-${hi(runs.map((r) => r.time))}`,
        };
      }),
    );
    all.forEach(({ site, runs }, index) => {
      for (const r of runs) {
        const tag = `${site.slug} seed ${r.seed}`;
        // Every site: the fuel-star technique never shows red on the speed gauge.
        expect.soft(r.redSteps, `${tag}: steps in the red speed band`).toBe(0);
        if (index >= 3) continue;
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

  it('(c2) Help tapped when the low-fuel prompt says "help" lands softly on every site', () => {
    // Pilots that burn fuel up high, so the prompt comes while they still fly.
    const styles: { name: string; pilot: Pilot }[] = [
      { name: 'creep 2 m/s', pilot: creepPilot(2) },
      { name: 'creep 4 m/s', pilot: creepPilot(4) },
      { name: 'creep 6 m/s', pilot: creepPilot(6) },
    ];
    interface PromptCase {
      tag: string;
      prompt: LowFuelPrompt | 'landed';
      height: number;
      down: number;
      fuelSeconds: number;
      need: number;
      soft: boolean;
      reasons: string;
      fuelOut: boolean;
      left: number;
    }
    const cases: PromptCase[] = [];
    for (const site of SITES) {
      const terrain = terrainOf(site);
      for (let seed = 1; seed <= 4; seed++) {
        for (const style of styles) {
          const f = new Flight(terrain, startConditions(site, createRng(seed), terrain));
          let now = promptNow(f);
          while (f.phase === 'flying' && f.tick < MAX_TICKS && now.prompt === null) {
            f.step(style.pilot(readHud(f)));
            if (f.phase === 'flying') now = promptNow(f);
          }
          const base = {
            tag: `${site.slug} seed ${seed} ${style.name}`,
            height: f.altitude,
            down: -f.state.vel.y,
            fuelSeconds: f.fuelSeconds,
            need: now.need,
          };
          if (f.phase !== 'flying' || now.prompt !== 'help') {
            cases.push({ ...base, prompt: f.phase !== 'flying' ? 'landed' : now.prompt, soft: false, reasons: '', fuelOut: false, left: 0 });
            continue;
          }
          // The child taps Help right now.
          const { flight, events } = flyHelper(terrain, f.state, MAX_TICKS);
          const r = flight.result;
          cases.push({
            ...base,
            prompt: 'help',
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
        'first prompt': c.prompt ?? 'none',
        'height (m)': Math.round(c.height),
        'down (m/s)': round1(c.down),
        'fuel (s)': round1(c.fuelSeconds),
        'need (s)': Number.isFinite(c.need) ? round1(c.need) : 'too fast',
        soft: c.prompt === 'help' ? c.soft : '-',
        'left (s)': c.prompt === 'help' ? round1(c.left) : '-',
      })),
    );
    const helped = cases.filter((c) => c.prompt === 'help');
    // Every site gives some prompt-moment takeovers to check.
    for (const site of SITES) {
      const n = helped.filter((c) => c.tag.startsWith(`${site.slug} `)).length;
      expect.soft(n, `${site.slug}: takeovers at the "help" prompt`).toBeGreaterThanOrEqual(2);
    }
    for (const c of helped) {
      expect.soft(c.soft, `${c.tag}: ${c.reasons}`).toBe(true);
      expect.soft(c.fuelOut, `${c.tag}: the helper ran dry after the prompt`).toBe(false);
    }
  }, 120_000);

  it('(d) a ring + thrifty pilot gets 3 stars on every site (median fuel 33 s or more on sites 1-3)', () => {
    const all = SITES.map((site) => {
      const terrain = terrainOf(site);
      const runs: (RunSummary & { redSteps: number })[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const f = new Flight(terrain, startConditions(site, createRng(seed), terrain));
        const m = flyManual(f, makeRingPilot());
        runs.push({ ...summarize(seed, f, m.events), redSteps: m.redSteps });
      }
      return { site, runs };
    });
    console.table(
      all.map(({ site, runs }) => {
        const left = runs.map((r) => r.fuelLeft);
        return {
          site: site.slug,
          'start fuel (kg)': site.fuel,
          '3 stars': `${runs.filter((r) => r.stars === 3).length}/${runs.length}`,
          'in ring': runs.filter((r) => r.soft && r.distance <= 40).length,
          soft: `${runs.filter((r) => r.soft).length}/${runs.length}`,
          'fuel star': runs.filter((r) => r.fuelStar).length,
          'left min (s)': lo(left),
          'left median (s)': round1(median(left)),
          'distance median (m)': Math.round(median(runs.map((r) => r.distance))),
          'red steps (max)': Math.max(...runs.map((r) => r.redSteps)),
          bumps: runs
            .filter((r) => !r.soft)
            .map((r) => `${r.seed}:${r.reasons}`)
            .join(' '),
          'time (s)': `${lo(runs.map((r) => r.time))}-${hi(runs.map((r) => r.time))}`,
        };
      }),
    );
    all.forEach(({ site, runs }, index) => {
      const three = runs.filter((r) => r.stars === 3).length;
      expect.soft(three, `${site.slug}: runs with 3 stars`).toBeGreaterThanOrEqual(1);
      for (const r of runs) expect.soft(r.redSteps, `${site.slug} seed ${r.seed}: steps in the red band`).toBe(0);
      if (index < 3) {
        expect.soft(median(runs.map((r) => r.fuelLeft)), `${site.slug}: median fuel left`).toBeGreaterThanOrEqual(33);
      }
    });
  }, 120_000);

  it(`(e) a noisy, slow novice who takes over from Help at ${NOVICE.takeover} m lands softly on every site`, () => {
    const all = SITES.map((site) => {
      const terrain = terrainOf(site);
      const runs: { run: RunSummary; takeoverFuel: number }[] = [];
      for (let seed = 1; seed <= NOVICE.seeds; seed++) runs.push(flyNovice(terrain, site, seed));
      return { site, runs };
    });
    console.table(
      all.map(({ site, runs }) => {
        const soft = runs.filter((r) => r.run.soft).length;
        return {
          site: site.slug,
          soft: `${soft}/${runs.length}`,
          'soft share': round1((soft / runs.length) * 100) / 100,
          'fuel at takeover min (s)': lo(runs.map((r) => r.takeoverFuel)),
          'left min (s)': lo(runs.map((r) => r.run.fuelLeft)),
          'left median (s)': round1(median(runs.map((r) => r.run.fuelLeft))),
          'ran dry': runs.filter((r) => r.run.fuelOut).length,
          bumps: runs
            .filter((r) => !r.run.soft)
            .map((r) => `${r.run.seed}:${r.run.reasons}`)
            .join(' '),
        };
      }),
    );
    for (const { site, runs } of all) {
      const soft = runs.filter((r) => r.run.soft).length;
      expect.soft(soft / runs.length, `${site.slug}: novice soft share`).toBeGreaterThanOrEqual(NOVICE.passShare);
    }
  }, 120_000);

  for (const kind of ['keys', 'slider'] as const) {
    it(`(f) a real-input ${kind} novice (0.4 s reaction) who takes over at 300 m and 150 m lands softly on every site`, () => {
      for (const { site, takeover, runs } of realNoviceTable(kind)) {
        const soft = runs.filter((r) => r.run.soft).length;
        expect
          .soft(soft / runs.length, `${kind} novice, ${site.slug}, takeover at ${takeover} m: soft share`)
          .toBeGreaterThanOrEqual(REAL.passShare);
      }
    }, 240_000);
  }
});
