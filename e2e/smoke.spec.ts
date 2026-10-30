import { expect, test, type Page } from '@playwright/test';
import { guardPage, hasWebgl, readState, stepFrames, waitForReady } from '../src/kit/smoke/helpers';
import { defineSmokeSuite } from '../src/kit/smoke/suite';
import { palette } from '../src/kit/theme';
import { DRY_MASS, EXHAUST_VELOCITY, G_MOON } from '../src/sim/constants';

/** '#rrggbb' to the computed-style form 'rgb(r, g, b)'. */
function cssRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

defineSmokeSuite([
  {
    name: 'moon-touchdown',
    path: '/games/moon-touchdown/',
    webgl: true,
    swScope: '/games/moon-touchdown/',
    manifest: { scope: '/games/moon-touchdown/', startUrl: '/games/moon-touchdown/' },
    // Keys and touches reach the game even while the site picker is open (they count as input).
    play: { keys: ['KeyW', 'Space', 'KeyD'], swipes: ['up', 'left'], tap: false },
    clearSelector: '[data-menu-id="clear"]',
  },
]);

interface MoonTestState {
  actions: number;
  phase: 'pick' | 'ready' | 'flying' | 'landed';
  site: string;
  loading: boolean;
  altitude: number | null;
  vs: number;
  hs: number;
  fuelSeconds: number;
  outcome: 'soft' | 'bumpy' | null;
  stars: number;
  tick: number;
  paused: boolean;
  assist: boolean;
  helped: boolean;
  solo: boolean;
  ringOnScreen: boolean;
  markerOnScreen: boolean;
  ringArrowOnScreen: boolean;
  landerOnScreen: boolean;
  landerPx: { x: number; y: number };
  hudBottom: number;
  fuelNeed: number | null;
  lowFuelPrompt: 'help' | 'brake' | null;
  promptShown: 'help' | 'brake' | null;
  debrief: boolean;
  unlocked: number;
  stepFrames: number;
}

/** Below this height (m) the lander must be on screen, below the HUD band. */
const LOW_CHECK_HEIGHT = 60;
/** Fine steps (frames) near the ground, so the low-altitude checks see several frames. */
const FINE_STEP = 30;

/** Fuel (kg) for a number of hover-seconds at the start (inverse of fuelSeconds). */
function fuelKgFor(seconds: number): number {
  return (seconds * G_MOON * DRY_MASS) / (EXHAUST_VELOCITY - seconds * G_MOON);
}

/** Pick the first site and wait for the ready screen. */
async function pickTranquility(page: Page, hasTouch: boolean): Promise<void> {
  const card = page.locator('.mt-site[data-slug="tranquility"]');
  if (hasTouch) await card.tap();
  else await card.click();
  // The terrain file loads (from the network or the service worker cache).
  await expect
    .poll(async () => (await readState<MoonTestState>(page)).phase, { timeout: 20_000 })
    .toBe('ready');
}

/** The element's box is fully inside the viewport. */
async function fullyInView(page: Page, selector: string): Promise<boolean> {
  const vp = page.viewportSize();
  const box = await page.locator(selector).boundingBox();
  if (!vp || !box) return false;
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 0.5 && box.y + box.height <= vp.height + 0.5;
}

test.describe('moon-touchdown round', () => {
  test('picks a site, lands softly with the hover helper and shows the debrief', async ({
    page,
    baseURL,
    hasTouch,
  }) => {
    const guard = guardPage(page, page.context(), baseURL ?? 'http://localhost');
    await page.goto('/games/moon-touchdown/?test=1');
    await waitForReady(page);
    test.fixme(
      !(await hasWebgl(page)),
      'WebGL is not available in this engine on this host, so the game loop does not run',
    );
    let s = await readState<MoonTestState>(page);
    expect(s.phase).toBe('pick');
    await expect(page.locator('#picker')).toBeVisible();
    // Only the first site is open on a fresh profile.
    await expect(page.locator('.mt-site.is-locked')).toHaveCount(5);

    const card = page.locator('.mt-site[data-slug="tranquility"]');
    if (hasTouch) await card.tap();
    else await card.click();
    // The terrain file loads (from the network or the service worker cache).
    await expect
      .poll(async () => (await readState<MoonTestState>(page)).phase, { timeout: 20_000 })
      .toBe('ready');
    await expect(page.locator('#picker')).toBeHidden();
    await expect(page.locator('#hud')).toBeVisible();
    s = await readState<MoonTestState>(page);
    expect(s.site).toBe('tranquility');
    expect(s.altitude ?? 0).toBeGreaterThan(300);

    // Ready shot: the hero is on screen, below the HUD, and the Go button does not cover it.
    await stepFrames(page, 2);
    s = await readState<MoonTestState>(page);
    expect(s.landerOnScreen, 'lander on screen in the ready shot').toBe(true);
    const go = await page.locator('#go-btn').boundingBox();
    expect(go).not.toBeNull();
    if (go) {
      const covered =
        s.landerPx.x >= go.x && s.landerPx.x <= go.x + go.width && s.landerPx.y >= go.y && s.landerPx.y <= go.y + go.height;
      expect(covered, 'the Go button covers the lander').toBe(false);
    }

    // Hover helper on and go: the big button on phones, Space on desktop.
    if (hasTouch) await page.locator('#assist-btn').tap();
    else await page.keyboard.press('Space');
    await stepFrames(page, 2);
    s = await readState<MoonTestState>(page);
    expect(s.phase).toBe('flying');
    expect(s.assist).toBe(true);

    // The helper flies down by itself. High up, each call runs up to 600 fixed steps (10 s of
    // flight); near the ground it steps half a second at a time. Every sample checks the goal is
    // shown (the ring, or its edge arrow fully inside the stage); low down the lander must be on
    // screen, below the HUD band.
    let lowSamples = 0;
    for (let i = 0; i < 160 && s.phase === 'flying'; i++) {
      const alt = s.altitude ?? 0;
      await stepFrames(page, alt > LOW_CHECK_HEIGHT * 2 ? s.stepFrames : FINE_STEP);
      s = await readState<MoonTestState>(page);
      if (s.phase !== 'flying') break;
      const at = `at ${Math.round(s.altitude ?? 0)} m`;
      expect(s.ringOnScreen || s.ringArrowOnScreen, `ring or ring arrow on screen ${at}`).toBe(true);
      if ((s.altitude ?? 0) < LOW_CHECK_HEIGHT) {
        lowSamples++;
        expect(s.landerOnScreen, `lander on screen below the HUD ${at}`).toBe(true);
      }
    }
    expect(s.phase, 'the lander touched down').toBe('landed');
    expect(lowSamples, 'samples below 60 m').toBeGreaterThan(2);
    expect(s.outcome).toBe('soft');
    expect(s.stars).toBeGreaterThanOrEqual(1);
    expect(s.unlocked).toBe(2);

    // The debrief follows once the dust settles.
    await stepFrames(page, 120);
    s = await readState<MoonTestState>(page);
    expect(s.debrief).toBe(true);
    await expect(page.locator('#debrief')).toBeVisible();
    await expect(page.locator('#outcome-title')).toContainText('touchdown');
    await expect(page.locator('#next-site')).toBeEnabled();
    // "One more try" is always in view: Again, Next and Sites fully inside the viewport.
    for (const id of ['#retry', '#next-site', '#open-sites']) {
      expect(await fullyInView(page, id), `${id} fully inside the viewport`).toBe(true);
    }
    // One fuel readout only (the old fuel pill is gone).
    await expect(page.locator('#stat-fuel')).toHaveCount(0);

    // What the player sees: the card and the earned stars are fully opaque (test mode freezes
    // animations, so this checks the end state is shown), and an earned star is lemon yellow.
    const look = await page.evaluate(() => {
      const opacity = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).opacity : null;
      };
      const svg = document.querySelector('.mt-star.is-on svg');
      return {
        card: opacity('#debrief .mt-debrief-card'),
        star: opacity('.mt-star.is-on'),
        starColor: svg ? getComputedStyle(svg).color : null,
      };
    });
    expect(look.card, 'debrief card opacity').toBe('1');
    expect(look.star, 'earned star opacity').toBe('1');
    expect(look.starColor, 'earned star colour').toBe(cssRgb(palette.lemon));
    expect(
      await page.evaluate(() => localStorage.getItem('g499:moon-touchdown:progress')),
      'progress saved under the g499 prefix',
    ).not.toBeNull();

    await guard.assertClean();
  });

  test('the low-fuel prompt says "tap Help" only while Help can still land softly', async ({
    page,
    baseURL,
    hasTouch,
  }) => {
    const guard = guardPage(page, page.context(), baseURL ?? 'http://localhost');
    await page.goto('/games/moon-touchdown/?test=1');
    await waitForReady(page);
    test.fixme(!(await hasWebgl(page)), 'WebGL is not available in this engine on this host');
    await pickTranquility(page, hasTouch);
    let s = await readState<MoonTestState>(page);
    const need = s.fuelNeed ?? Number.NaN;
    expect(Number.isFinite(need), 'helper fuel need at the start').toBe(true);

    // Same start (test seed, first run), with a tank about 3 s above what the helper needs.
    await page.goto(`/games/moon-touchdown/?test=1&fuel=${fuelKgFor(need + 3).toFixed(2)}`);
    await waitForReady(page);
    await pickTranquility(page, hasTouch);
    s = await readState<MoonTestState>(page);
    const need2 = s.fuelNeed ?? Number.NaN;
    console.table([{ 'need (s)': need, 'need with small tank (s)': need2, 'fuel (s)': s.fuelSeconds }]);
    expect(s.fuelSeconds).toBeGreaterThanOrEqual(need2);
    expect(s.fuelSeconds).toBeLessThan(need2 + 6);

    // Fly by hand (the W key starts a manual flight): the prompt comes at once.
    await page.keyboard.down('KeyW');
    await stepFrames(page, 3);
    await page.keyboard.up('KeyW');
    await stepFrames(page, 2);
    s = await readState<MoonTestState>(page);
    expect(s.phase).toBe('flying');
    expect(s.assist).toBe(false);
    expect(s.lowFuelPrompt).toBe('help');
    expect(s.promptShown).toBe('help');
    await expect(page.locator('#callout')).toBeVisible();
    await expect(page.locator('#callout')).toContainText('Help');

    // The child taps Help now: the promise holds, the landing is soft.
    if (hasTouch) await page.locator('#assist-btn').tap();
    else await page.keyboard.press('Space');
    await stepFrames(page, 2);
    s = await readState<MoonTestState>(page);
    expect(s.assist).toBe(true);
    for (let i = 0; i < 40 && s.phase === 'flying'; i++) {
      await stepFrames(page, s.stepFrames);
      s = await readState<MoonTestState>(page);
    }
    expect(s.phase).toBe('landed');
    expect(s.outcome, 'Help landed softly after the prompt').toBe('soft');
    await guard.assertClean();
  });

  test('pause holds the lander still', async ({ page, baseURL }) => {
    const guard = guardPage(page, page.context(), baseURL ?? 'http://localhost');
    await page.goto('/games/moon-touchdown/?test=1');
    await waitForReady(page);
    test.fixme(!(await hasWebgl(page)), 'WebGL is not available in this engine on this host');
    await page.locator('.mt-site[data-slug="tranquility"]').click();
    await expect
      .poll(async () => (await readState<MoonTestState>(page)).phase, { timeout: 20_000 })
      .toBe('ready');
    await page.locator('#go-btn').click();
    await stepFrames(page, 30);
    let s = await readState<MoonTestState>(page);
    expect(s.phase).toBe('flying');
    expect(s.tick).toBeGreaterThan(0);
    await page.keyboard.press('KeyP');
    await stepFrames(page, 2);
    s = await readState<MoonTestState>(page);
    expect(s.paused).toBe(true);
    await expect(page.locator('#pause')).toBeVisible();
    const tick = s.tick;
    await stepFrames(page, 60);
    expect((await readState<MoonTestState>(page)).tick).toBe(tick);
    await guard.assertClean();
  });
});
