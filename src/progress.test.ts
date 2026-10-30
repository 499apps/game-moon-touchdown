import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createMemoryStorage, createStorage } from './kit/storage';
import {
  PROGRESS_KEY,
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
        if (p.v !== 1) return false;
        if (!Number.isInteger(p.unlocked) || p.unlocked < 1 || p.unlocked > SITES.length) return false;
        return Object.entries(p.best).every(
          ([k, v]) => SITES.some((s) => s.slug === k) && Number.isInteger(v) && v >= 0 && v <= 3,
        );
      }),
    );
  });

  it('keeps good fields and drops bad ones', () => {
    const p = sanitizeProgress({ unlocked: 99, best: { tranquility: 2.7, storms: 'x', nowhere: 3, hadley: -4 } });
    expect(p).toEqual({ v: 1, unlocked: SITES.length, best: { tranquility: 2, hadley: 0 } });
  });
});
