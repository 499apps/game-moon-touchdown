# GAME REVIEW - Moon Touchdown - R3 - 2026-10-30

## Scope/evidence: CODE+DOC + BUILD SCREENSHOTS (solo, automated)

- **Build:** commits fe21050 (F3), a2e790e (F4 controls), d4bd11b (baselines), 70662ce (DESIGN section 4 tables). Operator facts: typecheck and lint clean, vitest 26 files / 212 tests pass, build OK (sw.js 40d5021951e252d0, 18 files, 1510 KiB), controls e2e PASS, iPhone smoke 10 passed / 3 skipped, 0 console errors in the walkthrough.
- **Read:** `docs/DESIGN.md`, `README.md`, `LICENSES.md`, `docs/reviews/r1-review.md`, `docs/reviews/r2-review.md`, `docs/reviews/FIXLIST.md` (F1, F2, F3, F4 sections), `src/main.ts` (all), `src/input/{control,mapping,devices}.ts`, `src/hud.ts`, `src/sim/{constants,judge}.ts`, `src/sim/sites.ts` (facts), `src/sim/helper-sites.test.ts` (pilots and asserts), `src/kit/{input,loop}.ts`, `src/kit/styles.css` (test-mode rule), `src/game.css` (HUD, toast, call-out, edge arrows, phone rules), `index.html`, `e2e/controls.spec.ts`, `e2e/smoke.spec.ts`, `scripts/terrain/*` and `public/data/terrain/sites.json` (grep).
- **Images opened (11):** `shots/r3/desktop-1..5` and `desktop-3b-keys` (1280 x 720), `shots/r3/phone-1..5` (Pixel 7). Software GL, Tranquility only, automated walkthrough.
- **Not done:** no commands, no human playtest, no audio heard, sites 2 to 6 not seen, no real phone.
- **Confidence key:** H = seen in a frame, or proved from code with numbers. M = strong inference from code. L = needs a human playtest.

## Verdict / Overall

**FIX-THEN-SHIP. Overall 3.86 / 5.** The gate is not met: 1 dimension (Game feel) is at 3. All other dimensions are at 4.

F3 and F4 closed every R2 TOP-10 blocker. The low-fuel prompt now keeps its promise. Speed and fuel colours tell one story. The debrief buttons, the ring arrow and the lander stay in view. Three stars are proven on all six sites. The keyboard path is now sound and tested with real key presses.

One problem class remains, and it is the same class as the owner's Catch report. In the descent cam (above about 80 m, about half of each flight), a key press changes the HUD at once, but the lander itself barely moves on screen. The lean is about 3° at 100 ms, seen from 70° above. The plume points away from the camera. No human has flown the game yet.

No dimension is at 1. Core loop (4) and fairness (4) are above 2. REWORK is not forced.

## TOP 10 findings, highest impact first

1. **[P1] In the descent cam, steering and engine input give almost no visible response on the lander (H, desktop-3b-keys; M, code).**
   - **Evidence:** In desktop-3b-keys (W and Left held, 54% throttle, 250 m), the W and ← caps light and the throttle bar fills. The lander's lean is hard to see, and the plume is hidden under the lander. The instant tilt cue is a 4.6-unit ring on a 40 px tilt ball at the far right of the second HUD row (`index.html:57-63`, `hud.ts:251-259`). The sim lag (`TILT_TAU` 0.25 s, `constants.ts:34`) gives about 3° at 100 ms. FIXLIST F4 item 1 itself says "PARTIAL (the lander's own lean at 100 ms is small)".
   - **Player impact:** The child's eyes are on the lander, not on the HUD corner. Above 80 m, a key press seems to do nothing to the lander. This is the root cause the owner found in Catch.
   - **Fix:**
     - Add attitude-thruster puffs. `src/scene/landerModel.ts` already has corner thrusters. In `src/scene/moonScene.ts`, spawn 2 to 4 small additive sprites at the thrusters on the side opposite the lean when the tilt command changes (`lastInput.tiltX/Z` delta, or a new `cmdTilt` field in the scene update from `main.ts:973`). This is real behaviour (the real lander turned with small thrusters) and it reads from above.
     - Tint and scale the existing 52 px screen-space halo with the throttle above 90 m (warm and about 1.3× at full power). Fade the tint below 90 m, as today.
     - Draw a short chevron on the halo edge in the commanded tilt direction while a tilt key or the pad is held.
     - Add an e2e check in `e2e/controls.spec.ts`: within 3 rendered frames of `ArrowLeft`, a test-state field (for example `rcsPuffs > 0`) is set.
2. **[P1] Game feel has no human evidence, and the novice proxy does not use the real input path (H, test code).**
   - **Evidence:** The (e) novice (`helper-sites.test.ts:339-384`) computes the ideal throttle from the exact hover thrust, then adds lag and ±15% noise. It never goes through `ControlShaper`, the W/S lever rate, or the relative slider. It takes over at 150 m only. FIXLIST F3 item 11 says "A human playtest is still recommended".
   - **Player impact:** Nobody knows if a 7-year-old can hold hover with W/S at 0.85 lever/s, or with the slider near a quarter of its travel.
   - **Fix:**
     - Add a keyboard novice in `helper-sites.test.ts`: bang-bang W/S through `ControlShaper.update` (`mapping.ts:215`), 0.4 s reaction, holds a key until the speed mark crosses the middle of the green band. Take over at 300 m and at 150 m. Assert ≥ 80% soft. Do the same with slider steps of ±10% lever.
     - Run one recorded human playtest: a child or an adult who plays like a child, 3 flights on keyboard and 3 on a phone. Record: takes over from Help? lands soft in 3 tries? feels the lander answer the keys?
3. **[P2] Phone ready screen: three signals disagree on who flies (H, phone-2; H, code).**
   - **Evidence:** The tip says "Help is on, slide to take over". The chip says "You" and the Help button is not pressed. Cause: `assist` stays false until Go (`main.ts:435-438`), but the tip shows for every new touch player (`main.ts:847`).
   - **Player impact:** The first screen a new phone player sees contradicts itself. A child may tap Help to "turn it on". That works, but the trust in the chip is gone before the first flight.
   - **Fix:** In `prepareRun` (`main.ts:381`), arm Help for new players without a toast: `assist = !progress.solo;` then `renderAssist(); renderChip();`. The chip then says "Help", the button is pressed, and the tip is true. Engine input at ready already starts the flight, and `handover` turns Help off on the next frame with "You fly now". Add an e2e check on the ready screen: `#input-chip[data-engine]` matches the tip.
4. **[P2] The "You fly now" toast is invisible in every test-mode frame, and no test checks that it shows (H, code; H, desktop-3b-keys).**
   - **Evidence:** The kit pauses every animation at its first keyframe in test mode (`kit/styles.css:582-586`). `mt-toast-in` starts at `opacity: 0` (`game.css:537-541`). The interim rule (`game.css:1656-1660`) covers the debrief card, the stars and the call-out, but not `.mt-toast`. The e2e checks only the text (`controls.spec.ts:82, 127, 163`). This is why desktop-3b-keys has no toast (operator note 3). The class is set with `&live=1` too (`kit/shell.ts:47`).
   - **Real play:** The toast fades in over 220 ms and stays 1.8 s of game time (`main.ts:104`, `game.css:512-531`), at the top left under the chip. That is fine on a GPU. 1.8 s is short for a young reader, but the chip keeps the "You" state.
   - **Fix:** Add `html.g499-test .mt-toast` to the interim rule. In `controls.spec.ts`, assert `getComputedStyle(#toast).opacity === '1'` after W. Raise `TOAST_TIME` to 2.5 s. Close the kit F-13 change (`animation: none` in test mode).
5. **[P2] On phones the toast and the call-out share one slot that can cover the third HUD row (M, code and phone-2/phone-3 geometry).**
   - **Evidence:** Both use `top: calc(130px + safe-top)` on phones (`game.css:1525-1528`). In phone-2 and phone-3 the HUD wraps to 3 rows and ends at about 149 CSS px. The fuel gauge starts at about 189 CSS px from the left. "Help flies the engine" starts at 14 px and is about 230 px wide, so it overlaps the fuel gauge. A call-out and a toast at the same moment also overlap each other.
   - **Player impact:** For 1.8 s the fuel reading can hide, at the moment the engine changes hands.
   - **Fix:** In `measureHud()` (`main.ts:1019`), write `--mt-hud-bottom` on `.game-app`. Use `top: calc(var(--mt-hud-bottom) + 10px)` for both, and put the toast one row below the call-out when both show. Add an e2e check that the toast and `#hud` boxes do not intersect on the Pixel and iPhone projects.
6. **[P2] The main phone controls (slider and pad) have no e2e test (H, test code).**
   - **Evidence:** The mobile projects tap only the Help button (`smoke.spec.ts:130, 237`). The low-fuel test flies with `keyboard.down('KeyW')` on phones too (`smoke.spec.ts:224`). No test drags `#throttle` or `#tilt-pad`. The controls spec is desktop Chromium only (`controls.spec.ts:65`).
   - **Player impact:** The keyboard path was proved. The touch path, which most children use, was not. It is the same risk as the Catch report.
   - **Fix:** Add `e2e/touch.spec.ts` for the iPhone and Pixel projects (`?test=1&live=1`). Drag `#throttle` up 60 px with pointer events: expect `assist` false, `lever` up, toast "You fly now", `throttle > 0` within 3 frames. Drag on `#tilt-pad` to the left: expect `tiltX < 0`, then `landerTilt.x < -2` within 0.3 s sim time. A tap on the slider must not change `lever` (F-26). Expect `scrollY` 0 and no zoom.
7. **[P2] The marker edge arrow sits on top of the visible marker (H, phone-4, desktop-4).**
   - **Evidence:** In phone-4 (37 m) the green down arrow covers the marker ring. In desktop-4 (23 m) it sits just above the marker. `controlsBottom()` (`main.ts:1036-1042`) counts the bottom 30% (portrait touch) or 120 px as off-frame, so `placeEdge` clamps the arrow onto a marker that the player can see.
   - **Player impact:** Two symbols mark one spot, and the arrow hides the marker colour near touchdown.
   - **Fix:** In `updateEdges` (`main.ts:1086-1094`), treat the marker as on screen when its projected point is inside the stage and not under the slider, pad or Help button boxes. Or hide the marker arrow when the clamp point is within 40 px of the projected point.
8. **[P3] The HUD fuel rounds up, but the debrief and the star round down (H, code).**
   - **Evidence:** HUD: `Math.ceil` (`hud.ts:234`). Debrief: `Math.floor` (`judge.ts:103`). Star: `>= 30` exact (`judge.ts:58`). At 29.4 s the HUD shows "30" on the star tick, then the debrief says "29 s" and no star. The walkthrough shows the split: 19 s on desktop-5, 20 s on phone-5.
   - **Player impact:** A child who watched "30" feels cheated at the exact edge of the hardest star.
   - **Fix:** Use `Math.floor` in `hud.ts:234`, or show one decimal below 35 s.
9. **[P3] The predicted marker jumps far and turns red during a short key press (M, desktop-3b-keys; M, code).**
   - **Evidence:** The predictor holds the current input for up to 110 s (`main.ts:920`, DESIGN section 3). With W held at 54% (above hover) and a lean held, the ghost trail leaves the frame and the marker arrow is coral at the left edge (desktop-3b-keys).
   - **Player impact:** A child who steers toward the ring sees a red "danger" signal for doing the right thing.
   - **Fix:** In `predictTouchdown` (`src/sim/predictor.ts`), decay the held tilt to the helper's lean and the held throttle to hover over about 1.5 s while a key is held. Or colour the marker by the vertical outcome only while input is live. Keep the property test against the full sim for the no-input case.
10. **[P3] Terrain provenance in the docs does not match the script (H, grep; open since R1 F-19).**
    - **Evidence:** `scripts/terrain/fetch.py:1` says "LDEM_1024 (30 m spacing)" and has no Gaussian step. `SOURCE.md:6`, `LICENSES.md:16-18` and `sites.json:85` say a σ 1.6 px Gaussian was applied. No `sha256` per file.
    - **Player impact:** None in play. For an open-source "real data" game, a reader cannot reproduce the files.
    - **Fix:** Do F-19 as written: add the Gaussian, fix the header, write hashes, re-run and compare.

## SCORES

| # | Dimension | Weight | Score | Conf. | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Core loop & clarity of goal | 14% | 4 | H | Pick, ready, fly, debrief, Again all work in both form factors. Ring or ring arrow on screen at every e2e sample (`smoke.spec.ts:148`). Ring, marker and lander in one frame at 257 m (desktop-3, phone-3). Again / Next / Sites in view (desktop-5, phone-5). Not 5: the goal "steer to the ring" depends on a steering response that is hard to see above 80 m (finding 1). |
| 2 | Onboarding / first-time experience | 10% | 4 | M | Help on by default (`main.ts:435`), key-cap ready tip (desktop-2), first-flight key hint after 3 s idle (`main.ts:648-669`), "How to fly" with key caps (`index.html:116-125`), hero lander above Go (phone-2). Gaps: the phone ready screen contradicts itself (finding 3); desktop hero about 32 px (desktop-2). |
| 3 | Feedback & readability | 14% | 4 | M | One colour language (`hud.ts:81-105`): 12.0 m/s green at 257 m (desktop-3), 11.2 m/s with a yellow band in manual flight (desktop-3b). Lemon fuel while Help flies (desktop-4 32 s, phone-4 37 s). Input chip with lit caps (desktop-3b). Ring arrow inside the stage (desktop-4, phone-3, phone-4). Gaps: marker arrow on the marker (finding 7), toast slot on phones (finding 5), ceil/floor fuel (finding 8), red marker while steering (finding 9). |
| 4 | Game feel | 14% | 3 | M | Strong code: first-press lever step and 0.85/s ramp (`mapping.ts:18-23, 215-233`), 50 ms key tilt slew, handover on the key event (`main.ts:489-501`), no jump on hand-back (`main.ts:451`), relative slider, dust, hum layers, haptics. e2e proves motion. But above 80 m the lander does not visibly answer the keys (finding 1, desktop-3b), and no human has flown it (finding 2). Any CONTROLS CHECK fail would cap this at 3; none failed. |
| 5 | Realism vs real data and physics | 12% | 4 | H | g, thrust, Isp, mass flow and hover time exact (see REALISM CHECK). LOLA heights at true scale. 16 facts all true and kid-appropriate. Honest simplifications are complete (DESIGN section 9). Not 5: provenance does not match the script (finding 10). |
| 6 | Difficulty & fairness | 10% | 4 | M | Helper 96/96 soft with 13.2-22.9 s left, 0 fuel stars. Prompt from `assistFuelNeed` (`main.ts:620-642`), tested at the prompt moment on every site (c2) and in e2e (`smoke.spec.ts:199-249`). Efficient pilot 0 red steps. 3 stars proven on every site (7 to 16 of 16 seeds). Kind words, helper-specific fuel-out line (`judge.ts:88-93`). Gap: finding 8. |
| 7 | Visual polish & presentation | 10% | 4 | M | Crater cast-shadow crescents read well (desktop-3, phone-3). Charming close-up with a friendly face, gold foil and plume (desktop-4, phone-4). Ground glow visible at 37 m (phone-4). Earth and stars in the ready shot. Gaps: desktop hero small in the ready shot; small steps on the horizon at the right of phone-2; the descent cam frame is a flat grey field with a small lander. |
| 8 | Replayability | 5% | 4 | M | 6 sites unlock in order, 3 stars proven possible everywhere, helper mark, "Helper would have left ~M s", rotating facts. No ghost of the best run (F-23). |
| 9 | Accessibility & phone play | 7% | 4 | M | Debrief fits with "More" fold (phone-5). Arrows fully on screen (phone-3, phone-4). Go no longer covers the lander (phone-2). Touch targets 56 px or more, safe areas, reduced-motion rules (`game.css:1703-1725`), key handling without scroll or lost focus. Gaps: findings 3, 5, 6; dense debrief text for age 7. |
| 10 | Technical polish & privacy | 4% | 4 | H | 212 unit tests, real-terrain fuel tables, real-keyboard e2e that found and fixed a real focus bug, offline SW, `g499:` storage only, no external requests (operator). Gaps: toast invisible in test mode (finding 4), one iPhone timeout under load, F-19 open, `frame-ancestors` absent from the CSP meta (`index.html:5`). |

**Weighted mean:**
0.14·4 + 0.10·4 + 0.14·4 + 0.14·3 + 0.12·4 + 0.10·4 + 0.10·4 + 0.05·4 + 0.07·4 + 0.04·4
= 0.56 + 0.40 + 0.56 + 0.42 + 0.48 + 0.40 + 0.40 + 0.20 + 0.28 + 0.16 = **3.86**

## REALISM CHECK

| Item | Game | Real / check | Result |
| --- | --- | --- | --- |
| Lunar gravity | 1.62 m/s² (`constants.ts:10`) | 1.62 m/s² | **MATCHES** |
| Engine thrust | 45,000 N (`constants.ts:20`) | About 45,040 N (10,125 lbf) at full | **MATCHES** |
| Isp / exhaust speed | 311 s, 3,049.9 m/s | About 311 s (vacuum) | **MATCHES** |
| Mass flow | 45,000 / 3,049.9 = 14.75 kg/s at full | About 14.7 kg/s | **MATCHES** |
| Hover time | 177 kg / (4,477 · 1.62 / 3,049.9) = 74.4 s; HUD 75 s (desktop-2, ceil) | Maths correct; uses current mass (about 9% conservative, disclosed) | **MATCHES** |
| Hover throttle | 4,477 · 1.62 / 45,000 = 16.1%; desktop-3 shows 16%; DESIGN says 15.5 to 16.8% | Real lander about 25 to 30% (disclosed, DESIGN section 9) | **MATCHES** (disclosed) |
| Fuel amount | 177 to 232 kg | Real propellant was several tonnes; scaled and disclosed | **MATCHES** (disclosed) |
| Landing limits | vs < 2.0 m/s, hs < 1.2 m/s, tilt < 10°, slope < 12° (`constants.ts:42-51`) | Real gear about 3 m/s down, about 1.2 m/s sideways, about 12° | **MATCHES** (stricter vs is fine for teaching) |
| Attitude | 45°/s, τ 0.25 s | Real manual rates slower (about 20°/s), disclosed | **MATCHES** (disclosed) |
| LOLA terrain | LDEM_512, 256 x 256 at 60 m, 15.3 km, exaggeration 1.0 | 512 px/deg ≈ 59 m/px; relief plausible | **MATCHES** (data). **PARTIAL** provenance (finding 10) |
| Crater look | Decorative detail map with baked cast-shadow crescents toward the fixed sun | Real 12° sun gives black crater shadows; decoration is disclosed | **MATCHES** (disclosed) |
| Sky | Earth low at 3.5°, stars visible | Both disclosed as view choices (DESIGN section 9) | **MATCHES** (disclosed) |
| Tranquility | July 1969, flat old lava; laser mirror in use; footprints last; crew at about 0.5 m/s | All true (about 1.7 ft/s) | **MATCHES**, kid-appropriate |
| Ocean of Storms | Nov 1969, near a 1967 robot lander, parts brought home; biggest dark lava plain; no storms, no air | All true | **MATCHES** |
| Fra Mauro | Feb 1971, two golf balls; two-wheeled cart; hills are far-impact ejecta | All true | **MATCHES** |
| Descartes | Apr 1972, old highland rocks; rover about 17 km/h | True (R2 fix applied, `sites.ts:131`) | **MATCHES** |
| Taurus-Littrow | Dec 1972 last people, orange glass beads; whole-Earth photo; massifs about 2 km | All true; matches the data | **MATCHES** |
| Hadley | July 1971 first car, rille 1 to 1.5 km; hammer and feather; white rock about 4 billion years | All true | **MATCHES** |
| Gravity card | 1.62 vs 9.81, "about one sixth" | 9.81 / 1.62 = 6.06 | **MATCHES** |
| Trademarks | No mission, crew, agency or brand names in the UI; NASA only in data attribution with "no endorsement" (`README.md:88-89`). Original toy lander. | | **MATCHES** |

## CONTROLS CHECK

| Check | Result | Evidence |
| --- | --- | --- |
| (a) Every key gives a visible response within about 100 ms | **PASS** (with finding 1) | W: the chip cap lights on the key event (`main.ts:489-501`); the lever steps to 0.08 (10% throttle) on the next frame (`mapping.ts:219`); the HUD throttle follows `state.throttle` on that frame (`hud.ts:263-265`). e2e: `lastInputAgeMs < 150` and throttle > 0 within 3 rendered frames (`controls.spec.ts:106-124`). Arrows: lit cap and the tilt-ball command ring at once (`hud.ts:251-259`, `controls.spec.ts:150-153`). Caveat: the lander itself leans about 3° at 100 ms and is hard to see in the descent cam (desktop-3b-keys). |
| (b) Help never overrides the player without showing it | **PASS** | Engine input while Help flies turns Help off on the key event (`main.ts:494-497`) or on the frame for touch and stick (`main.ts:898-899`). Help never moves the lever after that (`control.ts:131-134`). The Help button and rail item un-press, the chip switches to "You" (desktop-3b), the toast says "You fly now". Tilt keeps Help on the engine, and the chip shows "Help" with lit arrow caps. Caveat: the toast is invisible in test-mode frames (finding 4). |
| (c) HUD input indicator and clear key prompts | **PASS** | Chip with device, who flies and caps (desktop-2, desktop-3, desktop-3b, phone-2). Ready tip with W, ←, →, Space caps (desktop-2, `index.html:99`). "How to fly" key caps (`index.html:118-125`). First-flight key hint (`main.ts:648-669`, `control.ts:211-213`). |
| (d) e2e with real `page.keyboard` on the built site, asserting motion | **PASS** | `controls.spec.ts`: real `keyboard.down/up` on `vite preview`, `?test=1&live=1`. Asserts that the W run brakes ≥ 0.4 m/s² harder than the Help run, that the lever ramps, a lean of more than 2° left, and vx moves left (`:131-158`). Desktop Chromium only. |
| (e) Arrows and Space never scroll; focus loss after a click does not drop keys | **PASS** | `KeyTracker` prevents every flight key and its repeats while the flight owns the keys (`control.ts:46-58`). The kit prevents the first press (`kit/input.ts:306`). The Space repeat is held back (`control.ts:50-52`). A pointer click blurs the button through `composedPath()` (`main.ts:1208-1217`). Keys clear on blur and on hide (`devices.ts:51-54`). e2e: focus leaves rail Restart and rail Help, and `scrollY` stays 0 (`controls.spec.ts:90, 164, 173-174`). The big Help button and Go use the same code path but have no e2e. |

No FAIL, so no cap. Dimension 4 is at 3 for finding 1 and finding 2, not for a cap.

## FUEL CHECK

- **Is the fuel star earned? YES (H).** The helper leaves 13.2 to 22.9 s over 96 runs with 0 fuel stars. The star needs 30 s, so the gap is at least 7 s. The walkthrough agrees: 1 star with 19 to 20 s (desktop-5, phone-5).
- **Is it reachable? YES (M).** A HUD-only efficient pilot keeps 41 to 55 s on every site with 0 red steps. The ring + thrifty pilot gets 3 stars on 16/15/14/11/10/7 of 16 seeds (DESIGN section 4). These are scripted pilots. A child's success rate is unverified (finding 2).
- **Is low fuel kind? YES (H, code; not seen in frames).**
  - The "tap Help" prompt shows only while the helper's real need is covered (`main.ts:620-642`). Help at that moment lands softly on every site (test c2, e2e prompt test).
  - "Brake now" shows only when it is too late for Help and the fall is fast.
  - While Help flies: lemon "Fuel star gone. Help still lands safely." (`main.ts:534-536`), and the fuel bar stays lemon (desktop-4, phone-4).
  - A helper fuel-out blames Help, not the child (`judge.ts:88-93`). The manual fuel-out text is kind and has a tip.
  - One edge is unkind: the HUD can show "30" when the star is lost (finding 8).

## R2 FIX STATUS

| R2 finding | Status | Evidence |
| --- | --- | --- |
| 1 Low-fuel prompt promise | FIXED | `lowFuelPrompt` + `assistFuelNeed` (`main.ts:620-642`); test c2 on every site; e2e prompt timing (`smoke.spec.ts:199-249`); helper fuel-out line (`judge.ts:88-93`). |
| 2 Debrief buttons below the fold | FIXED | desktop-5, phone-5; e2e `fullyInView` (`smoke.spec.ts:168-170`). |
| 3 Fuel-star technique in the red | FIXED | Manual stop limit (`hud.ts:81-105`); pilots (b) and (d) assert 0 red steps; tip text matches (`judge.ts:99`). |
| 4 Ring arrow clipped | FIXED | Circle-anchored arrow, inner label (`game.css:555-571`); fully inside in desktop-4, phone-3, phone-4. |
| 5 Lander under the HUD at 28-40 m | FIXED | Top limit in `flightPose`; lander below the HUD at 22.9 m (desktop-4) and 37.4 m (phone-4); e2e `landerOnScreen` below 60 m. |
| 6 Red fuel alarms in helper flight | FIXED | Lemon bar at 32 s and 37 s (desktop-4, phone-4); lemon call-out (`main.ts:534-536`). |
| 7 3 stars unproven | FIXED | Test (d) and the DESIGN section 4 table: 3 stars on every site. |
| 8 Flat crater lighting, straight horizon | PARTIAL | Crescents read well (desktop-3, phone-3). The horizon is softer, but small steps show at the right of phone-2. |
| 9 Small hero, Go covers it | PARTIAL | Phone FIXED (phone-2). Desktop hero still about 32 px (desktop-2). |
| 10 Docs and tip drift | FIXED | Hover 15.5-16.8% (DESIGN:221), key-cap tip (desktop-2), fuel pill gone, Descartes 17 km/h. |

| FIXLIST id (open after R2) | Status | Evidence |
| --- | --- | --- |
| F-01 goal in frame | FIXED | See R2 findings 4 and 5. |
| F-03 ground look | PARTIAL | Looks right in frames. The kit luminance metric is not added. |
| F-04 seam dashes | PARTIAL | No dashes in any R3 frame. The black-pixel test is not added. |
| F-09 who steers | PARTIAL | Copy with tilt icon (desktop-5, phone-5); pulse at 200 m in code. Optional "helper steers too" level not done. |
| F-13 test-mode opacity | PARTIAL | Game-local rule; the toast is a new case (finding 4); kit rule not changed. |
| F-17 phone picker | FIXED (game-local) | phone-1: "How to fly" visible, no overlap. Kit rule not changed. |
| F-19 terrain provenance | OPEN | Finding 10. |
| F-21 touchdown cue | FIXED | Ground glow around the marker at 37 m (phone-4). |
| F-23 replay honesty | PARTIAL | Helper marks done; no ghost trail. |
| F-25 wider e2e | PARTIAL | On-screen asserts in every project; Tranquility only; no touch-control drag test (finding 6). |
| F-30 honest simplifications | FIXED | DESIGN:245 has the right hover %. |
| F-31 Clear data in the 720 px rail | OPEN | desktop-1: the rail ends at Privacy (kit). |

## DIMENSIONS BELOW 4: the smallest changes to reach 4

- **4 Game feel (3 → 4):**
  1. Finding 1: attitude-thruster puffs on a tilt command change, and a throttle tint on the lander halo above 90 m. Add the e2e field for the puffs.
  2. Finding 2: a keyboard and slider novice through `ControlShaper` in `helper-sites.test.ts` (≥ 80% soft from a 300 m takeover).
  3. One recorded human playtest (3 keyboard flights, 3 phone flights). Write the answers into DESIGN section 11.
  4. Recommended in the same round: finding 6 (touch e2e), so both input paths have the same proof.

## WHAT'S WORKING (keep)

- **The keyboard path:** first-press step, fast ramp, handover on the key event, physical key codes, no scroll, no stuck keys, focus release after a click. The real-key e2e found a real bug, and the fix is in place.
- **The input chip:** it says who flies and lights the held keys (desktop-3b). It is the right answer to "did my key work?".
- **Fair fuel:** the helper is safe but misses the star. The prompt promises only what is true. Help is never blamed on the child.
- **One colour language:** green, yellow and red mean the same thing in the HUD, the tips and the scripted pilots.
- **Framing:** ring, marker, lander and arrows stay in the usable frame on desktop and phone, and e2e proves it.
- **The lander close-up:** a friendly face, gold foil, springy legs and plume (desktop-4, phone-4).
- **The debrief:** lemon stars, honest helper copy, fuel line with the star, chart, Moon map, real-crew line, talk question. The buttons are always in view.
- **Real data and true facts:** 16 accurate facts, exact physics constants, complete honest simplifications.

## OPEN QUESTIONS / UNVERIFIED

1. **Human playtest:** none. Game feel, lever feel near hover (0.85/s) and the star difficulty for a child are unverified (L).
2. **Operator note 1 (phone ready mismatch):** confirmed. See finding 3.
3. **Operator note 2 (lean hard to see at 250 m):** confirmed. The keys arrive and the HUD reacts, but the lander barely moves on screen. See finding 1.
4. **Operator note 3 (toast missing in desktop-3b):** a test-mode artefact, not a real-play defect. The toast lasts 1.8 s at the top left. See finding 4.
5. **Operator note 4 (no playtest):** the (e) proxy is not the real input path. See finding 2.
6. **Toast overlap on phones:** inferred from geometry, not seen in a frame (finding 5).
7. **Other sites:** sites 2 to 6 not seen (look, slopes near the ring, arrow behaviour at 250 to 450 m offsets).
8. **Software GL:** are the ground glow, plume and bloom the same on a real GPU and a mid phone? No real-device frame time yet.
9. **CSP:** `frame-ancestors` is still absent from the meta (`index.html:5`). Confirm it is a kit decision (Chrome logs an error for it in a meta tag) and record it in the kit docs.
10. **Privacy and offline:** zero external requests and offline reload come from the operator's facts. I ran nothing.
11. **Help button position:** the big Help button sits bottom-right on desktop. I read it as a gameplay control, not a menu, so the left-menu rule holds. Confirm with the owner.
