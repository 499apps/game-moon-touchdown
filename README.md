# game-moon-touchdown

**Moon Touchdown** for 499apps Games: fly a lander down to real Moon landing sites and touch down gently before the fuel runs out.
It plays at `https://499apps.com/games/moon-touchdown/`.

- Pick one of six real sites. They go from the flat Sea of Tranquility to the deep valley at Taurus-Littrow and the winding Hadley Rille.
- The ground is real: LRO LOLA laser altimeter heights, at true scale.
- Use the engine and tilt to slow down and stop the sideways drift. Touch down under 2 m/s.
- The speed-down gauge follows the height: fast is fine high up, slow near the ground. When you fly by hand, yellow means "fast but you can still stop" and red means "brake now".
- Edge arrows point to the target ring and to the predicted touchdown when they are out of view.
- Fuel counts in seconds of hovering. Chimes sound at 60 s and 30 s. The first crew heard the "30 seconds" fuel call just before they touched down.
- Get up to three stars: a soft touchdown, inside the green ring, and 30 s of fuel left (the star tick on the fuel bar). Help always lands safely but uses too much fuel for the fuel star. To earn it, fly the engine yourself: fall fast in the yellow up high, then brake hard before the red. A soft touchdown opens the next site.
- Low on fuel when you fly by hand? While Help can still land safely, a prompt says "Low fuel: tap Help to land safely". When it is too late for Help and you fall fast, it says "Brake now". The debrief shows your fuel left and what Help would have left.
- After each landing, the debrief shows your descent chart, your touchdown numbers, a Moon map with the site, a fact about the site, a "you vs the real crew" line and a "Talk about it" question for the family.
- The **Help** button turns on the hover helper. It flies the engine gently and stops the drift. The child steers to the ring.
  New players start with Help on until they land softly once without it. Moving the throttle takes over the engine.
  Best stars won with Help get a small helper mark on the site card.

## The privacy promise

- The game collects nothing. No accounts, ads, analytics, cookies or trackers.
- The game reads its own terrain files from the same site. It makes no other network calls and links to no other site.
- Your progress (open sites, best stars, whether Help flew the best run) and the touch-pad setting stay on your device, in `localStorage` keys that start with `g499:moon-touchdown:`.
- On Android phones, the touchdown gives a short buzz (`navigator.vibrate`). It uses no network.
- "Clear my data" in the left menu (hold the button) removes all `g499:` keys.
- After the first visit, the game works offline. The service worker keeps the terrain files too.

## Controls

| Action | Touch | Keyboard | Gamepad |
| --- | --- | --- | --- |
| Engine up and down | Drag the left slider up or down (a tap changes nothing) | W / S | Left stick up and down, or RT / LT |
| Tilt (lean the lander) | Drag on the right pad | Arrow keys or I J K L (A / D and E / Q also work) | Right stick |
| Help (hover helper) on or off | Big round "Help" button | Space | A |
| Start | Go button, or any engine or tilt input | Space (starts with Help on) | A |
| Pause | Menu button (left) | P or Escape | Start |
| Sound | Left menu | M | |

Turn the on-screen slider and pad on or off in the left menu ("Touch pad"). They are on by default on touch screens.
"How to fly" in the left menu shows the same table with icons.

## Code map

| Path | What it does |
| --- | --- |
| `src/sim/` | Pure flight model, no three.js: constants, lander dynamics, terrain sampling, landing judge, stars, hover helper, predictor, sites |
| `src/input/mapping.ts` | Pure mapping of keys, sticks and touch to engine and tilt commands |
| `src/input/devices.ts` | Held keys, gamepad reading and the touch slider and pad |
| `src/scene/` | three.js scene: terrain levels of detail, baked sun shadows, lander, plume, dust, sky, camera |
| `src/hud.ts`, `src/graphs.ts` | Flight readouts (height-aware speed bands) and the debrief chart |
| `src/edgeArrows.ts` | Edge arrows to the ring and the predicted touchdown when they are out of view |
| `src/moonMap.ts` | The small Moon map with the site dot, drawn in code |
| `src/progress.ts` | Open sites, best stars and helper marks in the kit storage (schema v2, migrates v1) |
| `src/main.ts` | Page wiring: rail items, site picker, run flow, debrief, sounds, test API |
| `public/data/terrain/` | Six terrain grids (`<site>.bin`) and `sites.json` |
| `scripts/terrain/` | The script that cut the terrain grids and their provenance (`SOURCE.md`) |
| `docs/DESIGN.md` | Design, physics, realism notes and honest simplifications |

Unit and property tests (Vitest + fast-check) cover the physics, the terrain sampling, the judge, the predictor, the hover helper (also on the real terrain of all 6 sites), input mapping, the HUD bands, the edge arrows and storage.
All randomness uses the kit's seeded PRNG, so a seed plus an input script replays the same flight.

## Run it

Use Node 20.19 or later and pnpm 10.

```sh
pnpm install
pnpm exec playwright install chromium firefox webkit   # once, for the smoke tests
pnpm dev            # http://localhost:5176/games/moon-touchdown/
pnpm build          # dist/ with icons, terrain data and this game's own service worker
pnpm preview        # http://localhost:4176/games/moon-touchdown/
pnpm ci:local       # typecheck, lint, unit tests, scan:secrets, build, smoke tests
```

Test mode: open `/games/moon-touchdown/?test=1`. The clock freezes, the seed is fixed and `window.__g499` lets tests step frames and read the state.

## How it fits into 499apps.com/games

- Standalone, the game registers its own service worker (scope `/games/moon-touchdown/`) and manifest.
- The hub repo (`499apps/games`) builds this repo with `VITE_ASSEMBLED=1`.
  Then the page uses the hub manifest and the single `/games/sw.js` worker.
- `src/kit/` is a vendored copy of `499apps/games-kit`. Do not edit it here. Run `pnpm kit:sync`.

## Terrain data

The heights come from NASA's Lunar Reconnaissance Orbiter laser altimeter (LOLA). The data is in the public domain.
See `scripts/terrain/SOURCE.md` for the product, the processing and the citation. No NASA logos or endorsement are implied.

## Licence

MIT. See `LICENSE`. Third-party packages and data are in `LICENSES.md`.
