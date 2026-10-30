# Third-party licences

This project is MIT licensed (see `LICENSE`). This file lists every third-party package and data set.

Assets: there are no third-party image or sound assets. The app icons, UI icons, lander, Earth,
regolith detail and foil textures are original art drawn in code (`src/kit/scripts/lib/icon-art.mjs`,
`src/icons.ts`, `src/scene/`). Sounds are synthesised at runtime with WebAudio. Text uses the system
font stack.

## Data

| Data | Licence | Use |
| --- | --- | --- |
| NASA Lunar Reconnaissance Orbiter, Lunar Orbiter Laser Altimeter (LOLA) gridded elevation, LDEM_512 (512 px/deg, about 59 m/px), PDS bundle urn:nasa:pds:lro_lola_rdr (DOI 10.17189/tnyt-7007), Smith, D.E. and Neumann, G.A. | Public domain (PDS archive data; NASA science data is CC0 unless marked otherwise) | Terrain heights in `public/data/terrain/*.bin` |

Processing and sources are in `scripts/terrain/SOURCE.md`: bilinear resample to a 256 x 256 grid at
60 m spacing per site, a light Gaussian across columns to soften track striping, heights relative to
the site centre in 0.5 m units. No NASA logos or endorsement are implied.

## Bundled into the game

| Package | Licence | Use |
| --- | --- | --- |
| three (three.js), including `three/examples/jsm` add-ons (EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass, RoomEnvironment, RoundedBoxGeometry) | MIT, Copyright 2010-2026 three.js authors | 3D rendering |
| `src/kit/` (499apps games-kit) | MIT, Copyright (c) 2026 499apps | Shared runtime (vendored) |

## Development only (not shipped)

| Package | Licence |
| --- | --- |
| typescript | Apache-2.0 |
| vite | MIT |
| vitest | MIT |
| fast-check | MIT |
| @playwright/test, playwright | Apache-2.0 |
| eslint, @eslint/js | MIT |
| typescript-eslint | MIT |
| eslint-config-prettier | MIT |
| globals | MIT |
| prettier | MIT |
| @types/node, @types/three | MIT |

The terrain cutting script (`scripts/terrain/fetch.py`) runs outside the build and is not shipped.

## Rules

- Only MIT, CC0, OFL or Apache-2.0 code may be added. Assets must be CC0 or MIT. Data must be public domain or CC0.
- Add every new dependency or data set to this file in the same change.
