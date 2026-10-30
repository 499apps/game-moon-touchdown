/**
 * Progress: which sites are open and the best stars per site, stored through the kit storage
 * as "g499:moon-touchdown:progress". A soft landing on a site opens the next one.
 */
import type { KitStorage } from './kit/storage';
import { SITES } from './sim/sites';

export const PROGRESS_KEY = 'moon-touchdown:progress';
export const CONTROLS_KEY = 'moon-touchdown:touch-controls';

export interface Progress {
  v: 1;
  /** Number of open sites (1..SITES.length). */
  unlocked: number;
  /** Best stars (0..3) per site slug. */
  best: Record<string, number>;
}

export function emptyProgress(): Progress {
  return { v: 1, unlocked: 1, best: {} };
}

/** Accept only well-formed data; anything odd falls back to safe values. */
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
  return out;
}

export function isUnlocked(p: Progress, index: number): boolean {
  return index >= 0 && index < p.unlocked;
}

export function bestStars(p: Progress, slug: string): number {
  return p.best[slug] ?? 0;
}

/** Record a finished run. Returns a new object; the input is not changed. */
export function recordRun(p: Progress, index: number, soft: boolean, stars: number): Progress {
  const site = SITES[index];
  if (!site) return p;
  const best = { ...p.best };
  const s = Math.max(0, Math.min(3, Math.floor(stars)));
  if (s > (best[site.slug] ?? 0)) best[site.slug] = s;
  const unlocked = soft ? Math.max(p.unlocked, Math.min(SITES.length, index + 2)) : p.unlocked;
  return { v: 1, unlocked, best };
}

export function loadProgress(store: KitStorage): Progress {
  return sanitizeProgress(store.get<unknown>(PROGRESS_KEY, null));
}

export function saveProgress(store: KitStorage, p: Progress): boolean {
  return store.set(PROGRESS_KEY, p);
}
