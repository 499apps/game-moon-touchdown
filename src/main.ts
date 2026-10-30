/**
 * Moon Touchdown: boots the kit shell (left rail, audio, service worker) and the 3D stage, loads
 * the real terrain for a site, then runs the flight: input -> pure sim (src/sim) -> scene, HUD,
 * sounds, call-outs and the debrief.
 *
 * Controls: left slider / W S / left stick = engine; right pad / A D Q E / right stick = tilt;
 * the big helper button, Space or gamepad A = hover helper; P pauses. Sites, pause, restart,
 * helper, touch pad, help, sound, home and clear-data live in the left rail.
 */
import './kit/styles.css';
import './game.css';
import type { InputSource } from './kit/input';
import { hashSeed, createRng } from './kit/prng';
import { createShell } from './kit/shell';
import { createStage } from './kit/stage';
import { readTestMode } from './kit/test-mode';
import { drawDescentChart } from './graphs';
import { Hud } from './hud';
import { moonIcon, type MoonIcon } from './icons';
import { HeldKeys, TouchControls, collectIntent } from './input/devices';
import { ControlShaper, throttleToLever } from './input/mapping';
import {
  CONTROLS_KEY,
  bestStars,
  emptyProgress,
  isUnlocked,
  loadProgress,
  recordRun,
  saveProgress,
} from './progress';
import { MoonScene, SUN, type ScenePhase } from './scene/moonScene';
import { bakeSunShadow } from './scene/shade';
import type { TerrainSource } from './scene/terrainView';
import { DT, LEG_DROP } from './sim/constants';
import { Flight, type FlightEvent, type FlightResult, type PilotInput } from './sim/flight';
import { BUMP_TEXT } from './sim/judge';
import { createLander, hoverThrottle, type LanderState } from './sim/lander';
import { predictTouchdown, type Prediction } from './sim/predictor';
import { GRAVITY_FACT, GRID, SITES, startConditions, type SiteInfo } from './sim/sites';
import { Terrain } from './sim/terrain';
import { MoonSounds } from './sound';

type Phase = ScenePhase;

/** Seconds after touchdown before the debrief card slides in (the dust settles first). */
const DEBRIEF_DELAY = 1.6;
/** Seconds a fuel call-out stays on screen. */
const CALLOUT_TIME = 2.6;
/** Seconds between touchdown predictions. */
const PREDICT_EVERY = 0.1;
/** Frames the test API suggests per step call (the sim is cheap). */
const TEST_STEP_FRAMES = 600;

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`moon-touchdown: missing ${selector}`);
  return el;
}

const appEl = must<HTMLElement>('.game-app');
const stageHost = must<HTMLElement>('#stage');
const hudEl = must<HTMLElement>('#hud');
const calloutEl = must<HTMLElement>('#callout');
const assistBadge = must<HTMLElement>('#assist-badge');
const assistBtn = must<HTMLButtonElement>('#assist-btn');
const readyEl = must<HTMLElement>('#ready');
const goBtn = must<HTMLButtonElement>('#go-btn');
const pickerEl = must<HTMLElement>('#picker');
const pickerClose = must<HTMLButtonElement>('#picker-close');
const siteGrid = must<HTMLElement>('#site-grid');
const pickerHelp = must<HTMLButtonElement>('#picker-help');
const helpEl = must<HTMLElement>('#help');
const helpClose = must<HTMLButtonElement>('#help-close');
const pauseOverlay = must<HTMLElement>('#pause');
const resumeButton = must<HTMLButtonElement>('#resume');
const debriefEl = must<HTMLElement>('#debrief');
const outcomeIcon = must<HTMLElement>('#outcome-icon');
const outcomeTitle = must<HTMLElement>('#outcome-title');
const outcomeReason = must<HTMLElement>('#outcome-reason');
const starsEl = must<HTMLElement>('#stars');
const statVs = must<HTMLElement>('#stat-vs');
const statHs = must<HTMLElement>('#stat-hs');
const statDist = must<HTMLElement>('#stat-dist');
const statFuel = must<HTMLElement>('#stat-fuel');
const statTime = must<HTMLElement>('#stat-time');
const chartEl = must<HTMLCanvasElement>('#chart');
const factSite = must<HTMLElement>('#fact-site');
const factGravity = must<HTMLElement>('#fact-gravity');
const retryBtn = must<HTMLButtonElement>('#retry');
const nextBtn = must<HTMLButtonElement>('#next-site');
const sitesBtn = must<HTMLButtonElement>('#open-sites');

// Fill the icon placeholders in the static markup.
for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-icon]'))) {
  el.innerHTML = moonIcon((el.dataset['icon'] ?? 'lander') as MoonIcon);
}

const testMode = readTestMode();
const seed = testMode.enabled ? testMode.seed : Math.floor(Math.random() * 0xffffffff);

// ---------- State ----------

let phase: Phase = 'pick';
let paused = false;
let assist = false;
let siteIdx = 0;
let shownSlug: string | null = null;
let loading: string | null = null;
let flight: Flight | null = null;
let preview: LanderState = createLander({ x: 0, y: 120 + LEG_DROP, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
let prediction: Prediction | null = null;
let predictClock = 0;
let stepCarry = 0;
let landedFor = 0;
let debriefShown = false;
let calloutLeft = 0;
let fullFuel = 1;
let runCount = 0;
let actions = 0;
let lastInput: PilotInput = { throttle: 0, tiltX: 0, tiltZ: 0, tiltActive: false, assist: false };
let touchOn = false;
let progress = emptyProgress();
let scene: MoonScene | null = null;
const sources = new Map<string, TerrainSource>();
const shaper = new ControlShaper();
const keys = new HeldKeys();
const hud = new Hud(hudEl);

const shell = createShell({
  title: 'Moon Touchdown',
  kind: 'game',
  container: document.body,
  base: import.meta.env.BASE_URL,
  dev: import.meta.env.DEV,
  extraItems: [
    { kind: 'button', id: 'sites', label: 'Sites', icon: 'games', onSelect: () => openPicker() },
    {
      kind: 'toggle',
      id: 'pause',
      label: 'Play',
      labelOff: 'Pause',
      icon: 'play',
      iconOff: 'pause',
      get: () => paused,
      set: (p) => setPaused(p),
    },
    {
      kind: 'button',
      id: 'restart',
      label: 'Restart',
      icon: 'restart',
      onSelect: () => {
        shell.menu.close();
        if (flight) void selectSite(siteIdx);
      },
    },
    { kind: 'button', id: 'assist', label: 'Helper', icon: 'games', onSelect: () => setAssist(!assist) },
    { kind: 'button', id: 'controls', label: 'Touch pad', icon: 'games', onSelect: () => setTouch(!touchOn) },
    { kind: 'button', id: 'help', label: 'How to fly', icon: 'info', onSelect: () => openHelp() },
  ],
  onClearData: () => {
    progress = emptyProgress();
    renderPicker();
  },
});

progress = loadProgress(shell.storage);
touchOn = (() => {
  const saved = shell.storage.get<unknown>(CONTROLS_KEY, null);
  if (typeof saved === 'boolean') return saved;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
})();

const sounds = new MoonSounds(shell.synth);

const stage = createStage({
  host: stageHost,
  testMode: shell.testMode,
  reducedMotion: shell.reducedMotion,
  label: 'Moon landing view',
  fallback: { title: 'Moon Touchdown', text: 'This game needs WebGL, which this browser does not offer.' },
  renderer: {
    exposure: 1,
    bloom: { strength: 0.45, radius: 0.4, threshold: 0.92 },
    vignette: 0.38,
    clearColor: '#03040b',
  },
});

const touch = new TouchControls({
  slider: must<HTMLElement>('#throttle'),
  sliderFill: must<HTMLElement>('#throttle-fill'),
  sliderKnob: must<HTMLElement>('#throttle-knob'),
  sliderHover: must<HTMLElement>('#throttle-hover'),
  pad: must<HTMLElement>('#tilt-pad'),
  padKnob: must<HTMLElement>('#tilt-knob'),
});

// ---------- Terrain ----------

function currentSite(): SiteInfo {
  return SITES[siteIdx] ?? (SITES[0] as SiteInfo);
}

/** Gentle stand-in hills, only used when a terrain file cannot be read. */
function standIn(): Terrain {
  return Terrain.fromFunction(GRID.size, GRID.spacing, (x, z) => 18 * Math.sin(x / 700) * Math.cos(z / 900));
}

async function loadSource(site: SiteInfo): Promise<TerrainSource> {
  const cached = sources.get(site.slug);
  if (cached) return cached;
  let terrain: Terrain;
  try {
    // Same-origin data file, cached by the service worker for offline play.
    const res = await fetch(`${import.meta.env.BASE_URL}data/terrain/${site.slug}.bin`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    terrain = Terrain.fromInt16(await res.arrayBuffer(), GRID.size, GRID.spacing, GRID.unit);
  } catch (err) {
    console.warn(`moon-touchdown: terrain for ${site.slug} is not available, using stand-in hills`, err);
    terrain = standIn();
  }
  const src: TerrainSource = { terrain, lit: bakeSunShadow(terrain, SUN), seed: hashSeed(site.slug) };
  sources.set(site.slug, src);
  return src;
}

function showSource(site: SiteInfo, src: TerrainSource): void {
  if (shownSlug === site.slug) return;
  shownSlug = site.slug;
  scene?.setSite(src);
  const g0 = src.terrain.heightAt(0, 0);
  preview = createLander({ x: 0, y: g0 + 120 + LEG_DROP, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
}

// ---------- Runs ----------

async function selectSite(index: number): Promise<void> {
  const site = SITES[index];
  if (!site || !isUnlocked(progress, index)) {
    sounds.fuelOut();
    return;
  }
  siteIdx = index;
  loading = site.slug;
  renderPicker();
  const src = await loadSource(site);
  if (loading !== site.slug) return;
  loading = null;
  showSource(site, src);
  prepareRun(site, src);
  stage.requestRender();
}

function prepareRun(site: SiteInfo, src: TerrainSource): void {
  runCount++;
  const rng = createRng(hashSeed(`${seed}:${site.slug}:${runCount}`));
  flight = new Flight(src.terrain, startConditions(site, rng, src.terrain));
  fullFuel = flight.fuelSeconds;
  phase = 'ready';
  paused = false;
  prediction = null;
  predictClock = 0;
  stepCarry = 0;
  landedFor = 0;
  debriefShown = false;
  calloutLeft = 0;
  shaper.reset(0);
  touch.reset();
  keys.clear();
  scene?.resetRun();
  // The picked card (or the Again button) is about to hide: drop its focus so Space reaches
  // the game instead of clicking a hidden button.
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && (pickerEl.contains(active) || debriefEl.contains(active))) active.blur();
  pickerEl.hidden = true;
  helpEl.hidden = true;
  debriefEl.hidden = true;
  updateUi();
}

function startFlight(): void {
  if (phase !== 'ready' || !flight) return;
  phase = 'flying';
  sounds.start();
  updateUi();
}

function setAssist(on: boolean): void {
  if (assist === on) {
    renderAssist();
    return;
  }
  assist = on;
  // Hand the engine back at the throttle the helper was using: no jump.
  if (!on && flight) shaper.setLever(throttleToLever(flight.state.throttle));
  sounds.assist(on);
  renderAssist();
  stage.requestRender();
}

function setPaused(p: boolean): void {
  if (phase !== 'flying' && phase !== 'ready') p = false;
  if (paused === p) {
    updateUi();
    return;
  }
  paused = p;
  if (p) sounds.pause();
  else sounds.resume();
  keys.clear();
  touch.reset();
  updateUi();
}

function setTouch(on: boolean): void {
  touchOn = on;
  shell.storage.set(CONTROLS_KEY, on);
  if (!on) touch.reset();
  renderToggleItem('controls', on, 'controls', 'Touch controls');
  updateUi();
}

function handleEvents(events: FlightEvent[]): void {
  for (const e of events) {
    if (e.type === 'callout') {
      showCallout(`${e.seconds} seconds of fuel`, e.seconds <= 30 ? 'bad' : 'warn');
      sounds.callout(e.seconds);
    } else if (e.type === 'fuel-out') {
      showCallout('Out of fuel', 'bad');
      sounds.fuelOut();
    } else {
      onTouchdown(e.result);
    }
  }
}

function onTouchdown(r: FlightResult): void {
  phase = 'landed';
  prediction = null;
  landedFor = 0;
  sounds.touchdown();
  if (r.verdict.outcome === 'soft') sounds.soft();
  else sounds.bumpy();
  progress = recordRun(progress, siteIdx, r.verdict.outcome === 'soft', r.stars.stars);
  saveProgress(shell.storage, progress);
  renderPicker();
  updateUi();
}

function showCallout(text: string, band: 'warn' | 'bad'): void {
  calloutEl.textContent = text;
  calloutEl.dataset['band'] = band;
  calloutEl.hidden = false;
  calloutLeft = CALLOUT_TIME;
}

// ---------- Overlays ----------

function openPicker(): void {
  shell.menu.close();
  helpEl.hidden = true;
  renderPicker();
  pickerEl.hidden = false;
  pickerClose.hidden = flight === null;
  if (phase === 'flying' && !paused) setPaused(true);
  updateUi();
}

function closePicker(): void {
  if (!flight) return;
  pickerEl.hidden = true;
  updateUi();
}

function openHelp(): void {
  shell.menu.close();
  pickerEl.hidden = true;
  helpEl.hidden = false;
  if (phase === 'flying' && !paused) setPaused(true);
  updateUi();
  helpClose.focus({ preventScroll: true });
}

function difficultyDots(n: number): string {
  let out = '';
  for (let i = 1; i <= SITES.length; i++) out += `<i class="${i <= n ? 'is-on' : ''}"></i>`;
  return out;
}

function starRow(count: number, className: string): string {
  let out = '';
  for (let i = 0; i < 3; i++) {
    out += `<span class="${className}${i < count ? ' is-on' : ''}">${moonIcon('star', 'g499-icon-svg', i < count)}</span>`;
  }
  return out;
}

function renderPicker(): void {
  const cards = SITES.map((s, i) => {
    const open = isUnlocked(progress, i);
    const best = bestStars(progress, s.slug);
    const busy = loading === s.slug;
    const label = open
      ? `${s.name}, difficulty ${s.difficulty} of ${SITES.length}, best ${best} of 3 stars`
      : `${s.name}, locked: land softly on the site before it`;
    return `<button type="button" class="mt-site${open ? '' : ' is-locked'}${busy ? ' is-loading' : ''}${i === siteIdx ? ' is-current' : ''}" data-index="${i}" data-slug="${s.slug}" aria-label="${label}"${open ? '' : ' aria-disabled="true"'}>
      <span class="mt-site-emblem" data-level="${s.difficulty}">${open ? moonIcon('lander', 'mt-site-svg') : moonIcon('lock', 'mt-site-svg')}</span>
      <span class="mt-site-name">${s.name}</span>
      <span class="mt-site-dots" aria-hidden="true">${difficultyDots(s.difficulty)}</span>
      <span class="mt-site-stars" aria-hidden="true">${starRow(best, 'mt-site-star')}</span>
    </button>`;
  });
  siteGrid.innerHTML = cards.join('');
}

function showDebrief(): void {
  const r = flight?.result;
  if (!flight || !r) return;
  debriefShown = true;
  const soft = r.verdict.outcome === 'soft';
  const site = currentSite();
  debriefEl.dataset['outcome'] = r.verdict.outcome;
  outcomeIcon.innerHTML = moonIcon(soft ? 'star' : 'boing', 'g499-icon-svg', soft);
  outcomeTitle.textContent = soft ? (r.stars.stars === 3 ? 'Perfect touchdown!' : 'Soft touchdown!') : 'Bumpy landing';
  let reason = '';
  if (!soft) {
    reason = r.verdict.reasons.map((k) => BUMP_TEXT[k]).slice(0, 2).join(' ');
  } else if (!r.stars.close) {
    reason = 'Land inside the green ring for another star.';
  } else if (!r.stars.fuel) {
    reason = 'Keep 30 seconds of fuel for another star.';
  }
  outcomeReason.textContent = reason;
  outcomeReason.hidden = reason === '';
  starsEl.innerHTML = starRow(r.stars.stars, 'mt-star');
  starsEl.setAttribute('aria-label', `${r.stars.stars} of 3 stars`);
  statVs.textContent = `${r.touchdown.vs.toFixed(1)} m/s`;
  statHs.textContent = `${r.touchdown.hs.toFixed(1)} m/s`;
  statDist.textContent = `${Math.round(r.distance)} m`;
  statFuel.textContent = `${Math.floor(r.touchdown.fuelSeconds)} s`;
  statTime.textContent = `${Math.round(r.touchdown.time)} s`;
  factSite.textContent = site.fact;
  factGravity.textContent = GRAVITY_FACT;
  const next = siteIdx + 1;
  nextBtn.disabled = !(next < SITES.length && isUnlocked(progress, next));
  debriefEl.hidden = false;
  drawDescentChart(chartEl, flight.trace);
  retryBtn.focus({ preventScroll: true });
}

// ---------- Rail items with game icons ----------

function renderToggleItem(id: string, on: boolean, icon: MoonIcon, aria: string): void {
  const btn = shell.menu.rail.querySelector<HTMLElement>(`[data-menu-id="${id}"]`);
  if (!btn) return;
  btn.classList.add('g499-menu-toggle');
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', aria);
  const el = btn.querySelector('.g499-icon');
  if (el) el.innerHTML = moonIcon(icon);
}

function renderRailIcons(): void {
  const sites = shell.menu.rail.querySelector<HTMLElement>('[data-menu-id="sites"] .g499-icon');
  if (sites) sites.innerHTML = moonIcon('sites');
  const help = shell.menu.rail.querySelector<HTMLElement>('[data-menu-id="help"] .g499-icon');
  if (help) help.innerHTML = moonIcon('help');
  renderAssist();
  renderToggleItem('controls', touchOn, 'controls', 'Touch controls');
}

function renderAssist(): void {
  renderToggleItem('assist', assist, 'assist', 'Hover helper');
  assistBtn.setAttribute('aria-pressed', assist ? 'true' : 'false');
  assistBtn.classList.toggle('is-on', assist);
  assistBadge.hidden = !(assist && (phase === 'flying' || phase === 'ready'));
}

function updateUi(): void {
  const flyingish = phase === 'ready' || phase === 'flying';
  const cardOpen = !pickerEl.hidden || !helpEl.hidden;
  hud.setVisible(phase !== 'pick');
  readyEl.hidden = phase !== 'ready' || paused || cardOpen;
  // The pause card waits under the site picker and the help card.
  pauseOverlay.hidden = !paused || cardOpen;
  const showTouch = touchOn && flyingish && !paused;
  must<HTMLElement>('#throttle').hidden = !showTouch;
  must<HTMLElement>('#tilt-pad').hidden = !showTouch;
  appEl.classList.toggle('mt-touch-on', showTouch);
  assistBtn.hidden = !flyingish || paused || cardOpen;
  if (phase !== 'landed') debriefEl.hidden = true;
  if (!flyingish) calloutEl.hidden = true;
  renderAssist();
  shell.menu.refresh();
  stage.requestRender();
}

// ---------- Frame update ----------

function sceneLander(): LanderState {
  return flight && phase !== 'pick' ? flight.state : preview;
}

function update(dt: number): void {
  const f = flight;
  if (f && phase === 'ready' && !paused && !cardOpen()) {
    const intent = collectIntent(keys, touchOn ? touch : null);
    // Any engine or tilt input starts the descent.
    if (intent.leverRate > 0 || (intent.lever !== null && intent.lever > 0.05) || Math.hypot(intent.tiltX, intent.tiltZ) > 0.2) {
      actions++;
      startFlight();
    }
  }
  if (f && phase === 'flying' && !paused) {
    const intent = collectIntent(keys, touchOn ? touch : null);
    if (assist && (intent.lever !== null || intent.leverRate !== 0)) setAssist(false);
    const c = shaper.update(intent, dt);
    lastInput = { throttle: c.throttle, tiltX: c.tiltX, tiltZ: c.tiltZ, tiltActive: c.tiltActive, assist };
    stepCarry += dt;
    while (stepCarry >= DT - 1e-9 && f.phase === 'flying') {
      stepCarry -= DT;
      handleEvents(f.step(lastInput));
    }
    if (phase === 'flying') {
      predictClock += dt;
      if (predictClock >= PREDICT_EVERY - 1e-9) {
        predictClock = 0;
        prediction = predictTouchdown(f.terrain, f.state, lastInput, f.assistMemory(), { horizon: 75 });
      }
    }
  }
  if (phase === 'landed' && !paused) {
    landedFor += dt;
    if (!debriefShown && landedFor >= DEBRIEF_DELAY) showDebrief();
  }
  if (calloutLeft > 0 && !paused) {
    calloutLeft -= dt;
    if (calloutLeft <= 0) calloutEl.hidden = true;
  }
  sounds.engine(f && phase === 'flying' && !paused ? f.state.throttle : 0, dt);

  if (f && phase !== 'pick') {
    const s = f.state;
    hud.update({
      altitude: f.altitude,
      vy: s.vel.y,
      vx: s.vel.x,
      vz: s.vel.z,
      fuelSeconds: f.fuelSeconds,
      fullFuelSeconds: fullFuel,
      tiltX: s.tiltX,
      tiltZ: s.tiltZ,
      throttle: phase === 'flying' ? s.throttle : 0,
      hoverThrottle: hoverThrottle(s),
    });
    if (touchOn) {
      const lever = assist ? throttleToLever(s.throttle) : shaper.leverPosition;
      touch.showLever(lever, throttleToLever(hoverThrottle(s)));
    }
  }
}

// ---------- Wiring ----------

if (stage.kit) {
  const kit = stage.kit;
  const s = new MoonScene(kit, stage.rng, { reducedMotion: shell.reducedMotion, frozen: shell.testMode.frozen });
  scene = s;
  stage.run({
    update: (dt, t) => {
      update(dt);
      const lander = sceneLander();
      s.update(dt, t, {
        phase,
        lander,
        altitude: flight && phase !== 'pick' ? flight.altitude : 120,
        throttle: flight && phase === 'flying' ? flight.state.throttle : 0,
        prediction,
        landedFor,
        outcome: flight?.result?.verdict.outcome ?? null,
        paused,
      });
    },
    onResize: (w, h) => s.resize(w, h),
    onTierChange: (tier) => s.setTier(tier),
    dispose: () => {
      s.dispose();
      keys.dispose();
    },
  });
} else {
  // No WebGL: the sim still runs, so a timer drives it for the HUD and the debrief.
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    update(Math.min(1 / 15, (now - last) / 1000));
    last = now;
    requestAnimationFrame(tick);
  };
  if (!shell.testMode.frozen) requestAnimationFrame(tick);
}

/** A card (site picker, help, debrief) is open: flight keys do nothing until it closes. */
function cardOpen(): boolean {
  return !pickerEl.hidden || !helpEl.hidden || !debriefEl.hidden;
}

function onPrimary(source: InputSource): void {
  if (cardOpen()) return;
  if (paused) {
    setPaused(false);
    return;
  }
  const fromButton = source === 'keyboard' || source === 'gamepad' || source === 'ui';
  if (phase === 'ready') {
    if (fromButton) setAssist(true);
    startFlight();
    return;
  }
  if (phase === 'flying' && fromButton) setAssist(!assist);
}

stage.input.on((action, source) => {
  actions++;
  switch (action) {
    case 'primary':
      onPrimary(source);
      return;
    case 'pause':
      if ((phase === 'flying' || phase === 'ready') && !cardOpen()) setPaused(!paused);
      return;
    case 'menu':
      if (phase === 'flying' && !paused) setPaused(true);
      return;
    case 'mute':
      shell.synth.toggleMuted();
      return;
    default:
      // Directions: the flight reads held keys and sticks every frame instead.
      return;
  }
});

siteGrid.addEventListener('click', (e) => {
  const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('.mt-site');
  if (!card) return;
  actions++;
  shell.synth.tick();
  void selectSite(Number(card.dataset['index']));
});
pickerClose.addEventListener('click', () => closePicker());
pickerHelp.addEventListener('click', () => {
  pickerEl.hidden = true;
  openHelp();
});
helpClose.addEventListener('click', () => {
  helpEl.hidden = true;
  if (!flight) pickerEl.hidden = false;
  updateUi();
});
goBtn.addEventListener('click', () => {
  actions++;
  startFlight();
});
assistBtn.addEventListener('click', () => {
  actions++;
  if (phase === 'ready') {
    setAssist(true);
    startFlight();
  } else if (phase === 'flying') {
    setAssist(!assist);
  }
});
resumeButton.addEventListener('click', () => setPaused(false));
pauseOverlay.addEventListener('click', (e) => {
  if (e.target === pauseOverlay) setPaused(false);
});
retryBtn.addEventListener('click', () => {
  actions++;
  void selectSite(siteIdx);
});
nextBtn.addEventListener('click', () => {
  actions++;
  if (!nextBtn.disabled) void selectSite(siteIdx + 1);
});
sitesBtn.addEventListener('click', () => {
  actions++;
  openPicker();
});

// Opening the drawer on a phone pauses the flight.
shell.menu.toggleButton.addEventListener('click', () => {
  if (shell.menu.isOpen() && phase === 'flying' && !paused) setPaused(true);
});

// Leaving the page (tab switch, app switch) pauses; the lander waits in the sky.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && phase === 'flying') setPaused(true);
});

renderRailIcons();
renderPicker();
pickerEl.hidden = false;
updateUi();

function testState(): Record<string, unknown> {
  const f = flight;
  const r = f?.result ?? null;
  return {
    actions: actions + keys.pressed + touch.touches,
    phase,
    site: currentSite().slug,
    loading: loading !== null,
    altitude: f && phase !== 'pick' ? f.altitude : null,
    vs: f ? f.state.vel.y : 0,
    hs: f ? f.horizontalSpeed : 0,
    fuelSeconds: f ? f.fuelSeconds : 0,
    throttle: f ? f.state.throttle : 0,
    outcome: r ? r.verdict.outcome : null,
    reasons: r ? r.verdict.reasons : [],
    stars: r ? r.stars.stars : 0,
    tick: f ? f.tick : 0,
    paused,
    assist,
    debrief: !debriefEl.hidden,
    unlocked: progress.unlocked,
    touchControls: touchOn,
    stepFrames: TEST_STEP_FRAMES,
  };
}

// Show the first site behind the picker, then tell tests the page is ready.
void loadSource(currentSite()).then((src) => {
  showSource(currentSite(), src);
  stage.requestRender();
  stage.ready(testState);
});
