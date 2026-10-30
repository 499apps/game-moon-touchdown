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
  solo: boolean;
  rcsPuffs: number;
  haloThrottle: number;
  altitude: number | null;
  vsBand: 'slow' | 'good' | 'warn' | 'bad';
  /** R4 findings 1, 2 and 4 (src/main.ts testState). */
  markerBand: 'good' | 'warn' | 'bad' | null;
  kickMs: number;
  cmdThrottle: number;
  hoverLever: number | null;
  keyToFrameMs: number | null;
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

/** Wait for n rendered frames (requestAnimationFrame), then read the state. Returns the frame times (ms) too. */
async function afterFrames(page: Page, n: number): Promise<{ frames: number[]; snap: Snap }> {
  const frames = await page.evaluate(
    (count) =>
      new Promise<number[]>((res) => {
        const t0 = performance.now();
        const out: number[] = [];
        const tick = (): void => {
          out.push(Math.round(performance.now() - t0));
          if (out.length < count) requestAnimationFrame(tick);
          else res(out);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
  return { frames, snap: await snap(page) };
}

/**
 * Start an in-page log of the game state on every rendered frame (R4 finding 4). The game's own
 * frame callback was queued first, so each entry is the state after that frame's update().
 */
async function startFrameLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __g499?: { state?: () => unknown }; __mtFrames?: unknown[] | null };
    const log: unknown[] = [];
    w.__mtFrames = log;
    const tick = (): void => {
      if (w.__mtFrames !== log) return;
      log.push(w.__g499?.state ? w.__g499.state() : {});
      if (log.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrameLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __mtFrames?: unknown[] | null }).__mtFrames = null;
  });
}

/**
 * The first n logged frames from the first one with `key` held (that frame's update() applied the
 * key), and the frame before it. Waits until n such frames exist.
 */
async function framesFromKey(page: Page, key: string, n: number): Promise<{ prior: ControlsState | null; frames: ControlsState[] }> {
  let out: { prior: ControlsState | null; frames: ControlsState[] } = { prior: null, frames: [] };
  await expect
    .poll(
      async () => {
        out = await page.evaluate(
          ([k, count]) => {
            const log = ((window as unknown as { __mtFrames?: unknown[] | null }).__mtFrames ?? []) as ControlsState[];
            const i = log.findIndex((s) => Array.isArray(s.heldKeys) && s.heldKeys.includes(k));
            if (i < 0) return { prior: null, frames: [] };
            return { prior: i > 0 ? (log[i - 1] ?? null) : null, frames: log.slice(i, i + count) };
          },
          [key, n] as const,
        );
        return out.frames.length;
      },
      { timeout: 15_000, intervals: [50] },
    )
    .toBeGreaterThanOrEqual(n);
  return out;
}

/** The marker colour that goes with a HUD speed band in manual flight up high (R4 finding 1). */
function markerOf(band: ControlsState['vsBand']): 'good' | 'warn' | 'bad' {
  return band === 'slow' ? 'good' : band;
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
    // A new player: Help is armed on the ready screen, and the chip and the Help button say so (R3 finding 3).
    const ready = (await snap(page)).s;
    const who = ready.solo ? 'you' : 'help';
    await expect(page.locator('#input-chip')).toHaveAttribute('data-engine', who);
    await expect(page.locator('#assist-btn')).toHaveAttribute('aria-pressed', ready.solo ? 'false' : 'true');
    expect(ready.assist).toBe(!ready.solo);

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
    // Help already burns about 16% here, so "throttle > 0" would pass without W (R4 finding 4): read
    // the throttle before W, and log every rendered frame in the page (no Playwright IPC in the timing).
    const before = (await snap(page)).s;
    await startFrameLog(page);
    const t0 = Date.now();
    await page.keyboard.down('KeyW');
    const w0 = await snap(page);
    const wall = Date.now() - t0;
    // MP1 item 3: the response checks are in-page only (keyToFrameMs and the frame log below). The wall
    // time is Playwright IPC (over 1 s with 6 parallel workers), so it is logged, and only a real hang fails.
    console.log(`keydown + read-back wall time, IPC included (ms): ${wall}`);
    expect(wall, 'key press and read-back did not hang').toBeLessThan(10000);
    expect(w0.s.assist, 'Help off at once').toBe(false);
    // The first 3 rendered frames that applied W. The sim steps at a fixed 60 Hz, so the check reads
    // the engine command of each frame (cmdThrottle, what the next sim step uses).
    const wLog = await framesFromKey(page, 'KeyW', 3);
    await stopFrameLog(page);
    const base = wLog.prior?.throttle ?? before.throttle;
    const rise = Math.max(...wLog.frames.map((s) => s.cmdThrottle)) - base;
    const kickSeen = wLog.frames.some((s) => s.kickMs > 0 || s.haloThrottle >= 0.35);
    const wf = wLog.frames[wLog.frames.length - 1] as ControlsState;
    testInfo.annotations.push({ type: 'w-frames', description: `rise ${rise.toFixed(4)} kick ${wLog.frames.map((s) => Math.round(s.kickMs)).join(',')}` });
    console.log('3 frames after W: throttle rise', rise.toFixed(4), 'kick ms', wLog.frames.map((s) => s.kickMs).join(','), 'halo', wf.haloThrottle);
    expect(rise, 'the engine rises by 0.005 or more within 3 rendered frames of W').toBeGreaterThanOrEqual(0.005);
    // On the lander itself, high up: the engine kick shows the press on the plume glow and the halo (R4 finding 2).
    expect(kickSeen, 'the engine kick (or a warm halo of 0.35 or more) within 3 rendered frames of W').toBe(true);
    // The toast is fully shown in test frames too (R3 finding 4).
    expect(await page.locator('#toast').evaluate((el) => getComputedStyle(el).opacity), 'toast opacity').toBe('1');
    expect(w0.s.lastInputSource).toBe('keyboard');
    // Game-side latency: from the keydown handler to the first update() that applied the key.
    await expect.poll(async () => (await snap(page)).s.keyToFrameMs, { timeout: 15_000, intervals: [50] }).not.toBeNull();
    const keyMs = (await snap(page)).s.keyToFrameMs ?? Infinity;
    console.log('keydown to the first update that applied W (ms):', keyMs.toFixed(1));
    expect(keyMs, 'W is applied in the game 120 ms or less after the key event').toBeLessThanOrEqual(120);
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
    const r0 = (await snap(page)).s;
    // 3b. The hover notch (R4 finding 4): hands off, the lever slides back into the notch (about
    // 0.2 s from full) and then the speed holds. The game runs in real time, so poll.
    const notchGap = (s: ControlsState): number => (s.hoverLever === null ? Infinity : Math.abs(s.lever - s.hoverLever));
    await expect.poll(async () => notchGap((await snap(page)).s), { timeout: 15_000, intervals: [50] }).toBeLessThanOrEqual(0.01);
    const n0 = (await snap(page)).s;
    expect(n0.time - r0.time, 'the lever reaches the notch within 1 s of letting go').toBeLessThanOrEqual(1);
    const n1 = (await waitSim(page, n0, 1)).s;
    console.log('notch: lever', n1.lever.toFixed(4), 'hover lever', n1.hoverLever, 'speed change over 1 s', (n1.vs - n0.vs).toFixed(3));
    // Within 0.01 (LEVER_NOTCH_EPS); the notch drifts a hair per frame as fuel burns, hence the 1e-4.
    expect(notchGap(n1), 'hands off: the lever stays in the hover notch').toBeLessThanOrEqual(0.01 + 1e-4);
    expect(Math.abs(n1.vs - n0.vs), 'hands off: the speed holds within 0.3 m/s over 1 s').toBeLessThanOrEqual(0.3);
    // R4 finding 1: in a correct manual descent up high the marker shows the HUD speed band, not "bumpy".
    expect(n1.assist).toBe(false);
    expect(n1.altitude ?? 0, 'still above the strict height').toBeGreaterThan(10);
    expect(n1.markerBand, 'the marker colour follows the HUD speed band').toBe(markerOf(n1.vsBand));
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
    // On the lander itself: attitude-thruster puffs within 3 rendered frames (R3 finding 1).
    const lf = await afterFrames(page, 3);
    console.log('frames after ArrowLeft (ms):', lf.frames.join(','), 'puffs', lf.snap.s.rcsPuffs);
    expect(lf.snap.s.rcsPuffs, 'thruster puffs within 3 rendered frames of ArrowLeft').toBeGreaterThan(0);
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
