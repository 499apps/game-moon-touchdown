# Contributing

Thank you for your help. Read these rules before you open a pull request.

## Local CI only

- This project has no GitHub Actions. Do not add a `.github/workflows` folder.
- Run `pnpm ci:local` before you open a pull request. It must pass.
- New visual baselines: run `pnpm e2e:update`, check the images, and commit them.

## Clean-room and licensing

- Write original code for public game mechanics. Do not copy code, sprites, sounds or ROMs.
- Do not use trademarked names, logos or brand trade dress. Use generic names ("lander", "Moon Touchdown").
- Do not add space agency logos, mission patches or mission brand names to the UI. Plain site names and dated facts are fine.
- Third-party code must be MIT, CC0, OFL or Apache-2.0. Assets must be CC0 or MIT. Data must be public domain or CC0.
- List every bundled package, asset or data set in `LICENSES.md`.

## Terrain data

- Terrain comes only from public-domain LOLA products. Record the source and the processing in `scripts/terrain/SOURCE.md`.
- Keep the grid format: 256 x 256 int16 little-endian, 60 m spacing, 0.5 m units, row 0 = north.
- Decoration (the small seeded craters in the detail map) must never change the heights the lander touches.

## Privacy rules

- No network requests after load, except reads of this game's own files under its base path (the terrain files).
  The service worker precache of same-origin files is the only other exception.
- No analytics, cookies, ads, accounts, fingerprinting or external links.
- Store data in `localStorage` only, through the kit storage. Every key starts with `g499:`.
- Keep the Content-Security-Policy meta tag. No inline scripts, no `'unsafe-eval'`.
- Do not commit secrets, personal e-mail addresses or absolute user paths. `pnpm scan:secrets` checks this.

## Kid-friendly rules

- No violence and no explosions. A hard touchdown is a "bumpy landing": the legs go boing, and the debrief explains kindly.
- Playable with no reading. Touch targets are 56 px or larger.
- Respect `prefers-reduced-motion`. Pause when the page is hidden.

## Design rule: menus on the left

- All menus and settings go in the left rail (tablet and desktop).
- On phones, the rail becomes a left drawer. A left-edge button opens it.
- Never put menus top-right or on the right side. HUD readouts may go where gameplay needs them.
- The touch throttle slider sits to the right of the rail, so it never covers the menu.

## Shared kit

- `src/kit/` is vendored from `499apps/games-kit`. Do not edit it here.
- Change the kit in its repo, run `pnpm kit:sync` here, and commit `src/kit/` and `kit.lock`.

## Code style

- TypeScript strict mode. Prettier formats the code (`pnpm format`).
- Keep the flight model in pure modules (`src/sim/`, no three.js) with Vitest tests. Randomness goes through the kit PRNG.
