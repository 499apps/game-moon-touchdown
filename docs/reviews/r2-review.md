# GAME REVIEW - Moon Touchdown - R2 - 2026-10-30

## Scope/evidence: CODE+DOC + BUILD SCREENSHOTS (solo, automated)

- **Build:** commit 240a723 on `main` (F2). Operator facts: typecheck and lint clean, vitest 24 files / 178 tests pass, build OK, 18 precached files, about 1.49 MB, 0 console errors in the walkthrough.
- **Read:** `docs/DESIGN.md`, `README.md`, `LICENSES.md`, `docs/reviews/r1-review.md`, `docs/reviews/FIXLIST.md` (with "F1 changes" and "F2 fuel"), `src/sim/{constants,sites,judge,assist,flight,lander}.ts`, `src/sim/helper-sites.test.ts`, `src/hud.ts`, `src/edgeArrows.ts`, `src/main.ts` (run flow, prompt, debrief, edge insets), `src/scene/moonScene.ts` (camera), `src/game.css`, `index.html`, `e2e/smoke.spec.ts` (grep), `scripts/terrain/*` (grep), `public/data/terrain/sites.json` (grep).
- **Images opened (10):** `shots/r2/desktop-1..5` (1280 x 720) and `shots/r2/phone-1..5` (Pixel 7). Software GL, helper flight on Tranquility, no human input.
- **Not done:** no commands, no human playtest, no audio heard, sites 2 to 6 not seen.
- **Confidence key:** H = seen in a frame or proved from code with numbers. M = strong inference from code. L = needs a human playtest.

## Verdict / Overall

**FIX-THEN-SHIP. Overall 3.45 / 5.** The gate is not met: 5 dimensions are at 3.

F1 and F2 fixed the big R1 defects. The goal is now in frame, the stars are lemon, the ground reads as Moon ground, and fuel matters. The fuel star is earned, not free. What blocks the gate now is trust and readability at the edges of the loop:

- The low-fuel prompt promises a safe landing that the helper cannot always give.
- The fuel-star technique flies in the red band of the speed gauge.
- The Again / Next / Sites buttons are below the fold on desktop and on phones.
- The ring arrow is clipped at the left edge, and the lander slides under the HUD at 28 to 40 m on desktop.

No dimension is at 1. Core loop is 4 and fairness is 3, so REWORK is not forced.

## TOP 10 findings, highest impact first

1. **[P1] The low-fuel prompt makes a promise the helper cannot keep (H, code).**
   - **Evidence:** `main.ts:683` shows "Low fuel: tap Help to land safely" at a fixed 15 s (`LOW_FUEL_PROMPT_SECONDS`, `constants.ts:63`). `assistFuelNeed` (`assist.ts:85`) is not used in `main.ts`. From the formula: need at 30 m and 3 m/s down is about 16.8 s; at 100 m and 7.5 m/s it is about 34 s. So the promise is true only below about 25 m.
   - **Player impact:** A child who hovered high taps Help as told. The helper runs dry and the landing is bumpy. Then the debrief says "Out of fuel up high: start braking a bit later next time" (`main.ts:530-534`), which blames the child for what the helper did. This breaks trust in Help, the main safety net.
   - **Fix:**
     - Add a pure `lowFuelPrompt(fuelSeconds, need)` in `src/sim/assist.ts`. It returns `'help'` when `fuelSeconds < need + 6` and `fuelSeconds >= need`, `'brake'` when `fuelSeconds < need`, and `null` otherwise.
     - In `update()` call it with `assistFuelNeed(f.altitude, vy, hs, hoverThrottle(f.state))`. For `'brake'`, show "Brake now: slide up" with the slider icon, not "land safely".
     - In `showDebrief`, when `helpedRun && fuelOutHeight !== null`, show a helper-specific line: "Help started too late to save fuel. Tap Help earlier next time."
     - Add a case to `helper-sites.test.ts` (c): take over at the moment the prompt fires, and expect a soft landing.
2. **[P1] The debrief buttons are below the fold (H, desktop-5, phone-5).**
   - **Evidence:** At 1280 x 720, Again / Next / Sites are cut off at the bottom (desktop-5). On Pixel 7 no button shows, and "Talk about it" is also below the fold (phone-5). The card is a scroll box (`game.css:749-757`, `max-height: calc(100dvh - 32px)`, `overflow-y: auto`) and nothing shows that it scrolls.
   - **Player impact:** "One more try" is the loop's hook, and a non-reader cannot find it. The card looks like a dead end.
   - **Fix:** Make `.mt-debrief-actions` sticky (`position: sticky; bottom: 0;` with the card background and a top fade) inside `.mt-debrief-card`. Or move the actions directly under the stars. On phones (max-width 719px), fold the chart and the fact card into a "More" disclosure. Add an e2e check that the Again button's bounding box is fully inside the viewport in every project.
3. **[P1] The fuel-star technique flies in the red band (H, code).**
   - **Evidence:** The documented efficient pilot holds 20 m/s high up and brakes late (`helper-sites.test.ts:125-164`). The debrief tip says "fall faster up high, then brake later and harder" (`judge.ts:85`). Above 175 m, `vsLimits` gives green < 12.5 and yellow < 14.5 m/s (`hud.ts:57-62`), so 20 m/s is red. At 40 m the braking curve is about 18.6 m/s against a red line of 6.4 m/s. In manual flight the red mark blinks (`game.css:167-174`).
   - **Player impact:** The game teaches "red = wrong", then rewards flying in the red. A child either ignores the HUD or never earns the star.
   - **Fix:** Pick one of these:
     - (a) Make red mean "real danger". In `vsLimits`, when the helper is off, set red where the stopping distance at about 60% of the spare thrust, `down² / (2 · 0.6 · (g/hover − g))`, is more than about 70% of the height. Keep yellow as "fast but stoppable".
     - (b) Keep the bands and change the tip to "Fly in the yellow for the fuel star". Add a test pilot that holds the yellow edge. My estimate for Tranquility: about 35 s flight and about 35 s fuel left (M).
4. **[P2] The ring arrow is clipped at the left edge (H, desktop-4, phone-3, phone-4).**
   - **Evidence:** `.mt-edge` shifts the whole arrow-plus-label group by −50% (`game.css:392`). The 44 px circle therefore sits about 30 px left of its anchor point. The left inset is only 28 px (desktop) or 44 px (phone) (`main.ts:782`). The circle goes under the rail (desktop-4) or off the screen (phone-3, phone-4).
   - **Player impact:** The pointer to the goal, the most important cue in a helper flight, is half hidden.
   - **Fix:** Anchor the circle, not the group. Use `transform: translate(-22px, -50%)`, and use `flex-direction: row-reverse` when `x > width/2` so the label is always on the inner side. Set the side insets to at least the circle radius plus 8 px. In e2e, check that the `#edge-ring` box is inside the stage box.
5. **[P2] The lander goes under the top HUD from about 28 to 40 m, desktop landscape only (H, desktop-4 plus maths).**
   - **Evidence:** At 34 m, `flightPose` (`moonScene.ts:519-539`) gives elevation 13°, distance 30.5 m and an angle to the ground point of 54°. The ground-point clamp forces a pitch of 35° or more (line 536). The lander is then about 22° above the frame centre, about 33 px from the top, under the 58 px HUD. The span from lander to ground point (41°) is wider than the usable 48° FOV minus the margins and the HUD band. Portrait (62° FOV) is fine (phone-4).
   - **Player impact:** The legs and the plume are hidden at the start of the flare.
   - **Fix:** In `flightPose`, also limit the pitch from the top: `pitch <= toLander + half - hudAngle`, where `hudAngle` comes from the HUD height in pixels. When both limits conflict, increase `dist` until the span fits. Add `landerOnScreen` to the test state and check it at 18, 34 and 60 m.
6. **[P2] Every correct helper landing ends with red fuel alarms (H, code; M, not in frames).**
   - **Evidence:** The helper lands with 13 to 23 s left. So the 30 s call-out (coral `'bad'` band, `main.ts:398`) and the red fuel bar (`hud.ts:193-197`) fire in the last 10 s of every default new-player flight.
   - **Player impact:** This is the same mixed signal that R1 found for the speed gauge: red while "everything is fine". It comes exactly when a young child is most tense.
   - **Fix:** When the helper is on, show the 30 s call-out as `'warn'` with "Fuel star gone. Help still lands safely." Keep the fuel bar lemon. Do this with an `.mt-hud[data-assist='on'] .mt-fuel[data-band='bad']` rule, like the existing speed-blink rule. Keep red for manual flight.
7. **[P2] The full 3 stars are not proven possible on any site (H, test code).**
   - **Evidence:** Test (b) asserts fuel only on sites 1 to 3 (`helper-sites.test.ts:262-269`). Its pilot never steers to the ring. No test proves ring plus fuel together, and sites 4 to 6 are "printed only". The DESIGN per-site table still shows "calc" values (`DESIGN.md:127-134`).
   - **Player impact:** The third star on the hard sites may be out of reach, and that kills the reason to replay.
   - **Fix:** Add a "ring + thrifty" scripted pilot. Use a position-velocity lean toward (0, 0), at most 12°, only while the engine pushes. Assert 3 stars on at least 1 seed per site, and a median fuel left of 33 s or more on sites 1 to 3 (a margin for human error). If a site fails, add about 2.5 kg per missing second while the helper stays under 25 s. Copy the measured tables into DESIGN section 4 and the FIXLIST.
8. **[P2] The ground lighting is flat, and the horizon is a straight tile edge (H, desktop-2, desktop-3, phone-2, phone-3).**
   - **Evidence:** The sun is 12° high, so real regolith would show black shadows inside craters. The detail craters are only a normal map and brightness map, so they read as soft dimples in plaster. The horizon is the straight 15.3 km edge of the data tile: tilted in desktop-2, with small steps in phone-2.
   - **Player impact:** The game does not reach the site's "absolute banger" bar. The real-data relief loses its drama.
   - **Fix:**
     - The sun is fixed per site, so in `makeRegolithDetail` (`src/scene/textures.ts`) bake a cast-shadow crescent into each crater's albedo on the side toward the sun, for the unrotated scale only. Or add a 3-tap height-march toward the sun in the `terrainView` `onBeforeCompile` shader.
     - Fade the outer 1.5 km of the far mesh down a little and darken it into a soft curved horizon, so the cut edge does not show.
9. **[P2] The hero is small in the opening shot and the Go button covers it on phones (H, desktop-2, phone-2).**
   - **Evidence:** The lander is about 20 px tall on desktop and sits on top of the Go button on Pixel 7 (`READY_BACK = 150`, `moonScene.ts:93`).
   - **Player impact:** The first frame does not introduce the character.
   - **Fix:** On portrait, use `READY_BACK` of about 70 m, and use about 100 m on landscape. Or move `.mt-go` down to just above the ready tip on portrait.
10. **[P3] The docs and the ready tip have drifted from the build (H).**
    - **Hover throttle:** DESIGN says hover is "about 19%", "about a third of the way up" (`DESIGN.md:195`) and "17 to 19%" (`DESIGN.md:215`). With F2 fuel it is m·1.62/45,000 = 15.5 to 16.8%; desktop-3 shows 16%. The lever position is k = √((0.16 − 0.1)/0.9) ≈ 0.26, so about a quarter of the way up.
    - **Ready tip:** It says "slide to take over" on desktop with the touch pad off (`index.html:93`). Keyboard players need W/S.
    - **Debrief:** It shows the fuel twice: the "20 s" pill and "Fuel left: 20 s" (desktop-5).
    - **Fix:** Update the numbers. Show a "W" key-cap when the touch pad is off. Remove the fuel pill.

## SCORES

| # | Dimension | Weight | Score | Conf. | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Core loop & clarity of goal | 14% | 4 | M | Pick, ready, fly, debrief works. Ring, marker and lander are all in frame at 257 m (desktop-3). The edge arrow covers the rest. Fuel now creates tension (F2). The helper copy says who steers (desktop-5). The Again button below the fold is scored under 3 and 9. |
| 2 | Onboarding / first-time experience | 10% | 4 | M | Help is on by default (`main.ts:355`). The "Help is on, slide to take over" tip has icons (desktop-2, phone-2). The labelled Help button pulses once. The establishing shot shows the Earth and the horizon. Gaps: the lander is tiny and covered by Go on phones; the tip says "slide" on desktop. |
| 3 | Feedback & readability | 14% | 3 | M | Good: height-aware speed bands (12.0 m/s is green at 257 m, desktop-3), the fuel star tick, the drift dial, the marker, the debrief chart. Weak: the ring arrow is clipped (desktop-4, phone-3/4), the lander is under the HUD at 34 m (desktop-4), red alarms come in correct helper flight, the fuel-star technique is red, the marker is only about 14 px at 257 m (desktop-3). |
| 4 | Game feel | 14% | 3 | L | The code is sound: relative slider (F-26), lever curve, tilt lag, no jump on hand-back, Android buzz, dust sheets, plume, halo, hum layers. Nobody has flown it by hand. Frames are static. The lander is hidden under the HUD during the flare on desktop. FIXLIST says a playtest is needed for 4. |
| 5 | Realism vs data and physics | 12% | 4 | H | g, thrust, Isp and mass flow are exact (`constants.ts`). Hover time is 74.4 s for 177 kg, and the HUD shows 75 (desktop-2). LOLA heights at true scale. Facts are accurate (see REALISM CHECK). Gaps: F-19 provenance, hover % in the docs is stale, crater shading has no cast shadows. |
| 6 | Difficulty & fairness | 10% | 3 | M | The helper lands softly in 96 of 96 runs (16 seeds × 6 sites). Bump texts are kind (`judge.ts:99-104`). The fuel star is earned (helper 13.2 to 22.9 s, star at 30 s). But: the low-fuel prompt can break its promise and then blame the child; the star technique contradicts the HUD; 3 stars are not proven on any site. |
| 7 | Visual polish & presentation | 10% | 3 | M | Big step up from R1: grey regolith with varied craters, no visible tiling or seams, Earth and stars in the ready shot, a charming close-up lander (phone-4), glossy UI. Still: flat crater lighting, a straight tile-edge horizon, a beacon that reads as a streak on the ground (desktop-3), a tiny hero in the opening frame, no lander shadow or ground glow visible at 19 to 34 m. |
| 8 | Replayability | 5% | 4 | M | 6 real sites unlock in order, 3 stars, helper marks, rotating facts, a "Helper would have left ~M s" target (`main.ts:583-594`). The fuel star is now a real goal. No ghost of the best run (F-23). 3 stars are unproven on sites 4 to 6. |
| 9 | Accessibility & phone play | 7% | 3 | H | Touch targets 56 px or more, safe-area insets, left drawer, reduced-motion rules (`game.css:1421-1437`), portrait framing that keeps the marker above the controls (phone-4). Defects: no debrief buttons on screen (phone-5), the arrow off the screen (phone-3/4), Go covers the lander (phone-2), dense debrief text for age 7. |
| 10 | Technical polish & privacy | 4% | 4 | H | Pure sim, determinism, 178 unit tests, property tests, offline service worker, CSP meta, `g499:` storage only, 0 console errors. Gaps: e2e does not assert `ringOnScreen`, `markerOnScreen` or debrief buttons in view. No test for the prompt timing. F-19 is open. `frame-ancestors` is missing from the CSP meta (see open questions). |

**Weighted mean:**
0.14·4 + 0.10·4 + 0.14·3 + 0.14·3 + 0.12·4 + 0.10·3 + 0.10·3 + 0.05·4 + 0.07·3 + 0.04·4
= 0.56 + 0.40 + 0.42 + 0.42 + 0.48 + 0.30 + 0.30 + 0.20 + 0.21 + 0.16 = **3.45**

## REALISM CHECK

| Item | Game | Real / check | Result |
| --- | --- | --- | --- |
| Lunar gravity | 1.62 m/s² (`constants.ts:10`) | 1.62 m/s² | **MATCHES** |
| Engine thrust | 45,000 N | About 45,040 N (10,125 lbf) at full | **MATCHES** |
| Isp / exhaust speed | 311 s → 3,049.9 m/s | About 311 s (vacuum) | **MATCHES** |
| Mass flow | F/(Isp·g0) = 14.75 kg/s at full | About 14.7 kg/s | **MATCHES** |
| Hover time | 177 kg / (4,477 · 1.62 / 3,049.9) = 74.4 s. The HUD shows 75 s (ceil, desktop-2). | Maths is correct. It uses the current mass (about 9% conservative), as disclosed. | **MATCHES** |
| Hover throttle | 15.5 to 16.8% with F2 fuel (desktop-3: 16%) | DESIGN still says "about 19%" and "17 to 19%". The real lander hovered at about 25 to 30%. | **PARTIAL** (stale docs; the game value is disclosed) |
| Fuel amount | 177 to 232 kg | Real propellant was several tonnes. Disclosed as scaled (DESIGN section 9). | **MATCHES** (disclosed) |
| Landing limits | vs < 2.0, hs < 1.2, tilt < 10°, slope < 12° | Real leg design about 3 m/s down (10 ft/s), about 1.2 m/s sideways, about 12° slope. vs is stricter, which is fine for teaching. | **MATCHES** |
| LOLA heights and scale | LDEM_512, 60 m, 256², 15.3 km, exaggeration 1.0 | 512 px/deg ≈ 59.2 m/px; relief values are plausible (Taurus-Littrow massifs +2,133 m) | **MATCHES** (data). **PARTIAL** provenance: `fetch.py:1` still says "LDEM_1024 (30 m)" and the script has no Gaussian step. `sites.json` has a `processing` field but no hashes (F-19). |
| Crater look | Decorative normal and brightness maps; baked shadows only for large relief | At a 12° sun, real craters have black, sharp shadows inside | **PARTIAL** (art, not data; decoration is disclosed) |
| Sky | Earth low at 3.5°, stars visible | The Earth is high overhead at these sites (disclosed). A sunlit surface exposure would not show stars (not disclosed). | **PARTIAL** (add the stars to section 9) |
| Tranquility facts | July 1969, old dark lava; a laser mirror still in use; footprints last | All true | **MATCHES**, kid-appropriate |
| Tranquility crew line | "touched down here at about 0.5 m/s" | About 1.7 ft/s ≈ 0.5 m/s (M) | **MATCHES** |
| Ocean of Storms | November 1969, near a 1967 robot lander, parts brought home; biggest dark lava plain; "no storms, no air" | All true | **MATCHES** |
| Fra Mauro | February 1971, two golf balls; two-wheeled tool cart; hills are ejecta from a far impact | All true | **MATCHES** |
| Descartes | April 1972, old highland rocks; rover "fastest run about 18 km/h" | The 18 km/h record is usually credited to the December 1972 drive at Taurus-Littrow. This site's top speed was about 17 km/h (M). | **PARTIAL**: say "about 17 km/h", or move the 18 km/h fact to Taurus-Littrow |
| Taurus-Littrow | Last people, December 1972, orange glass beads; whole-Earth photo on the way; massifs about 2 km | All true; matches the data (+2,133 m) | **MATCHES** |
| Hadley | First car driven by people, July 1971, rille 1 to 1.5 km; hammer and feather; white rock about 4 billion years old | All true (F-12 fixed) | **MATCHES** |
| Gravity card | 1.62 vs 9.81, "about one sixth" | 9.81 / 1.62 = 6.06 | **MATCHES** |
| Trademarks | `src/**`, `index.html`, manifest: no Apollo, NASA, mission or crew names (grep is empty). NASA appears only in data attribution with "no endorsement". The lander is an original toy design. | | **MATCHES** |

## FUEL CHECK

- **Is the star earned? YES (H).** The helper leaves 13.2 to 22.9 s over 16 seeds × 6 sites, with 0 fuel stars. The star needs 30 s, so the gap is at least 7 s. The walkthrough agrees: soft, 20 s left, 1 star (desktop-5, phone-5). A scripted efficient pilot keeps 30 s or more on sites 1 to 3 (asserted).
- **Is it reachable? PARTIAL (M).** The proof uses a perfect script that does not steer to the ring, and only on sites 1 to 3. A human must also fly in the red band to copy it (finding 3). Ring plus fuel together is not proven anywhere (finding 7).
- **Is low fuel kind? PARTIAL.**
  - The words are kind: "So close!", "start braking a bit later", "Help can also fly the engine" (`judge.ts:71-82`), and no shaming words (tested).
  - The 15 s prompt promises a safe landing that the helper often cannot give above about 25 m (finding 1).
  - A helper fuel-out is blamed on the child's braking.
  - Every correct helper landing hears a red "30 seconds of fuel" alarm (finding 6).
  - The low-fuel prompt is not in any frame (helper flight). Its look is unverified.

## R1 FIX STATUS

| Id | Status | Evidence |
| --- | --- | --- |
| F-01 camera / goal in frame | PARTIAL | The descent cam works: ring, marker and lander are in frame at 257 m (desktop-3), and the edge arrow shows at the ready shot (desktop-2, phone-2). The lander is under the HUD at 34 m (desktop-4), and the arrow is clipped (finding 4). |
| F-02 star colour | FIXED | Lemon star in desktop-5 and phone-5. e2e checks the colour (`smoke.spec.ts:122`). |
| F-03 ground look | PARTIAL | Grey, varied craters, no visible tile repeat (desktop-2/3). The luminance metric is not in the look gate. Crater lighting is flat (finding 8). |
| F-04 seam dashes | PARTIAL | No dashes in any R2 frame. The black-pixel test is not added. |
| F-05 opening shot | FIXED | Horizon, stars and Earth in desktop-2 and phone-2. |
| F-06 lander readable | FIXED | About 45 px at 257 m (desktop-3), with the halo. The ready shot is still small (finding 9). |
| F-07 fuel matters | FIXED | Replaced by F2: 177 to 232 kg; the helper leaves 13 to 23 s. |
| F-08 height-aware speed band | FIXED | 12.0 m/s is green at 257 m (desktop-3, phone-3). `hud.ts:57-70`. |
| F-09 who steers | PARTIAL | Debrief copy with a tilt icon (desktop-5). The pulse at 200 m is in code (`main.ts:671-675`), not in frames. The optional "helper steers too" level is not done. |
| F-10 Go starts with Help | FIXED | `goWithDefaultHelp` (`main.ts:355`); "Help is on" tip (desktop-2). |
| F-11 helper on real terrain | FIXED | 16 seeds × 6 sites, all soft (R1 asked for 50 seeds). |
| F-12 facts | FIXED | `sites.ts:167`, `README.md:11`. |
| F-13 test-mode opacity | PARTIAL | Game-local rule (`game.css:1374-1378`) and an e2e opacity check. The kit rule is not changed. |
| F-14 portrait ring and Help button | FIXED | The marker is above the controls (phone-4). Help sits between the slider and the pad. |
| F-15 badge contrast | FIXED | Dark badge with a mint ring (desktop-3, phone-3). |
| F-16 ready tip overlap | FIXED | The tip is above the slider (phone-2). |
| F-17 phone picker | PARTIAL | The drawer button no longer overlaps; "How to fly" is visible (phone-1). The kit rule is not changed. |
| F-18 Earth position | FIXED | Earth is whole and clear of the HUD (desktop-2, phone-2). |
| F-19 terrain provenance | OPEN | `fetch.py:1` still says "LDEM_1024 (30 m)" and has no Gaussian step. `sites.json` has `processing` but no `sha256`. |
| F-20 shared play | FIXED | Map, real-ground line, crew line, fact, talk question (desktop-5, phone-5). |
| F-21 touchdown cue | PARTIAL | Code is present (`moonScene.ts:495-501`). The glow is not visible at 34 m or 19 m (desktop-4, phone-4). |
| F-22 Help icon and label | FIXED | Lander in a hand, labelled "Help" (all flight frames). |
| F-23 progress honesty and replay | PARTIAL | Schema v2 with the `helped` mark. No ghost trail. |
| F-24 per-site look | FIXED (code) | `SITES[].look`. Only Tranquility was seen. |
| F-25 wider e2e | OPEN | No on-screen asserts. Tranquility only. |
| F-26 relative slider | FIXED (code) | `devices.ts:74-93`. Feel is unverified. |
| F-27 rail title | FIXED | "MOON TOUCHDOWN" on 2 lines (desktop-1). |
| F-28 engine hum | FIXED (code) | Not heard. |
| F-29 keys | FIXED | README controls table. |
| F-30 honest simplifications | PARTIAL | Added, but the hover % is now stale (15.5 to 16.8%, not 17 to 19%). |
| F-31 Clear data in the 720 px rail | OPEN | The rail ends at Privacy (desktop-1). Clear data is below the fold (kit). |
| F-32 haptics | FIXED | `main.ts:420-422`. |

## DIMENSIONS BELOW 4: the smallest changes to reach 4

- **3 Feedback & readability (3 → 4):**
  - Finding 4: anchor the edge-arrow circle and fix the insets.
  - Finding 5: add the top limit in `flightPose` for the HUD.
  - Finding 6: no red fuel alarm while the helper flies.
  - Finding 3: one colour language for speed.
  - Make the predicted marker at least 28 px on screen (scale it by distance in `moonScene.ts`).
- **4 Game feel (3 → 4):**
  - Finding 5.
  - One recorded human playtest on a phone and on a keyboard: a child, or an adult flying as a child would. Answer: can a first-timer take over from Help and land softly in 3 tries? Does the lever feel right near hover?
  - Without that playtest, this score stays at 3.
- **6 Difficulty & fairness (3 → 4):**
  - Finding 1: prompt from `assistFuelNeed`, and a helper-specific fuel-out text.
  - Finding 3: the star technique must not be red.
  - Finding 7: prove 3 stars on every site.
- **7 Visual polish (3 → 4):**
  - Finding 8: bake crater shadows toward the fixed sun and soften the horizon edge.
  - Finding 9: a bigger hero in the ready shot.
  - Fix the beacon so it does not read as a streak on the ground in the descent cam: fade it above the camera height, or draw it as a short pillar.
  - Make sure the ground glow shows at 20 to 40 m.
- **9 Accessibility & phone play (3 → 4):**
  - Finding 2: sticky debrief actions.
  - Finding 4: the arrow is on screen.
  - Finding 9: Go does not cover the lander.
  - Add e2e asserts for each.

## WHAT'S WORKING (keep)

- **The F2 fuel design:** the helper is safe but thrifty enough to miss the star, the debrief gives a "Helper would have left ~M s" target, and the "30 seconds" call echoes the first crew. This is a strong lesson.
- **The sim:** pure, deterministic, documented, with honest simplifications. The rocket equation, the predictor and the helper are all tested on the real terrain.
- **The height-aware speed band:** correct helper flight is green (desktop-3, phone-3).
- **The descent cam:** at 257 m the ring, the marker trail and the lander are in one frame (desktop-3).
- **The establishing shot:** horizon, stars and Earth (desktop-2, phone-2).
- **The lander close-up:** gold foil, cream cabin, springy legs, plume (phone-4).
- **The debrief content:** lemon stars, a chart with the safe band, a Moon map, the real-ground line, "you vs the real crew", a talk question. True and family-friendly.
- **Phone layout:** relative slider bottom-left, pad bottom-right, Help between them, menus on the left, safe areas respected.
- **Facts:** 16 facts across 6 sites, all accurate (one small fix in Descartes) and pitched for age 7 and up.

## OPEN QUESTIONS / UNVERIFIED

1. **Human playtest:** none yet. Game feel, the slider near hover and the fuel-star difficulty for a child are unverified (L).
2. **Software GL:** the frames used software GL. Are the flat crater lighting, the missing ground glow and the missing lander shadow the same on a host GPU?
3. **Prompt and call-out:** the low-fuel prompt and the 30 s call-out are not in any frame. Fuel went from 36 s to 20 s in the walkthrough, so the call-out must have fired. How did it look?
4. **Other sites:** sites 2 to 6 were not seen (look, terrain relief, slopes near the ring, the arrow at 250 to 450 m offsets).
5. **CSP:** `frame-ancestors` is missing from the CSP meta. The shared spec says to keep it. Chrome logs a console error for `frame-ancestors` in a meta tag, which may be why it was removed. Confirm this is a deliberate kit decision.
6. **Privacy:** zero external requests and offline reload come from the operator's facts. I ran nothing.
7. **Help button position:** the big Help button sits bottom-right on desktop. I read it as a gameplay control, not a menu, so the left-menu rule holds. The rail also has Help. Confirm with the owner.
8. **Mid-phone performance:** no real-device frame time yet, including the synchronous what-if helper run in `showFuelNote` (up to 24,000 steps; likely under 10 ms).
9. **Lander face:** in the close-up (phone-4), the slanted triangle eyes and the square mouth can read as "angry" or "shocked". Check with children.
10. **Descartes rover speed:** confirm the 17 or 18 km/h figure against a primary source before release.
