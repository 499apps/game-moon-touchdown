/**
 * The hover helper on the real terrain of every site (public/data/terrain/<slug>.bin), from
 * seeded starts. It proves the helper is fair (a soft landing every time) and that the fuel per
 * site makes the fuel budget matter (FIXLIST F-07 and F-11).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createRng } from '../kit/prng';
import { G_MOON, MAX_THRUST } from './constants';
import { Flight, IDLE_INPUT, type FlightEvent, type PilotInput } from './flight';
import { clamp, massOf } from './lander';
import { GRID, SITES, startConditions, type SiteInfo } from './sites';
import { Terrain } from './terrain';

/** Seeds per site. Each run is about 5,000 fixed steps. */
const SEEDS = 16;
const MAX_TICKS = 60 * 400;
const ASSIST: PilotInput = { ...IDLE_INPUT, assist: true };

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

interface RunSummary {
  seed: number;
  soft: boolean;
  reasons: string;
  fuelLeft: number;
  fuelUsed: number;
  heard60: boolean;
  time: number;
  distance: number;
}

function flyHelper(site: SiteInfo, terrain: Terrain, seed: number): RunSummary {
  const f = new Flight(terrain, startConditions(site, createRng(seed), terrain));
  const startSeconds = f.fuelSeconds;
  const events: FlightEvent[] = [];
  while (f.phase === 'flying' && f.tick < MAX_TICKS) events.push(...f.step(ASSIST));
  const r = f.result;
  return {
    seed,
    soft: r?.verdict.outcome === 'soft',
    reasons: r ? r.verdict.reasons.join(',') : 'no touchdown',
    fuelLeft: r ? r.touchdown.fuelSeconds : 0,
    fuelUsed: r ? startSeconds - r.touchdown.fuelSeconds : 0,
    heard60: events.some((e) => e.type === 'callout' && e.seconds === 60),
    time: r ? r.touchdown.time : 0,
    distance: r ? r.distance : 0,
  };
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

describe('hover helper on the real terrain of every site', () => {
  SITES.forEach((site, index) => {
    it(`${site.slug}: lands softly from ${SEEDS} seeded starts with fuel to spare`, () => {
      const terrain = terrainOf(site);
      const runs: RunSummary[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) runs.push(flyHelper(site, terrain, seed));
      const used = runs.map((r) => r.fuelUsed);
      const left = runs.map((r) => r.fuelLeft);
      console.info(
        `[helper] ${site.slug}: fuel used ${Math.min(...used).toFixed(0)}-${Math.max(...used).toFixed(0)} s, ` +
          `left ${Math.min(...left).toFixed(0)}-${Math.max(...left).toFixed(0)} s, ` +
          `60 s call-out ${runs.filter((r) => r.heard60).length}/${runs.length}, ` +
          `time ${Math.min(...runs.map((r) => r.time)).toFixed(0)}-${Math.max(...runs.map((r) => r.time)).toFixed(0)} s`,
      );
      for (const r of runs) {
        expect(r.soft, `${site.slug} seed ${r.seed}: ${r.reasons} at ${r.distance.toFixed(0)} m`).toBe(true);
        // Sites 1-3 keep 30 s or more (the fuel star); sites 4-6 keep 10 s or more.
        const floor = index < 3 ? 30 : 10;
        expect(r.fuelLeft, `${site.slug} seed ${r.seed}: fuel left`).toBeGreaterThanOrEqual(floor);
      }
      if (index >= 3) {
        // On the hard sites a normal helper run hears the 60 s call-out.
        const heard = runs.filter((r) => r.heard60).length;
        expect(heard, `${site.slug}: runs that heard the 60 s call-out`).toBeGreaterThanOrEqual(Math.ceil(runs.length * 0.75));
      }
    }, 60_000);
  });

  it('fra-mauro: hovering high for 30 s first brings the 60 s call-out', () => {
    const site = SITES[2];
    if (!site) throw new Error('no site 3');
    const terrain = terrainOf(site);
    const f = new Flight(terrain, startConditions(site, createRng(7), terrain));
    const events: FlightEvent[] = [];
    // A manual pilot stops the fall and hovers for 30 s, then turns the helper on.
    while (f.phase === 'flying' && f.state.t < 30) {
      const s = f.state;
      const throttle = clamp(((G_MOON + 1.5 * -s.vel.y) * massOf(s)) / MAX_THRUST, 0.1, 1);
      events.push(...f.step({ ...IDLE_INPUT, throttle }));
    }
    while (f.phase === 'flying' && f.tick < MAX_TICKS) events.push(...f.step(ASSIST));
    expect(events.some((e) => e.type === 'callout' && e.seconds === 60)).toBe(true);
    expect(f.result?.verdict.outcome).toBe('soft');
  });
});
