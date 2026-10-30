import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EDGE_GAP, EDGE_RADIUS, arrowInsets, placeEdge, type Insets } from './edgeArrows';

const W = 1000;
const H = 600;
const INSET: Insets = { top: 100, right: 20, bottom: 50, left: 20 };

describe('edge arrows', () => {
  it('a point inside the frame needs no arrow', () => {
    const p = placeEdge(0, 0, false, W, H, INSET);
    expect(p.onScreen).toBe(true);
    expect(p.x).toBeCloseTo(500, 9);
    expect(p.y).toBeCloseTo(300, 9);
  });

  it('a point under the HUD band counts as off the frame', () => {
    // NDC y 0.9 is 30 px from the top, inside the 100 px HUD band.
    expect(placeEdge(0, 0.9, false, W, H, INSET).onScreen).toBe(false);
  });

  it('a point far to the right sits on the right edge, pointing right', () => {
    const p = placeEdge(3, 0, false, W, H, INSET);
    expect(p.onScreen).toBe(false);
    expect(p.x).toBeCloseTo(W - INSET.right, 6);
    expect(Math.abs(p.angle)).toBeLessThan(0.3);
  });

  it('a point below the frame points down (screen y grows down)', () => {
    const p = placeEdge(0, -3, false, W, H, INSET);
    expect(p.y).toBeCloseTo(H - INSET.bottom, 6);
    expect(p.angle).toBeCloseTo(Math.PI / 2, 6);
  });

  it('a point behind the camera points the other way', () => {
    const front = placeEdge(0.2, -0.5, true, W, H, INSET);
    expect(front.onScreen).toBe(false);
    expect(front.y).toBeCloseTo(INSET.top, 6);
  });

  it('arrow insets keep the whole circle on screen, below the HUD and above the controls', () => {
    const inset = arrowInsets(90, 120);
    expect(inset.left).toBeGreaterThanOrEqual(EDGE_RADIUS + EDGE_GAP);
    expect(inset.right).toBeGreaterThanOrEqual(EDGE_RADIUS + EDGE_GAP);
    expect(inset.top).toBeGreaterThanOrEqual(90 + EDGE_RADIUS);
    expect(inset.bottom).toBeGreaterThanOrEqual(120);
    expect(arrowInsets(Number.NaN, -5).top).toBeGreaterThanOrEqual(EDGE_RADIUS + EDGE_GAP);
  });

  it('with arrow insets the circle never leaves the view (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.boolean(),
        fc.integer({ min: 320, max: 1600 }),
        fc.integer({ min: 480, max: 1000 }),
        (x, y, behind, w, h) => {
          const inset = arrowInsets(80, 0.3 * h);
          const p = placeEdge(x, y, behind, w, h, inset);
          if (p.onScreen) return true;
          return p.x - EDGE_RADIUS >= 0 && p.x + EDGE_RADIUS <= w && p.y - EDGE_RADIUS >= 80 && p.y + EDGE_RADIUS <= h;
        },
      ),
    );
  });

  it('every arrow lies on the inset frame (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.boolean(),
        (x, y, behind) => {
          const p = placeEdge(x, y, behind, W, H, INSET);
          if (p.onScreen) return !behind;
          const onX = Math.abs(p.x - INSET.left) < 1e-6 || Math.abs(p.x - (W - INSET.right)) < 1e-6;
          const onY = Math.abs(p.y - INSET.top) < 1e-6 || Math.abs(p.y - (H - INSET.bottom)) < 1e-6;
          const inside =
            p.x >= INSET.left - 1e-6 &&
            p.x <= W - INSET.right + 1e-6 &&
            p.y >= INSET.top - 1e-6 &&
            p.y <= H - INSET.bottom + 1e-6;
          return inside && (onX || onY);
        },
      ),
    );
  });
});
