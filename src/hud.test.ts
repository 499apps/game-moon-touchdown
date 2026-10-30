import { describe, expect, it } from 'vitest';
import { LIMITS } from './sim/constants';
import { VS_GREEN, VS_YELLOW, vsBand } from './hud';
import { niceMax } from './graphs';

describe('speed-down bands', () => {
  it('green matches the soft-touchdown limit', () => {
    expect(VS_GREEN).toBe(LIMITS.vs);
    expect(vsBand(0)).toBe('good');
    expect(vsBand(1.99)).toBe('good');
    expect(vsBand(2)).toBe('warn');
    expect(vsBand(VS_YELLOW - 0.01)).toBe('warn');
    expect(vsBand(VS_YELLOW)).toBe('bad');
  });
});

describe('chart scale', () => {
  it('rounds up to a friendly number', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3.2)).toBe(5);
    expect(niceMax(430)).toBe(500);
    expect(niceMax(1000)).toBe(1000);
  });
});
