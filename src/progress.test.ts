import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createMemoryStorage, createStorage } from './kit/storage';
import {
  PROGRESS_KEY,
  bestHelped,
  bestStars,
  emptyProgress,
  isUnlocked,
  loadProgress,
  recordRun,
  sanitizeProgress,
  saveProgress,
} from './progress';
import { SITES } from './sim/sites';

describe('progress', () => {
  it('starts with only the first site open', () => {
    const p = emptyProgress();
    expect(isUnlocked(p, 0)).toBe(true);
    expect(isUnlocked(p, 1)).toBe(false);
    expect(bestStars(p, 'tranquility')).toBe(0);
  });

  it('a soft landing opens the next site; a bumpy one does not', () => {
    let p = recordRun(emptyProgress(), 0, false, 0);
    expect(p.unlocked).toBe(1);
    p = recordRun(p, 0, true, 2);
    expect(p.unlocked).toBe(2);
    expect(bestStars(p, 'tranquility')).toBe(2);
    p = recordRun(p, 0, true, 1);
    expect(bestStars(p, 'tranquility')).toBe(2);
    const last = recordRun({ ...p, unlocked: SITES.length }, SITES.length - 1, true, 3);
    expect(last.unlocked).toBe(SITES.length);
  });

  it('round-trips through the kit storage under the g499 prefix', () => {
    const backend = createMemoryStorage();
    const store = createStorage(backend);
    const p = recordRun(recordRun(emptyProgress(), 0, true, 3), 1, true, 1);
    expect(saveProgress(store, p)).toBe(true);
    expect(backend.getItem(`g499:${PROGRESS_KEY}`)).not.toBeNull();
    expect(loadProgress(store)).toEqual(p);
    store.clearAll();
    expect(loadProgress(store)).toEqual(emptyProgress());
  });

  it('sanitises any stored value into a valid progress (property)', () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const p = sanitizeProgress(raw);
        if (p.v !== 2) return false;
        if (typeof p.solo !== 'boolean') return false;
        if (!Number.isInteger(p.unlocked) || p.unlocked < 1 || p.unlocked > SITES.length) return false;
        const helpedOk = Object.entries(p.helped).every(([k, v]) => v === true && p.best[k] !== undefined);
        return (
          helpedOk &&
          Object.entries(p.best).every(
            ([k, v]) => SITES.some((s) => s.slug === k) && Number.isInteger(v) && v >= 0 && v <= 3,
          )
        );
      }),
    );
  });

  it('keeps good fields and drops bad ones', () => {
    const p = sanitizeProgress({ unlocked: 99, best: { tranquility: 2.7, storms: 'x', nowhere: 3, hadley: -4 } });
    expect(p).toEqual({ v: 2, unlocked: SITES.length, best: { tranquility: 2, hadley: 0 }, helped: {}, solo: false });
  });

  it('migrates v1 data to v2 with no helper marks', () => {
    const v1 = { v: 1, unlocked: 3, best: { tranquility: 3, storms: 1 } };
    expect(sanitizeProgress(v1)).toEqual({
      v: 2,
      unlocked: 3,
      best: { tranquility: 3, storms: 1 },
      helped: {},
      solo: false,
    });
  });

  it('marks helped bests and lets an unhelped run with the same stars clear the mark', () => {
    let p = recordRun(emptyProgress(), 0, true, 2, true);
    expect(bestHelped(p, 'tranquility')).toBe(true);
    expect(p.solo).toBe(false);
    // Fewer stars without the helper: the helped best stays.
    p = recordRun(p, 0, true, 1, false);
    expect(bestStars(p, 'tranquility')).toBe(2);
    expect(bestHelped(p, 'tranquility')).toBe(true);
    expect(p.solo).toBe(true);
    // Same stars without the helper: the honest mark wins.
    p = recordRun(p, 0, true, 2, false);
    expect(bestHelped(p, 'tranquility')).toBe(false);
    // More stars with the helper: the mark comes back.
    p = recordRun(p, 0, true, 3, true);
    expect(bestHelped(p, 'tranquility')).toBe(true);
    expect(sanitizeProgress(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('only an unhelped soft landing sets solo', () => {
    expect(recordRun(emptyProgress(), 0, true, 1, true).solo).toBe(false);
    expect(recordRun(emptyProgress(), 0, false, 0, false).solo).toBe(false);
    expect(recordRun(emptyProgress(), 0, true, 1, false).solo).toBe(true);
  });
});
