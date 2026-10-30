# GAME REVIEW - Moon Touchdown - R4 - 2026-10-30

## Scope/evidence: CODE+DOC + BUILD SCREENSHOTS (solo, automated)

- **Build:** commits 6e553d8 (F5) and fd80f09 (F6). Operator facts: typecheck 0, lint 0, vitest 27 files / 237 tests pass. e2e (5 projects, sharded, software GL): 54 passed, 2 failed (load timeouts), 11 skipped. Both failures passed on a re-run. No visual-baseline diffs.
- **Read:** `docs/DESIGN.md` (sections 3, 4, 7, 9, 11), `README.md`, `LICENSES.md`, `docs/reviews/r1..r3-review.md`, `docs/reviews/FIXLIST.md` (F1 to F6), `src/main.ts` (all), `src/hud.ts`, `src/input/{mapping,control,devices}.ts`, `src/sim/{constants,predictor}.ts`, `src/sim/sites.ts` (facts), `src/sim/judge.ts` (texts), `src/sim/helper-sites.test.ts` (pilots and asserts), `src/scene/moonScene.ts` (halo, puffs, plume glow, chevron, marker), `src/game.css` (grep), `index.html`, `e2e/controls.spec.ts`, `e2e/touch.spec.ts`, `e2e/smoke.spec.ts` (grep), `scripts/terrain/SOURCE.md`, `public/data/terrain/sites.json` (grep).
- **Images opened (12):** `shots/r4/desktop-1..5`, `desktop-3b-keys`, `desktop-3c-handsoff` (1280 x 720), `shots/r4/phone-1..5` (Pixel 7). Software GL, Tranquility only, automated walkthrough.
- **Not done:** I ran no commands. No human playtest, no audio heard, sites 2 to 6 not seen, no real phone.
- **Confidence key:** H = seen in a frame, or proved from code with numbers. M = strong inference from code and operator facts. L = needs a human.
- **Playtest rule:** the owner decision applies. The missing human playtest holds no score down. It is in OPEN QUESTIONS.

## Verdict / Overall

**SHIP. Overall 4.00 / 5.** The gate is met: every dimension is at 4.

F5 and F6 closed the R3 blocker. A key press now shows on the lander itself in the descent cam: thruster puffs and a tilt chevron (desktop-3b-keys). "Hands off" now holds the speed (desktop-3c-handsoff). The real-input novices land by hand in 288 of 288 runs, with Help available and without it.

No dimension is at 1. Core loop (4) and fairness (4) are above 2. REWORK is not forced.

Do findings 1 to 4 in the first patch after release. Finding 1 is the most visible to a child, and the fix is small.

## TOP 10 findings, highest impact first

1. **[P2] Two red alarms show during a correct manual flight (H, desktop-3b-keys and desktop-3c-handsoff; H, code).**
   - **Evidence:**
     - The touchdown marker is coral in both frames, while the speed bar is green at 11.9 m/s. The marker colour comes from the predicted touchdown with the input held (`moonScene.ts:597`, `main.ts:1187`). With the hover notch, "input held" means "keep 11.9 m/s to the ground", so the prediction is always "bumpy" until the last metres.
     - The F5 fade (`main.ts:980-985`) fades a held throttle to hover. Hover also keeps the speed, so the marker stays coral while W is held too (desktop-3b-keys).
     - The real-input novices land with 10.0 to 16.6 s of fuel (DESIGN section 4). Below 30 s, manual flight turns the fuel bar red (`hud.ts:371-375`) and plays a red "30 seconds of fuel" call-out (`main.ts:575`). So every by-hand landing ends under a red fuel bar.
   - **Player impact:** The game teaches "keep the mark in the middle of the green" (`index.html:119`). Then a red ring sits under the lander for most of the descent, and the fuel turns red near the end. A child reads red as "I do it wrong" and brakes early. Early braking burns fuel, which is the F5 failure that F6 fixed.
   - **Fix:**
     - In manual flight above 10 m, colour the marker and its edge arrow by the HUD speed band, not by `p.outcome`. Add `assist` and `band` (`vsBandNow`) to `SceneView`. In `MoonScene.update`, use lime for 'slow' and 'good', lemon for 'warn' and coral for 'bad'. Below 10 m, keep the predicted outcome. Do the same in `updateEdges` (`main.ts:1187`).
     - In manual flight, when `helperCanLand()` is true, show the 30 s call-out as lemon "Fuel star gone. You can still land." and keep the fuel bar lemon. Use the same rule as the helper flight (`main.ts:571-573`). Red stays for "the helper cannot save it now".
     - Add `markerBand` to the test state. In `controls.spec.ts`, after the W release, expect `markerBand` 'good' while `vsBand` is 'good'.
2. **[P2] W from the hover notch is soft: about +1 % throttle at 100 ms, and full brake about 2 s after the press (H, code; H, desktop-3b-keys).**
   - **Evidence:** `KEY_FINE_SHARE` 0.3 for the first 0.45 of lever (`mapping.ts:40-41`, `:266-272`). From the notch (lever about 0.28, 16 % throttle), W gives about 17 % at 100 ms and about 22 % at 400 ms. Full throttle comes after about 2.1 s. desktop-3b-keys shows 24 % with W held. From engine-off, W keeps the full 0.85/s rate. So W is quick when the engine is off, but slow from the most common state.
   - **Player impact:** The key cap lights at once, so the input is not lost. But on the lander, a short W tap from the notch barely changes the speed number or the plume. This is the same "did my key work?" risk that the owner found in Catch. It can also make the "Brake now: hold W" prompt slow to act.
   - **Fix:**
     - Make the gentle start time-based, not lever-based: 0.3 of the rate for the first 0.25 s of a press, then the full 0.85/s. A tap stays small, and a hold brakes firmly (full in about 1 s). Change `ControlShaper.update` and add a mapping test. Re-run (f) and (g). Do not change the asserts.
     - Add a visual-only engine kick on a new W press: in `MoonScene.updateCues` and `updateHalo`, show the plume glow and the warm halo at 0.35 or more for 150 ms. This is the engine twin of the thruster puffs.
3. **[P2] The fuel-star route is not proven through the real input path after F6 (H, test code).**
   - **Evidence:** The pilots that earn the fuel star set the throttle directly. `efficientPilot` (`helper-sites.test.ts:226-231`) and the ring pilot (`:275-310`) never go through `mapKeyboard` or `ControlShaper`. They brake on a curve that needs about 66 % throttle at once. From the notch, keys reach that level after about 1.8 s (finding 2). Only the green-middle novices use the real path, and they never reach 30 s.
   - **Player impact:** The game says "fall fast in the yellow up high, then brake hard before the red" (`judge.ts:99`). Nobody knows if a child with W and S can do that and keep 30 s.
   - **Fix:** Add test (h) in `helper-sites.test.ts`: the efficient pilot's targets, flown with bang-bang W/S through `mapKeyboard` and `ControlShaper` (0.2 s reaction, hover notch set every tick). Assert 30 s or more and 0 red steps on sites 1 to 3 in 50 % or more of the seeds. Add the table to DESIGN section 4. If it fails, use the finding 2 fix first.
4. **[P2] The controls e2e checks for the first 3 frames pass without W, and the latency check measures Playwright, not the game (H, test code; operator fact 5).**
   - **Evidence:** In `controls.spec.ts:138-140`, Help already burns about 16 % at 250 m. So `throttle > 0` and `haloThrottle > 0` are true before W. `lastInputAgeMs < 150` (`:144`) is the time from the key event to the `page.evaluate` read-back, so it includes IPC. It failed at 257 ms under load and passed on a re-run. No e2e checks the hover notch. desktop-3c-handsoff shows the notch, but only as a walkthrough frame.
   - **Player impact:** None directly. But this is the gate test for the owner's top concern, and it could miss a real regression.
   - **Fix:**
     - Read the throttle before W, then expect an increase of 0.005 or more within 3 frames.
     - Add an in-page field `keyToFrameMs`: the time from the keydown handler to the first `update()` that applied the key. Assert 120 ms or less.
     - Add a notch step: release W, wait 1 s of sim time, then expect `lever` within 0.01 of the hover lever and a speed change of 0.3 m/s or less.
5. **[P3] The first solo landing is not celebrated, and the next Go starts with the engine off and Help off, with no message (H, code).**
   - **Evidence:** `assist = !progress.solo` (`main.ts:421`), and Go adds Help only for new players (`main.ts:455-457`). After one soft landing without Help, the ready tip is only "under 2 m/s / in the ring" (`index.html:100`). The key hint is off for solo players (`main.ts:711`). The debrief has no "You landed by yourself" line.
   - **Player impact:** A child who got lucky once now starts in free fall. Nothing tells the child that the rules changed.
   - **Fix:** In `showDebrief`, when this run set `progress.solo` for the first time, show "You landed by yourself!" with a lander icon. On the next ready screen, show once: "You fly the engine now. Help is one tap away", with the Help icon. Keep Help one tap away, as now.
6. **[P3] After a by-hand landing, the debrief usually says that the helper did better (M, code and DESIGN tables).**
   - **Evidence:** `showFuelNote` shows "Helper would have left ~M s" when the child flew and missed a star (`main.ts:852-863`). The novices leave 10.0 to 16.6 s. The helper leaves 13.2 to 22.9 s.
   - **Player impact:** The child's best moment (a landing by hand) comes with a line that says the helper was better.
   - **Fix:** Show the helper line only when the child's fuel left is less than the helper's by 1 s or more and the child flew by hand above 60 m. Otherwise show `FUEL_STAR_TIP`. Better: "You flew it yourself!" first, then the tip.
7. **[P3] The new F6 ideas are taught in long text only (H, `index.html:118-119`).**
   - **Evidence:** The Engine line has about 26 words. The Speed down line has about 30 words ("striped blue part on the left is slow"). The slow zone has no picture in How to fly. No frame or e2e shows the "A bit faster saves fuel" cue.
   - **Player impact:** A 7-year-old does not read 30 words. The striped zone is clear on the bar, but its meaning is not.
   - **Fix:** In the How to fly card, add a small copy of the zone gauge (slow / green / yellow / red) with the mark in the middle of green and a thumbs-up icon. Cut each line to 12 words or fewer. Add an e2e check: hold S in manual flight for 5 s of sim time and expect `slowCues` 1 and the call-out text.
8. **[P3] Small visual gaps in the frames (H, frames).**
   - **Evidence:**
     - The warm halo is hard to see on the bright ground with W held (desktop-3b-keys). The puffs and the chevron read well.
     - The Earth is cut off behind the phone drawer button at 21.6 m (phone-4, top left).
     - The ring edge arrow sits on top of the ring's own visible arc (phone-3, left edge).
     - The descent cam is still a flat grey field with a small lander (desktop-3, phone-3).
   - **Fix:** Give the halo a dark outer ring or a higher warm opacity above 90 m (`updateHalo`). In `sky.ts`, keep the Earth out of the drawer-button box on phones. In `updateEdges`, hide the ring arrow when the projected ring arc reaches the inset frame.
9. **[P3] Two e2e tests time out under full parallel load on software GL (operator fact 5).**
   - **Evidence:** chromium `controls` (finding 4) and the webkit smoke round (90 s). Both passed on a re-run (smoke.spec alone: 10/10 in 1.0 min).
   - **Fix:** Fix finding 4. For the webkit project on hosts without a GPU, raise the per-test timeout to 180 s or run it with 1 worker. Write the choice in CONTRIBUTING.
10. **[P3] Terrain re-run pending and small doc drift (H, docs).**
    - **Evidence:** `SOURCE.md:14-16` says that the committed `.bin` files have no hashes and are not regenerated. FIXLIST F6 item 1c says `KEY_FINE_SHARE = 0.45` and "full brake about 1.5 s". The code has 0.3 (`mapping.ts:40`), and DESIGN says about 2 s (`DESIGN.md:312`). The `controls.spec.ts:7` header says that the phone touch checks are in `smoke.spec.ts`, but they are in `touch.spec.ts` now.
    - **Fix:** Run `fetch.py` once and commit the hashes (F-19). Correct FIXLIST 1c and the spec header.

## SCORES

| # | Dimension | Weight | Score | Conf. | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Core loop & clarity of goal | 14% | 4 | H | Pick, ready, fly, debrief and Again work on desktop and phone (desktop-1..5, phone-1..5). Ring or ring arrow in every flight frame. Help-to-hand flow is clear: chip "You", toast "You fly now" (desktop-3b). Not 5: the marker says "red" during a correct manual descent (finding 1). |
| 2 | Onboarding / first-time experience | 10% | 4 | M | Help armed on the ready screen; chip, button and tip agree (phone-2, desktop-2; `main.ts:421`; e2e on both form factors). Key-cap tip (desktop-2), first-flight key hint (`main.ts:701-722`), How to fly explains the notch (`index.html:118`). Gaps: no first-solo moment (finding 5), long text (finding 7), desktop hero about 45 px. |
| 3 | Feedback & readability | 14% | 4 | M | Zone gauge with a striped slow zone, readable without colour (desktop-3b, 3c; `hud.ts:159-198`). Chip with lit caps, 2.5 s toast below the HUD (`--mt-hud-bottom`, touch.spec no-overlap). Fuel rounds down everywhere (`hud.ts:366`). Marker arrow hides over a seen marker (phone-3, phone-4). Gap: red marker and red fuel in correct manual flight (finding 1). Closest dimension to 3. |
| 4 | Game feel | 14% | 4 | M | Tilt now answers on the lander: puffs and chevron in desktop-3b; `rcsPuffs` within 3 frames (e2e, both input paths). Hover notch holds 11.9 m/s with hands off (desktop-3c). First-press step from off, 50 ms key tilt, handover on the key event. Real-input novices 288/288 by hand. Gap: W from the notch is soft (finding 2). No CONTROLS CHECK fail, so no cap. |
| 5 | Realism vs real data and physics | 12% | 4 | H | g, thrust, Isp, mass flow and hover time exact (REALISM CHECK). LOLA at true scale. 16 facts true and kid-appropriate. Notch, puffs, halo disclosed as aids (`DESIGN.md:331-334`). Not 5: terrain re-run and hashes pending (finding 10). |
| 6 | Difficulty & fairness | 10% | 4 | M | Helper 13.2-22.9 s, 0/96 fuel stars. Novices by hand 288/288, 0 prompts, 0 dry, left min 10.0 s (DESIGN section 4). Prompt only when true (`main.ts:658-680`). Kind fuel-out texts. Gaps: fuel-star route unproven through real keys (finding 3); helper comparison after a by-hand landing (finding 6). |
| 7 | Visual polish & presentation | 10% | 4 | M | Friendly lander close-up with foil and plume (desktop-4, phone-4). Crater crescents (desktop-3). Earth and stars in the hero shot (desktop-2, phone-2). Puffs and chevron read from above (desktop-3b). Gaps: flat grey descent field, faint halo tint, Earth clipped on phone (finding 8). |
| 8 | Replayability | 5% | 4 | M | 6 sites unlock in order, 3 stars proven possible on every site (DESIGN table d), helper mark on the picker, rotating facts and talk questions. No ghost of the best run (F-23). |
| 9 | Accessibility & phone play | 7% | 4 | M | Touch e2e on iPhone and Pixel: drag, pad, tap no-op, no scroll, zoom 1 (`touch.spec.ts`). Safe areas in CSS. Debrief "More" fold keeps buttons in view (phone-5). Stripes give a non-colour cue. Reduced-motion rules kept. Gaps: long help text (finding 7), Earth under the drawer button (phone-4). |
| 10 | Technical polish & privacy | 4% | 4 | H | 237 unit tests, real-input fairness tables, real-key and touch e2e, offline SW, `g499:` storage, zero external requests in every guard. Gaps: two load timeouts (finding 9), a latency assert that measures IPC (finding 4), F-19 re-run pending. |

**Weighted mean:**
0.14·4 + 0.10·4 + 0.14·4 + 0.14·4 + 0.12·4 + 0.10·4 + 0.10·4 + 0.05·4 + 0.07·4 + 0.04·4
= 0.56 + 0.40 + 0.56 + 0.56 + 0.48 + 0.40 + 0.40 + 0.20 + 0.28 + 0.16 = **4.00**

## REALISM CHECK

| Item | Game | Real / check | Result |
| --- | --- | --- | --- |
| Lunar gravity | 1.62 m/s² (`constants.ts:10`) | 1.62 m/s² | **MATCHES** |
| Engine thrust | 45,000 N (`constants.ts:20`) | About 45,040 N (10,125 lbf) at full | **MATCHES** |
| Isp / exhaust speed | 311 s × 9.80665 = 3,049.9 m/s (`constants.ts:16-18`) | About 311 s (vacuum) | **MATCHES** |
| Mass flow | 45,000 / 3,049.9 = 14.75 kg/s at full | About 14.7 kg/s | **MATCHES** |
| Hover time | Tranquility: 177 kg / (4,477 × 1.62 / 3,049.9) = 74.4 s; HUD "74" (desktop-2, floor) | Maths correct; current mass (about 9% conservative, disclosed) | **MATCHES** |
| Hover throttle | 4,477 × 1.62 / 45,000 = 16.1%; HUD 16% (desktop-3, desktop-3c) | Real lander about 25 to 30% (disclosed, `DESIGN.md:341`) | **MATCHES** (disclosed) |
| Hover notch | Lever returns to hover on release (`mapping.ts:273-279`) | Real throttle stayed put; the real final phase used a rate-of-descent switch and the computer held the speed. Disclosed as a "simpler cousin" (`DESIGN.md:334`) | **MATCHES** (disclosed) |
| Thruster puffs | Visual only, from the 4 corner positions (`moonScene.ts:681-711`) | Real lander turned with corner thruster quads; game attitude is an ideal gimbal (disclosed, `DESIGN.md:331`) | **MATCHES** (disclosed) |
| Landing limits | vs < 2.0, hs < 1.2 m/s, tilt < 10°, slope < 12° (`constants.ts:42-51`) | Real gear about 3 m/s down, about 1.2 m/s sideways, about 12° | **MATCHES** (stricter vs is fine) |
| LOLA terrain | LDEM_512, 256 × 256 at 60 m, 15.3 km, exaggeration 1.0 | 512 px/deg ≈ 59 m/px | **MATCHES** (data). **PARTIAL** provenance: script fixed, re-run and hashes pending (`SOURCE.md:14-16`) |
| Tranquility | July 1969, flat old lava; laser mirror; footprints; crew at about 0.5 m/s | True (about 1.7 ft/s) | **MATCHES**, kid-appropriate |
| Ocean of Storms | Nov 1969, near a 1967 robot lander, parts brought home; biggest dark plain; no storms, no air | True | **MATCHES** |
| Fra Mauro | Feb 1971, two golf balls; two-wheeled cart; hills are far-impact ejecta | True | **MATCHES** |
| Descartes | Apr 1972, old highland rocks; rover about 17 km/h | True | **MATCHES** |
| Taurus-Littrow | Dec 1972 last people, orange glass beads; whole-Earth photo on the way; massifs about 2 km | True | **MATCHES** |
| Hadley | July 1971 first car, rille 1 to 1.5 km; hammer and feather; white rock about 4 billion years | True | **MATCHES** |
| Gravity card | 1.62 vs 9.81, "about one sixth" (`sites.ts:212`) | 9.81 / 1.62 = 6.06 | **MATCHES** |
| Trademarks | No mission, crew, agency or brand names in the UI. Data credit with "no endorsement" (`SOURCE.md:5`). Original toy lander. | | **MATCHES** |

## CONTROLS CHECK

| Check | Result | Evidence |
| --- | --- | --- |
| (a) Every key gives a visible response within about 100 ms | **PASS** (with finding 2) | The key cap lights on the key event (`main.ts:526-538`). An engine key while Help flies turns Help off on that event, with the toast and the chip "You" (`main.ts:531-534`; desktop-3b). Next frame: W from off steps to 10% (`mapping.ts:269`); tilt keys reach the command in 50 ms (`mapping.ts:47`); puffs fire on the frame the shaped command changes, and the chevron shows (`moonScene.ts:681-761`; desktop-3b). Operator re-run: first rendered frame 121 ms after W on software GL, 4 puffs after ArrowLeft. Caveat: W from the notch adds only about 1% throttle at 100 ms. |
| (b) Help never overrides player input without showing it | **PASS** | Only player engine input changes who flies (`control.ts:131-134`). Help turns on only by Space, the Help button or the rail. Hand-off shows at once: toast, chip, Help button un-pressed (desktop-3b, desktop-3c; e2e `controls.spec.ts:143-150`, `touch.spec.ts:148-153`). The hover notch moves the lever when the player lets go. It is not Help: the chip stays "You", How to fly explains it (`index.html:118`), and the slider knob shows it (`DESIGN.md:313`). |
| (c) HUD input indicator and clear key prompts | **PASS** | Input chip in every flight frame (desktop-2, 3, 3b, 3c, 4; phone-2, 3, 4). Ready tip with W, ←, →, Space caps (desktop-2, `index.html:99`). How to fly key caps (`index.html:118-121`). One-time key hint (`main.ts:701-722`). |
| (d) e2e with real `page.keyboard` on the built site, asserting motion | **PASS** (with finding 4) | `controls.spec.ts` uses real `keyboard.down/up` on `vite preview` with `?test=1&live=1`. It asserts that the W run brakes 0.4 m/s² or more harder than the Help run, that the lever ramps, a lean of more than 2° left, and that vx moves left (`:151-182`). The 3-frame checks are weak (finding 4). |
| (e) Arrows and Space never scroll; focus loss after a click does not drop keys | **PASS** | `KeyTracker` prevents every flight key and its repeats while the flight owns the keys (`control.ts:46-58`). The Space repeat is held back (`:50-52`). A pointer click blurs the button (`main.ts:1304-1313`). Keys clear on blur and hide (`devices.ts:51-54`). e2e: focus leaves rail Restart and rail Help, and `scrollY` stays 0 (`controls.spec.ts:118, 188, 197-198`). Touch: `scrollY` 0, zoom 1 (`touch.spec.ts:176-178`). |

No FAIL, so no cap on dimensions 4 and 9.

## FUEL CHECK

- **Is the fuel star earned? YES (H).** The helper leaves 13.2 to 22.9 s in 96 runs, with 0 fuel stars. The star needs 30 s, so the gap is at least 7 s. The real-input novices leave 10.0 to 16.6 s, also below the star. The walkthrough agrees: 20 s and 1 star (desktop-5, phone-5).
- **Is it reachable? YES for a scripted pilot (H); not proven through real keys after F6 (finding 3).** The efficient pilot keeps 41 to 53 s on every site with 0 red steps. The ring + thrifty pilot gets 3 stars on 7 to 16 of 16 seeds per site. Both set the throttle directly, not through the keys and the notch.
- **Is low fuel kind? MOSTLY (H, code).**
  - "Tap Help" shows only while the helper's need is covered (`main.ts:658-680`). It never showed in 288 novice runs, because the novices kept enough fuel.
  - While Help flies, the 30 s call-out is lemon "Fuel star gone. Help still lands safely." (`main.ts:571-573`).
  - A helper fuel-out blames Help, not the child. The manual fuel-out text is kind and has a tip.
  - The HUD fuel rounds down, the same as the debrief and the star (`hud.ts:366`). "30" always means the star holds.
  - **Unkind edge:** a child who flies by hand lands with 10 to 17 s, so every such flight ends with a red fuel bar and a red "30 seconds of fuel" call-out (finding 1). The landing is safe, but the colour says danger.

## R3 FIX STATUS

| R3 finding | Status | Evidence |
| --- | --- | --- |
| 1 Descent-cam input not visible on the lander | FIXED | Puffs and chevron in desktop-3b; plume glow and halo tint in code (`moonScene.ts:650-761`); e2e `rcsPuffs` on keys and touch. The halo tint is faint on bright ground (finding 8). |
| 2 Novice proxy not on the real input path | FIXED | (f) and (g) through `mapKeyboard`/slider + `ControlShaper`, 300 m and 150 m, 288/288 by hand (DESIGN section 4). Human playtest moved to OPEN QUESTIONS (owner decision). |
| 3 Phone ready screen disagrees | FIXED | phone-2: chip "Help", Help button pressed, tip "Help is on". `main.ts:421`; e2e in both specs. |
| 4 Toast invisible in test mode | FIXED | Toast visible in desktop-3b and desktop-3c; `game.css:1683-1686`; opacity asserts; `TOAST_TIME` 2.5 (`main.ts:104`). |
| 5 Toast and call-out slot on phones | FIXED | `--mt-hud-bottom` (`main.ts:1099`, `game.css:465, 546, 571`); `touch.spec.ts:156` no overlap. No phone frame with a toast (M). |
| 6 No touch e2e | FIXED | `e2e/touch.spec.ts` passes on Pixel and iPhone (operator). |
| 7 Marker arrow on the marker | FIXED | No marker arrow over a seen marker in desktop-3, phone-3, phone-4 (`main.ts:1175-1185`). |
| 8 HUD fuel ceil vs floor | FIXED | `Math.floor` (`hud.ts:366`). |
| 9 Marker red while steering | PARTIAL | The fade stops the far jump (marker near the trail in desktop-3b). The marker is still coral in correct manual flight (finding 1). |
| 10 Terrain provenance | PARTIAL | Script and docs agree now. Re-run and hashes pending (`SOURCE.md:14-16`). |

| FIXLIST id (open after R3) | Status | Evidence |
| --- | --- | --- |
| F-03 ground look | PARTIAL | Looks right in frames. The kit luminance metric is not added. |
| F-04 seam dashes | PARTIAL | No dashes in any R4 frame. The black-pixel test is not added. |
| F-09 who steers | PARTIAL | Helped debrief copy with tilt icon (desktop-5, phone-5). Optional "helper steers too" level not done. |
| F-13 test-mode opacity | PARTIAL | Game-local rule covers the toast now. The kit rule is not changed. |
| F-19 terrain provenance | PARTIAL | Script fixed in F5; re-run pending. |
| F-23 replay honesty | PARTIAL | Helper marks done; no ghost trail. |
| F-25 wider e2e | PARTIAL | Touch spec added. All e2e still fly Tranquility only (`smoke.spec.ts:68, 104, 256`). |
| F-31 Clear data in the 720 px rail | OPEN | desktop-1: the rail ends at Privacy (kit). |
| F5 items 1, 3-9 | FIXED | See the R3 rows above. |
| F5 item 2 (novices) | FIXED | Measured in F6 (DESIGN section 4). |
| F5 item 10 (F-19) | PARTIAL | Re-run pending. |
| F6 item 1 slow zone | PARTIAL (by design) | Done. The per-metre margin above 30 m is not possible with the fixed green top; this is documented (`DESIGN.md:207`). |
| F6 items 1b, 1c, 2, 3, 4, 5 | FIXED | Zone gauge (desktop-3b, 3c), notch (desktop-3c, `mapping.ts:273-279`), slow cue (`hud.ts:220-246`, `main.ts:687-695`), honest novices and tables, HUD tests, DESIGN. FIXLIST 1c text is stale (finding 10). No e2e for the notch or the slow cue (findings 4, 7). |

## DIMENSIONS BELOW 4: the smallest changes to reach 4

None. Every dimension is at 4.

To hold 4 with more confidence, in the first patch after release:

- **3 Feedback (nearest to 3):** finding 1 (marker by speed band in manual flight; lemon fuel while the helper could still land).
- **4 Game feel:** finding 2 (time-based gentle start and an engine kick) and finding 4 (e2e that proves the W response and the notch).
- **6 Fairness:** finding 3 (a real-keys fuel-star pilot).

## WHAT'S WORKING (keep)

- **The hover notch:** "hands off keeps the speed" turned 0/144 by-hand landings into 288/288. It is also close to the real final-phase rate mode, and the docs say so.
- **Visible answers on the lander:** the puffs and the chevron read clearly from 250 m up (desktop-3b). They fire from the shaped command, not the lagged sim.
- **The zone gauge:** green is always a third of the bar, the middle of green on screen is the middle in m/s, and the stripes work without colour.
- **Honest tuning:** F6 was measured, the knob was turned, and no assert was weakened. The tables are in DESIGN section 4.
- **One story on the ready screen:** chip, Help button and tip agree on desktop and phone.
- **The input chip and the toast:** they say who flies and light the held keys (desktop-3b, desktop-3c).
- **Fair fuel:** the helper is safe but never earns the star, and the prompt promises only what is true.
- **Real data and true facts:** exact constants, LOLA at true scale, 16 accurate facts, complete honest simplifications.
- **The debrief on phones:** buttons always in view, chart and facts folded into "More" (phone-5).

## OPEN QUESTIONS / UNVERIFIED

1. **Human playtest (post-release follow-up, owner decision):** run the DESIGN section 11 protocol after release. Add 2 questions: "When you let go, did the lander keep its speed?" and "Did the red ring under the lander worry you?" (finding 1).
2. **W from the notch:** finding 2 is from code arithmetic and one frame. Only a person can say whether it feels slow.
3. **Fuel star by real keys:** unproven until test (h) runs (finding 3).
4. **Other sites:** sites 2 to 6 not seen in frames. All e2e fly Tranquility only.
5. **Real GPU and mid phone:** halo tint, plume glow, puffs and bloom were seen on software GL only. No real-device frame time.
6. **Slow cue:** no frame and no e2e shows "A bit faster saves fuel".
7. **CSP:** `frame-ancestors 'none'` is still absent from the meta tag (`index.html:5`), but the project rule asks to keep it. Confirm that this is a kit decision (Chrome logs a console error for it in a meta tag) and record it in the kit docs.
8. **Privacy and offline:** zero external requests and offline reload come from the operator's runs. I ran nothing.
9. **Help button position:** bottom-right on desktop. I read it as a gameplay control, not a menu, so the left-menu rule holds. Confirm with the owner.
10. **Help hand-back by Space mid-brake:** when Help turns off by Space (not by engine input), the lever stays at Help's throttle until the player moves the engine (`DESIGN.md:312`). If Help was braking hard, the lander can climb. This is by design but not tested on real terrain.
