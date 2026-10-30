import { expect, test, type Page } from '@playwright/test';
import { guardPage, hasWebgl, waitForReady } from '../src/kit/smoke/helpers';

/**
 * Keyboard controls feel immediate (F4). Real key presses (keyboard.down / up), a live clock and
 * a running render loop ("?test=1&live=1": fixed seed and silent audio, no frozen frames), real
 * time waits. Desktop Chromium only: the phones have their own touch checks in smoke.spec.ts.
 */

interface ControlsState {
  phase: 'pick' | 'ready' | 'flying' | 'landed';
  assist: boolean;
  throttle: number;
  vs: number;
  vx: number;
  time: number;
  lastInputSource: 'keyboard' | 'touch' | 'pad' | 'helper' | null;
  lastInputAgeMs: number | null;
  heldKeys: string[];
  litKeys: string[];
  lever: number;
  tiltX: number;
  tiltZ: number;
  landerTilt: { x: number; z: number; deg: number } | null;
  toast: string | null;
}

interface Snap {
  s: ControlsState;
  scrollY: number;
  /** data-menu-id of the focused rail button, else the focused tag name. */
  focus: string;
}

/** State, page scroll and focus in one round trip. */
async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const w = window as unknown as { __g499?: { state?: () => unknown } };
    const s = (w.__g499?.state ? w.__g499.state() : {}) as ControlsState;
    const a = document.activeElement as HTMLElement | null;
    return { s, scrollY: window.scrollY, focus: a ? (a.dataset['menuId'] ?? a.tagName) : '' };
  });
}

async function waitPhase(page: Page, phase: ControlsState['phase']): Promise<void> {
  await expect.poll(async () => (await snap(page)).s.phase, { timeout: 20_000 }).toBe(phase);
}

/** Wait (keys held as they are) until at least secs of sim time passed since from. Hosts without a GPU render about 2 fps, so wall-clock waits sample too little flight. */
async function waitSim(page: Page, from: ControlsState, secs: number): Promise<Snap> {
  await expect.poll(async () => (await snap(page)).s.time - from.time, { timeout: 15_000, intervals: [50] }).toBeGreaterThanOrEqual(secs);
  return snap(page);
}

/** Mean vertical acceleration (m/s^2) between two samples, by sim time. */
function accel(a: ControlsState, b: ControlsState): number {
  return (b.vs - a.vs) / Math.max(1e-3, b.time - a.time);
}

test.describe('moon-touchdown keyboard controls', () => {
  test('W takes the engine from Help at once, arrows tilt the lander, the page never scrolls', async ({
    page,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Real keyboard test: desktop Chromium project only');
    const guard = guardPage(page, page.context(), baseURL ?? 'http://localhost');
    await page.goto('/games/moon-touchdown/?test=1&live=1');
    await waitForReady(page);
    test.fixme(!(await hasWebgl(page)), 'WebGL is not available in this engine on this host, so the game loop does not run');

    await page.locator('.mt-site[data-slug="tranquility"]').click();
    await waitPhase(page, 'ready');
    // Keyboard (touch pad off): the key tip with key caps.
    await expect(page.locator('#ready-tip-keys')).toBeVisible();
    await expect(page.locator('#ready-tip-keys kbd')).toHaveCount(4);

    // 1. Control run: Space starts with Help on; no input. Help idles the engine high up.
    await page.keyboard.press('Space');
    await waitPhase(page, 'flying');
    const c0 = (await snap(page)).s;
    expect(c0.assist).toBe(true);
    await expect(page.locator('#toast')).toContainText('Help flies the engine');
    await expect(page.locator('#input-chip')).toHaveAttribute('data-engine', 'help');
    const c1 = (await waitSim(page, c0, 0.9)).s;
    const controlAccel = accel(c0, c1);

    // 2. A click on a rail button (Restart) must not keep the keys from the flight.
    await page.locator('[data-menu-id="restart"]').click();
    await waitPhase(page, 'ready');
    expect((await snap(page)).focus, 'the rail button let go of the focus').not.toBe('restart');
    await page.keyboard.press('Space');
    await expect.poll(async () => (await snap(page)).s.phase).toBe('flying');
    expect((await snap(page)).s.assist).toBe(true);

    // 3. Hold W: Help hands over on the key press itself.
    const t0 = Date.now();
    await page.keyboard.down('KeyW');
    const w0 = await snap(page);
    const wall = Date.now() - t0;
    expect(wall, 'key press and read-back within 150 ms').toBeLessThan(150);
    expect(w0.s.assist, 'Help off at once').toBe(false);
    // The throttle is applied on the next animation frame after the key event (one frame, ~16 ms on a GPU;
    // slower under software GL here), so poll within the response budget instead of reading synchronously.
    const frames = await page.evaluate(
      () =>
        new Promise<number[]>((res) => {
          const t0 = performance.now();
          const out: number[] = [];
          const tick = (): void => {
            out.push(Math.round(performance.now() - t0));
            if (out.length < 3) requestAnimationFrame(tick);
            else res(out);
          };
          requestAnimationFrame(tick);
        }),
    );
    const wf = (await snap(page)).s;
    testInfo.annotations.push({ type: 'frames-ms', description: frames.join(',') + ' throttle ' + wf.throttle });
    console.log('frames after W (ms):', frames.join(','), 'throttle', wf.throttle);
    expect(wf.throttle, 'engine lit within 3 rendered frames of the key press').toBeGreaterThan(0);
    expect(w0.s.lastInputSource).toBe('keyboard');
    expect(w0.s.lastInputAgeMs ?? Infinity).toBeLessThan(150);
    expect(w0.s.heldKeys).toContain('KeyW');
    expect(w0.s.litKeys, 'the W key cap lights').toContain('up');
    expect(w0.s.toast).toBe('You fly now');
    await expect(page.locator('#input-chip [data-cap="up"]')).toHaveClass(/is-on/);
    await expect(page.locator('#input-chip')).toHaveAttribute('data-engine', 'you');
    await expect(page.locator('#assist-btn')).toHaveAttribute('aria-pressed', 'false');
    const w1 = (await waitSim(page, w0.s, 0.9)).s;
    // Motion, not only flags: more engine than Help's idle, so the fall slows (vs rises).
    expect(accel(w0.s, w1), 'the W run brakes harder than the no-input Help run').toBeGreaterThan(controlAccel + 0.4);
    expect(w1.lever, 'the lever ramps while W is held').toBeGreaterThan(w0.s.lever);
    expect(w1.throttle).toBeGreaterThan(0.1);
    await page.keyboard.up('KeyW');
    // The lander levels out (Help leaned against the drift).
    await page.waitForTimeout(500);
    const w2 = await snap(page);
    expect(w2.s.litKeys).not.toContain('up');

    // 4. Hold the left arrow for 300 ms: the tilt cue shows at once, the lander leans left and
    //    the sideways speed moves left.
    const pre = w2.s;
    await page.keyboard.down('ArrowLeft');
    const l0 = await snap(page);
    expect(l0.s.heldKeys).toContain('ArrowLeft');
    expect(l0.s.litKeys).toContain('left');
    const l1 = await waitSim(page, l0.s, 0.3);
    const cueOn = await page.locator('#tilt-cmd').evaluate((el) => el.classList.contains('is-on'));
    await page.keyboard.up('ArrowLeft');
    expect(l1.s.tiltX, 'tilt command to the left').toBeLessThan(0);
    expect(cueOn, 'the tilt-ball command ring shows').toBe(true);
    const preTilt = pre.landerTilt?.x ?? 0;
    const tilt = l1.s.landerTilt?.x ?? 0;
    expect(tilt, 'the lander leans left').toBeLessThan(-2);
    expect(tilt).toBeLessThan(preTilt - 2);
    expect(l1.s.vx, 'the drift moves left').toBeLessThan(pre.vx);

    // 5. Help back on from the rail, then S: the keys still reach the flight.
    await page.locator('[data-menu-id="assist"]').click();
    await expect.poll(async () => (await snap(page)).s.assist).toBe(true);
    await expect(page.locator('#toast')).toContainText('Help flies the engine');
    expect((await snap(page)).focus).not.toBe('assist');
    await page.keyboard.down('KeyS');
    const s0 = await snap(page);
    await page.keyboard.up('KeyS');
    expect(s0.s.assist).toBe(false);
    expect(s0.s.heldKeys).toContain('KeyS');
    expect(s0.s.toast).toBe('You fly now');

    // Nothing scrolled the page.
    expect(l1.scrollY).toBe(0);
    expect((await snap(page)).scrollY).toBe(0);
    await guard.assertClean();
  });
});
