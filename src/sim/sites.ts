/**
 * The six landing sites, easiest first, with their start ranges, fact cards and look. Grid
 * facts (256 x 256, 60 m, 0.5 m units) match public/data/terrain/sites.json. Start conditions
 * come from a seeded PRNG, so a seed replays the same approach.
 *
 * Fuel per site (F2): the hover helper lands with about 13-22 s of hover fuel left, below the
 * 30 s fuel star, so the star is earned. An efficient pilot (fall fast up high, brake late and
 * hard, little hovering) keeps 30 s or more. src/sim/helper-sites.test.ts checks both on the real
 * terrain and prints a per-site table for re-tuning.
 */
import type { Rng } from '../kit/prng';
import type { StartConditions } from './flight';
import type { Terrain } from './terrain';

export interface Range {
  min: number;
  max: number;
}

/** How the ground looks at a site (decoration only, never the heights). */
export interface SiteLook {
  /** Regolith colour on flat ground (sRGB hex). Maria are darker and warmer. */
  regolith: string;
  /** Colour on steep, fresh slopes (sRGB hex). */
  fresh: string;
  /** Crater count and crater size in the detail map, relative to 1. */
  craterDensity: number;
  craterScale: number;
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
  /** Two or three short, true facts for the debrief card (one per run, in turn). */
  facts: readonly string[];
  /** One question a parent can ask after the landing. */
  talk: string;
  /** A real touchdown speed at this site (m/s), when a good figure is known. */
  crewVs?: number;
  look: SiteLook;
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
    fuel: 177,
    facts: [
      'People first landed on the Moon here in July 1969. The ground is a wide, flat plain of old, dark lava.',
      'The first crew left a mirror here. Scientists still bounce laser light off it to measure how far away the Moon is.',
      'The first crew left footprints here. With no wind or rain on the Moon, footprints can last for a very long time.',
    ],
    talk: 'Why does the lander need only a small push to hover here?',
    crewVs: 0.5,
    look: { regolith: '#857e74', fresh: '#a39d93', craterDensity: 0.8, craterScale: 0.8 },
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
    fuel: 188,
    facts: [
      'A crew landed here in November 1969, a short walk from a robot lander that arrived in 1967. They brought parts of it home.',
      'The Ocean of Storms is the biggest dark lava plain on the Moon. It has no storms: the Moon has no air.',
    ],
    talk: 'The Moon has no air. What does a storm need that the Moon does not have?',
    look: { regolith: '#8a8379', fresh: '#a7a197', craterDensity: 0.85, craterScale: 0.85 },
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
    fuel: 198,
    facts: [
      'A crew landed in these hills in February 1971. One explorer hit two golf balls here, in gravity one sixth of the Earth.',
      'The crew pulled a small cart with two wheels to carry their tools and rocks up the hills.',
      'Scientists think these hills are rock that was thrown out when a giant space rock hit the Moon far away.',
    ],
    talk: 'A golf ball flies much farther on the Moon. Why do you think that is?',
    look: { regolith: '#999389', fresh: '#b6b0a6', craterDensity: 1.3, craterScale: 1.1 },
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
    fuel: 208,
    facts: [
      'In April 1972 a crew landed in these bright highlands, far from the dark lava plains. The rocks here are very old.',
      'The crew drove a car on the Moon here. Its fastest run was about 17 km/h, a little faster than a child can run.',
    ],
    talk: 'Why do you think scientists want to study very old rocks?',
    look: { regolith: '#a09a91', fresh: '#bcb6ac', craterDensity: 1.4, craterScale: 1.15 },
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
    fuel: 220,
    facts: [
      'The last people on the Moon left this deep valley in December 1972. They found orange soil made of tiny glass beads.',
      'On the way here, the crew took a famous photo of the whole Earth, fully lit by the Sun.',
      'Mountains about 2 km high stand on both sides of this valley.',
    ],
    talk: 'Why is landing in a deep valley harder than landing on a flat plain?',
    look: { regolith: '#7c756c', fresh: '#b8b2a7', craterDensity: 1, craterScale: 1 },
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
    fuel: 232,
    facts: [
      'In July 1971 people drove a car on the Moon for the first time, here beside Hadley Rille: a winding channel about 1 to 1.5 km wide.',
      'Here a crew member dropped a hammer and a feather at the same time. With no air to slow the feather, both hit the ground together.',
      'The crew found a white rock here that is about 4 billion years old.',
    ],
    talk: 'A hammer and a feather fell together here. Why does a feather fall slowly on the Earth?',
    look: { regolith: '#8a8379', fresh: '#b4aea3', craterDensity: 1, craterScale: 1.05 },
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

/** The terrain is real LOLA laser altimeter data at true scale. */
export const REAL_GROUND_FACT = 'This ground is real. A laser on a spacecraft measured every hill.';

/** Design limit of the real landing legs for speed down (about 10 ft/s). */
export const REAL_LEG_LIMIT_VS = 3;

/** The fact for a run: the site facts take turns. */
export function factFor(site: SiteInfo, run: number): string {
  const n = site.facts.length;
  if (n === 0) return '';
  return site.facts[((Math.floor(run) % n) + n) % n] ?? '';
}

/** "You vs the real crew" line for the debrief (speed down at touchdown, m/s). */
export function crewLine(site: SiteInfo, vs: number): string {
  const you = `You: ${vs.toFixed(1)} m/s.`;
  if (site.crewVs !== undefined) {
    return `The real crew touched down here at about ${site.crewVs.toFixed(1)} m/s. ${you}`;
  }
  return `The real landing legs were built for up to about ${REAL_LEG_LIMIT_VS} m/s down. ${you}`;
}
