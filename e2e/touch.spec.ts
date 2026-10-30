import { expect, test, type Page } from '@playwright/test';
import { guardPage, hasWebgl, waitForReady } from '../src/kit/smoke/helpers';

/**
 * Touch controls answer at once (R3 finding 6): the iPhone and Pixel projects, built site,
 * "?test=1&live=1" (live clock and render loop, fixed seed, silent audio). The slider and the pad
 * get pointer events of type "touch". Waits count rendered frames and sim time, never short
 * wall-clock windows: a host without a GPU renders about 2 fps.
 */

interface TouchState {
  phase: 'pick' | 'ready' | 'flying' | 'landed';
  assist: boolean;
  solo: boolean;
  throttle: number;
  time: number;
  lever: number;
  tiltX: number;
  landerTilt: { x: number; z: number; deg: number } | null;
  toast: string | null;
  touchControls: boolean;
  rcsPuffs: number;
}

interface Snap {
  s: TouchState;
  scrollY: number;
  /** Visual viewport scale (1 = no zoom). */
  zoom: number;
}

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const w = window as unknown as { __g499?: { state?: () => unknown } };
    const s = (w.__g499?.state ? w.__g499.state() : {}) as TouchState;
    return { s, scrollY: window.scrollY, zoom: window.visualViewport ? window.visualViewport.scale : 1 };
  });
}

async function waitPhase(page: Page, phase: TouchState['phase']): Promise<void> {
  await expect.poll(async () => (await snap(page)).s.phase, { timeout: 20_000 }).toBe(phase);
}

/** Wait until at least secs of sim time passed since from. */
async function waitSim(page: Page, from: TouchState, secs: number): Promise<Snap> {
  await expect.poll(async () => (await snap(page)).s.time - from.time, { timeout: 15_000, intervals: [50] }).toBeGreaterThanOrEqual(secs);
  return snap(page);
}

/** Wait for n rendered frames (requestAnimationFrame), then read the state. */
async function afterFrames(page: Page, n: number): Promise<Snap> {
  await page.evaluate(
    (count) =>
      new Promise<void>((res) => {
        let left = count;
        const tick = (): void => {
          left--;
          if (left > 0) requestAnimationFrame(tick);
          else res();
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
  return snap(page);
}

/** Touch down in the middle of an element and drag by (dx, dy) px in 6 moves; the finger stays down. */
async function touchDrag(page: Page, selector: string, id: number, dx: number, dy: number): Promise<void> {
  await page.evaluate(
    ({ sel, pid, mx, my }) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no element ${sel}`);
      const r = el.getBoundingClientRect();
      const x0 = r.left + r.width / 2;
      const y0 = r.top + r.height / 2;
      const base = { pointerId: pid, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: x0, clientY: y0 }));
      for (let i = 1; i <= 6; i++) {
        el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: x0 + (mx * i) / 6, clientY: y0 + (my * i) / 6 }));
      }
    },
    { sel: selector, pid: id, mx: dx, my: dy },
  );
}

/** Lift the finger of a touchDrag. */
async function touchUp(page: Page, selector: string, id: number): Promise<void> {
  await page.evaluate(
    ({ sel, pid }) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no element ${sel}`);
      el.dispatchEvent(
        new PointerEvent('pointerup', { pointerId: pid, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: 0 }),
      );
    },
    { sel: selector, pid: id },
  );
}

/** The two element boxes overlap. */
async function boxesOverlap(page: Page, a: string, b: string): Promise<boolean> {
  const ra = await page.locator(a).boundingBox();
  const rb = await page.locator(b).boundingBox();
  if (!ra || !rb) return false;
  return ra.x < rb.x + rb.width && rb.x < ra.x + ra.width && ra.y < rb.y + rb.height && rb.y < ra.y + ra.height;
}

test.describe('moon-touchdown touch controls', () => {
  test('the slider takes the engine from Help, the pad tilts the lander, a tap changes nothing', async ({
    page,
    baseURL,
  }, testInfo) => {
    const phone = testInfo.project.name === 'iphone' || testInfo.project.name === 'pixel';
    test.skip(!phone, 'Touch controls: iPhone and Pixel projects only');
    const guard = guardPage(page, page.context(), baseURL ?? 'http://localhost');
    // The touch controls on, the same as a phone with a coarse pointer (stored under the g499: prefix).
    await page.addInitScript(() => localStorage.setItem('g499:moon-touchdown:touch-controls', 'true'));
    await page.goto('/games/moon-touchdown/?test=1&live=1');
    await waitForReady(page);
    test.fixme(!(await hasWebgl(page)), 'WebGL is not available in this engine on this host, so the game loop does not run');

    await page.locator('.mt-site[data-slug="tranquility"]').tap();
    await waitPhase(page, 'ready');
    const ready = (await snap(page)).s;
    expect(ready.touchControls).toBe(true);
    // Ready screen (R3 finding 3): the tip, the chip and the Help button tell one story.
    if (!ready.solo) {
      await expect(page.locator('#ready-tip-help')).toBeVisible();
      await expect(page.locator('#input-chip')).toHaveAttribute('data-engine', 'help');
      await expect(page.locator('#assist-btn')).toHaveAttribute('aria-pressed', 'true');
      expect(ready.assist).toBe(true);
    } else {
      await expect(page.locator('#ready-tip-help')).toBeHidden();
      await expect(page.locator('#input-chip')).toHaveAttribute('data-engine', 'you');
    }

    // Go: Help flies the engine.
    await page.locator('#go-btn').tap();
    await waitPhase(page, 'flying');
    const g0 = (await snap(page)).s;
    expect(g0.assist).toBe(true);
    const g1 = (await waitSim(page, g0, 0.3)).s;

    // 1. Drag the slider up 60 px: Help hands the engine over, the lever goes up, the engine burns.
    await touchDrag(page, '#throttle', 41, 0, -60);
    const d = await afterFrames(page, 3);
    expect(d.s.assist, 'Help off after a slider drag').toBe(false);
    expect(d.s.lever, 'the lever went up').toBeGreaterThan(g1.lever + 0.1);
    expect(d.s.toast).toBe('You fly now');
    expect(d.s.throttle, 'engine on within 3 rendered frames').toBeGreaterThan(0);
    await expect(page.locator('#input-chip')).toHaveAttribute('data-engine', 'you');
    await expect(page.locator('#assist-btn')).toHaveAttribute('aria-pressed', 'false');
    // The toast sits below the HUD, never on it (R3 finding 5), and is fully shown (finding 4).
    await expect(page.locator('#toast')).toBeVisible();
    expect(await boxesOverlap(page, '#toast', '#hud'), 'the toast covers the HUD').toBe(false);
    expect(await page.locator('#toast').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await touchUp(page, '#throttle', 41);

    // 2. Drag on the pad to the left: the tilt command goes left at once, puffs fire, the lander leans.
    await touchDrag(page, '#tilt-pad', 42, -50, 0);
    const p0 = await afterFrames(page, 3);
    expect(p0.s.tiltX, 'tilt command to the left').toBeLessThan(0);
    expect(p0.s.rcsPuffs, 'thruster puffs within 3 rendered frames').toBeGreaterThan(0);
    const p1 = await waitSim(page, p0.s, 0.3);
    await touchUp(page, '#tilt-pad', 42);
    expect(p1.s.landerTilt?.x ?? 0, 'the lander leans left').toBeLessThan(-2);

    // 3. A tap on the slider does not move the lever (F-26: the slider is relative).
    const t0 = (await afterFrames(page, 2)).s;
    await page.locator('#throttle').tap();
    const t1 = (await afterFrames(page, 3)).s;
    expect(t1.lever, 'a tap keeps the lever').toBeCloseTo(t0.lever, 6);

    // Nothing scrolled or zoomed the page.
    const end = await snap(page);
    expect(end.scrollY).toBe(0);
    expect(end.zoom).toBe(1);
    await guard.assertClean();
  });
});
