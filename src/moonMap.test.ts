import { describe, expect, it } from 'vitest';
import { moonMapSvg, projectNearSide, wrapLon } from './moonMap';
import { SITES, siteBySlug } from './sim/sites';

describe('moon map', () => {
  it('wraps east longitude into -180..180', () => {
    expect(wrapLon(336.5784)).toBeCloseTo(-23.4216, 6);
    expect(wrapLon(23.473)).toBeCloseTo(23.473, 9);
    expect(wrapLon(-190)).toBeCloseTo(170, 9);
  });

  it('puts every site on the near-side disc, east to the right and north up', () => {
    for (const s of SITES) {
      const p = projectNearSide(s.lat, s.lon);
      expect(Math.hypot(p.x, p.y)).toBeLessThan(1);
    }
    const tranquility = siteBySlug('tranquility');
    const storms = siteBySlug('storms');
    const hadley = siteBySlug('hadley');
    if (!tranquility || !storms || !hadley) throw new Error('missing site');
    expect(projectNearSide(tranquility.lat, tranquility.lon).x).toBeGreaterThan(0);
    expect(projectNearSide(storms.lat, storms.lon).x).toBeLessThan(0);
    expect(projectNearSide(hadley.lat, hadley.lon).y).toBeGreaterThan(0.4);
  });

  it('draws an SVG with one site dot and no external references', () => {
    const svg = moonMapSvg(0.6741, 23.473, 'x', 'Where on the Moon');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('aria-label="Where on the Moon"');
    expect(svg).not.toMatch(/https?:|href=/);
  });
});
