/**
 * Progress: which sites are open, the best stars per site and whether the hover helper flew that
 * best run, stored through the kit storage as "g499:moon-touchdown:progress". A soft landing on
 * a site opens the next one.
 *
 * Schema v2 adds `helped` (per site) and `solo` (the player has landed softly without the
 * helper at least once). v1 data migrates on load: no helper marks, `solo` false.
 */
import type { KitStorage } from './kit/storage';
import { SITES } from './sim/sites';

export const PROGRESS_KEY = 'moon-touchdown:progress';
export const CONTROLS_KEY = 'moon-touchdown:touch-controls';
export const PROGRESS_VERSION = 2;

export interface Progress {
  v: 2;
  /** Number of open sites (1..SITES.length). */
  unlocked: number;
  /** Best stars (0..3) per site slug. */
  best: Record<string, number>;
  /** True when the hover helper flew the engine in the best run of that site. */
  helped: Record<string, boolean>;
  /** The player has landed softly at least once without the helper. */
  solo: boolean;
}

export function emptyProgress(): Progress {
  return { v: 2, unlocked: 1, best: {}, helped: {}, solo: false };
}

/** Accept only well-formed data (v1 or v2); anything odd falls back to safe values. */
export function sanitizeProgress(raw: unknown): Progress {
  const out = emptyProgress();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const u = r['unlocked'];
  if (typeof u === 'number' && Number.isFinite(u)) {
    out.unlocked = Math.max(1, Math.min(SITES.length, Math.floor(u)));
  }
  const best = r['best'];
  if (best && typeof best === 'object') {
    for (const site of SITES) {
      const v = (best as Record<string, unknown>)[site.slug];
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.best[site.slug] = Math.max(0, Math.min(3, Math.floor(v)));
      }
    }
  }
  // v2 fields. v1 data has none of them, which reads as "no helper marks, not solo yet".
  const helped = r['helped'];
  if (helped && typeof helped === 'object') {
    for (const site of SITES) {
      const v = (helped as Record<string, unknown>)[site.slug];
      if (v === true && out.best[site.slug] !== undefined) out.helped[site.slug] = true;
    }
  }
  if (r['solo'] === true) out.solo = true;
  return out;
}

export function isUnlocked(p: Progress, index: number): boolean {
  return index >= 0 && index < p.unlocked;
}

export function bestStars(p: Progress, slug: string): number {
  return p.best[slug] ?? 0;
}

/** True when the helper flew the engine in the best run of the site. */
export function bestHelped(p: Progress, slug: string): boolean {
  return p.helped[slug] === true;
}

/**
 * Record a finished run. Returns a new object; the input is not changed. A run with the same
 * stars but without the helper replaces a helped best (the honest mark wins).
 */
export function recordRun(p: Progress, index: number, soft: boolean, stars: number, helped = false): Progress {
  const site = SITES[index];
  if (!site) return p;
  const best = { ...p.best };
  const helpedMap = { ...p.helped };
  const s = Math.max(0, Math.min(3, Math.floor(stars)));
  const old = best[site.slug] ?? 0;
  if (s > old) {
    best[site.slug] = s;
    if (helped) helpedMap[site.slug] = true;
    else delete helpedMap[site.slug];
  } else if (s === old && s > 0 && !helped) {
    delete helpedMap[site.slug];
  }
  const unlocked = soft ? Math.max(p.unlocked, Math.min(SITES.length, index + 2)) : p.unlocked;
  return { v: 2, unlocked, best, helped: helpedMap, solo: p.solo || (soft && !helped) };
}

export function loadProgress(store: KitStorage): Progress {
  return sanitizeProgress(store.get<unknown>(PROGRESS_KEY, null));
}

export function saveProgress(store: KitStorage, p: Progress): boolean {
  return store.set(PROGRESS_KEY, p);
}
