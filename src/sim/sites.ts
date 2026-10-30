/**
 * The six landing sites, easiest first, with their start ranges and fact cards. Grid facts
 * (256 x 256, 60 m, 0.5 m units) match public/data/terrain/sites.json. Start conditions come
 * from a seeded PRNG, so a seed replays the same approach.
 */
import type { Rng } from '../kit/prng';
import type { StartConditions } from './flight';
import type { Terrain } from './terrain';

export interface Range {
  min: number;
  max: number;
}

export interface SiteInfo {
  slug: string;
  name: string;
  /** Selenographic latitude and east longitude (deg). */
  lat: number;
  lon: number;
  /** 1 (easiest) .. 6. */
  difficulty: number;
  /** Height above the target ground at the start (m). */
  height: Range;
  /** Start distance from the target (m). */
  offset: Range;
  /** Start sideways speed (m/s). */
  drift: Range;
  /** Start descent speed (m/s, positive = down). */
  descent: Range;
  /** Fuel at the start (kg). */
  fuel: number;
  /** One short, true fact for the debrief card. */
  fact: string;
}

export const GRID = { size: 256, spacing: 60, unit: 0.5 } as const;

export const SITES: readonly SiteInfo[] = [
  {
    slug: 'tranquility',
    name: 'Sea of Tranquility',
    lat: 0.6741,
    lon: 23.473,
    difficulty: 1,
    height: { min: 350, max: 450 },
    offset: { min: 40, max: 120 },
    drift: { min: 0.5, max: 2 },
    descent: { min: 6, max: 9 },
    fuel: 900,
    fact: 'People first landed on the Moon here in July 1969. The ground is a wide, flat plain of old, dark lava.',
  },
  {
    slug: 'storms',
    name: 'Ocean of Storms',
    lat: -3.0124,
    lon: 336.5784,
    difficulty: 2,
    height: { min: 400, max: 500 },
    offset: { min: 80, max: 200 },
    drift: { min: 1, max: 3 },
    descent: { min: 7, max: 10 },
    fuel: 820,
    fact: 'A crew landed here in November 1969, a short walk from a robot lander that arrived in 1967. They brought parts of it home.',
  },
  {
    slug: 'fra-mauro',
    name: 'Fra Mauro Highlands',
    lat: -3.6453,
    lon: 342.5286,
    difficulty: 3,
    height: { min: 450, max: 550 },
    offset: { min: 120, max: 260 },
    drift: { min: 2, max: 4 },
    descent: { min: 8, max: 11 },
    fuel: 740,
    fact: 'A crew landed in these hills in February 1971. One explorer hit two golf balls here, in gravity one sixth of the Earth.',
  },
  {
    slug: 'descartes',
    name: 'Descartes Highlands',
    lat: -8.973,
    lon: 15.5002,
    difficulty: 4,
    height: { min: 500, max: 600 },
    offset: { min: 160, max: 320 },
    drift: { min: 2.5, max: 5 },
    descent: { min: 8, max: 12 },
    fuel: 660,
    fact: 'In April 1972 a crew landed in these bright highlands, far from the dark lava plains. The rocks here are very old.',
  },
  {
    slug: 'taurus-littrow',
    name: 'Taurus-Littrow Valley',
    lat: 20.1911,
    lon: 30.7723,
    difficulty: 5,
    height: { min: 550, max: 650 },
    offset: { min: 200, max: 380 },
    drift: { min: 3, max: 6 },
    descent: { min: 9, max: 12 },
    fuel: 580,
    fact: 'The last people on the Moon left this deep valley in December 1972. They found orange soil made of tiny glass beads.',
  },
  {
    slug: 'hadley',
    name: 'Hadley Rille',
    lat: 26.1322,
    lon: 3.6339,
    difficulty: 6,
    height: { min: 600, max: 700 },
    offset: { min: 250, max: 450 },
    drift: { min: 4, max: 7 },
    descent: { min: 9, max: 13 },
    fuel: 500,
    fact: 'In July 1971 the first car on the Moon drove here, beside Hadley Rille: a winding channel about 1.5 km wide.',
  },
];

export function siteIndex(slug: string): number {
  return SITES.findIndex((s) => s.slug === slug);
}

export function siteBySlug(slug: string): SiteInfo | undefined {
  return SITES.find((s) => s.slug === slug);
}

const pick = (rng: Rng, r: Range): number => rng.float(r.min, r.max);

/** Lowest start clearance above the local ground (m). */
export const MIN_START_CLEARANCE = 150;

/**
 * Start state for a run: above and off to the side of the target, drifting roughly toward it
 * (within +-35 deg), so the approach feels natural and needs a correction.
 */
export function startConditions(site: SiteInfo, rng: Rng, terrain: Terrain): StartConditions {
  const bearing = rng.float(0, Math.PI * 2);
  const dist = pick(rng, site.offset);
  const x = Math.cos(bearing) * dist;
  const z = Math.sin(bearing) * dist;
  const height = pick(rng, site.height);
  const driftSpeed = pick(rng, site.drift);
  const driftDir = bearing + Math.PI + rng.float(-0.6, 0.6);
  const descent = pick(rng, site.descent);
  const y = Math.max(terrain.heightAt(0, 0) + height, terrain.heightAt(x, z) + MIN_START_CLEARANCE);
  return {
    pos: { x, y, z },
    vel: { x: Math.cos(driftDir) * driftSpeed, y: -descent, z: Math.sin(driftDir) * driftSpeed },
    fuel: site.fuel,
  };
}

/** Earth's gravity is about six times the Moon's: the debrief compares them. */
export const GRAVITY_FACT =
  'The Moon pulls with 1.62 m/s², about one sixth of the Earth (9.81 m/s²). A small push from the engine is enough to hover.';
