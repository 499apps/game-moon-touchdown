import { expect, test } from '@playwright/test';
import { guardPage, hasWebgl, readState, stepFrames, waitForReady } from '../src/kit/smoke/helpers';
import { defineSmokeSuite } from '../src/kit/smoke/suite';
import { palette } from '../src/kit/theme';

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
  debrief: boolean;
  unlocked: number;
  stepFrames: number;
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

    // Hover helper on and go: the big button on phones, Space on desktop.
    if (hasTouch) await page.locator('#assist-btn').tap();
    else await page.keyboard.press('Space');
    await stepFrames(page, 2);
    s = await readState<MoonTestState>(page);
    expect(s.phase).toBe('flying');
    expect(s.assist).toBe(true);

    // The helper flies down by itself. Each call runs up to 600 fixed steps (10 s of flight).
    for (let i = 0; i < 40 && s.phase === 'flying'; i++) {
      await stepFrames(page, s.stepFrames);
      s = await readState<MoonTestState>(page);
    }
    expect(s.phase, 'the lander touched down').toBe('landed');
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
