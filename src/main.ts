/**
 * Moon Touchdown: boots the kit shell (left rail, audio, service worker) and the 3D stage, loads
 * the real terrain for a site, then runs the flight: input -> pure sim (src/sim) -> scene, HUD,
 * sounds, call-outs and the debrief.
 *
 * Controls: left slider / W S / left stick = engine; right pad / arrow keys / I J K L / right
 * stick = tilt; the big Help button, Space or gamepad A = hover helper; P pauses. Sites, pause,
 * restart, help, touch pad, how to fly, sound, home and clear-data live in the left rail.
 *
 * Until the player has landed softly once without the helper, Go starts with the helper on (the
 * engine is never off by surprise). Moving the throttle takes over the engine at once.
 */
import './kit/styles.css';
import './game.css';
import type { InputSource } from './kit/input';
import { hashSeed, createRng } from './kit/prng';
import { createShell } from './kit/shell';
import { createStage } from './kit/stage';
import { readTestMode } from './kit/test-mode';
import { EdgeArrow, placeEdge, type Insets } from './edgeArrows';
import { drawDescentChart } from './graphs';
import { Hud } from './hud';
import { moonIcon, type MoonIcon } from './icons';
import { HeldKeys, TouchControls, collectIntent } from './input/devices';
import { ControlShaper, throttleToLever } from './input/mapping';
import { moonMapSvg } from './moonMap';
import {
  CONTROLS_KEY,
  bestHelped,
  bestStars,
  emptyProgress,
  isUnlocked,
  loadProgress,
  recordRun,
  saveProgress,
} from './progress';
import { MoonScene, SUN, type ScenePhase, type ScreenPoint } from './scene/moonScene';
import { bakeSunShadow } from './scene/shade';
import type { TerrainSource } from './scene/terrainView';
import { DT, LEG_DROP, LOW_FUEL_PROMPT_SECONDS } from './sim/constants';
import { Flight, flyHelper, type FlightEvent, type FlightResult, type PilotInput } from './sim/flight';
import { BUMP_TEXT, FUEL_STAR_TIP, fuelLeftText, fuelOutAdvice, helperLeftText } from './sim/judge';
import { createLander, hoverThrottle, type LanderState } from './sim/lander';
import { predictTouchdown, type Prediction } from './sim/predictor';
import {
  GRAVITY_FACT,
  GRID,
  REAL_GROUND_FACT,
  SITES,
  crewLine,
  factFor,
  startConditions,
  type SiteInfo,
} from './sim/sites';
import { Terrain } from './sim/terrain';
import { MoonSounds } from './sound';

type Phase = ScenePhase;

/** Seconds after touchdown before the debrief card slides in (the dust settles first). */
const DEBRIEF_DELAY = 1.6;
/** Seconds a fuel call-out stays on screen, and the longer low-fuel prompt. */
const CALLOUT_TIME = 2.6;
const PROMPT_TIME = 4.5;
/** Seconds between touchdown predictions, and how far ahead they look (s). */
const PREDICT_EVERY = 0.1;
const PREDICT_HORIZON = 110;
/** Frames the test API suggests per step call (the sim is cheap). */
const TEST_STEP_FRAMES = 600;
/** During a helper flight, the ring arrow and the tilt pad pulse once at this height (m). */
const STEER_HINT_HEIGHT = 200;
/** The helper counts as "flew the landing" when it was on below this height (m). */
const HELPED_HEIGHT = 60;

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
const fuelLeftEl = must<HTMLElement>('#fuel-left-text');
const fuelNoteStar = must<HTMLElement>('#fuel-note-star');
const fuelHelperEl = must<HTMLElement>('#fuel-helper');
const fuelHelperText = must<HTMLElement>('#fuel-helper-text');
const chartEl = must<HTMLCanvasElement>('#chart');
const factSite = must<HTMLElement>('#fact-site');
const factGravity = must<HTMLElement>('#fact-gravity');
const factMap = must<HTMLElement>('#fact-map');
const factReal = must<HTMLElement>('#fact-real');
const factCrew = must<HTMLElement>('#fact-crew');
const factTalkText = must<HTMLElement>('#fact-talk-text');
const readyTipHelp = must<HTMLElement>('#ready-tip-help');
const readyTipSolo = must<HTMLElement>('#ready-tip-solo');
const tiltPadEl = must<HTMLElement>('#tilt-pad');
const edgeRing = new EdgeArrow(must<HTMLElement>('#edge-ring'));
const edgeMarker = new EdgeArrow(must<HTMLElement>('#edge-marker'));
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
/** The helper flew the landing in this run (on below HELPED_HEIGHT or at touchdown). */
let helpedRun = false;
/** The 200 m steering hint already played in this run. */
let steerHinted = false;
/** The Help button pulsed once on the first ready screen of this page. */
let helpPulsed = false;
/** The one-time "Low fuel: tap Help" prompt already showed in this run. */
let lowFuelPrompted = false;
/** Height (m) where the tank ran dry in this run, or null. */
let fuelOutHeight: number | null = null;
/** Edge arrows: the ring and the marker are inside the usable frame. */
let ringOnScreen = false;
let markerOnScreen = false;
let stageBox = { left: 0, top: 0, width: 1, height: 1 };
const ringPoint: ScreenPoint = { x: 0, y: 0, behind: false };
const markerPoint: ScreenPoint = { x: 0, y: 0, behind: false };
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
    { kind: 'button', id: 'assist', label: 'Help', icon: 'games', onSelect: () => setAssist(!assist) },
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
    // Calibrated with the sun (6.5) and the regolith colours: lit flat ground is mid grey.
    exposure: 0.9,
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
  const src: TerrainSource = { terrain, lit: bakeSunShadow(terrain, SUN), seed: hashSeed(site.slug), look: site.look };
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
  helpedRun = false;
  steerHinted = false;
  lowFuelPrompted = false;
  fuelOutHeight = null;
  edgeRing.pulse(false);
  tiltPadEl.classList.remove('is-pulse');
  // The first ready screen of a new player: the Help button pulses once.
  assistBtn.classList.toggle('is-pulse', !helpPulsed && !progress.solo);
  helpPulsed = true;
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
  assistBtn.classList.remove('is-pulse');
  sounds.start();
  updateUi();
}

/** Go (button, tap, Space): new players start with the helper on, so the engine is never off. */
function goWithDefaultHelp(forceHelp: boolean): void {
  if (forceHelp || !progress.solo) setAssist(true);
  startFlight();
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
      showCallout(`${e.seconds} seconds of fuel`, e.seconds <= 30 ? 'bad' : 'warn', { icon: 'fuel' });
      sounds.callout(e.seconds);
    } else if (e.type === 'fuel-out') {
      fuelOutHeight = flight ? flight.altitude : 0;
      showCallout('Out of fuel', 'bad', { icon: 'fuel' });
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
  if (assist) helpedRun = true;
  const soft = r.verdict.outcome === 'soft';
  sounds.touchdown();
  if (soft) sounds.soft();
  else sounds.bumpy();
  // A short buzz on phones that have it (Android). No network, no permission.
  if (touchOn && !shell.synth.muted && !shell.reducedMotion && !testMode.enabled) {
    navigator.vibrate?.(soft ? 30 : [40, 60, 40]);
  }
  progress = recordRun(progress, siteIdx, soft, r.stars.stars, helpedRun);
  saveProgress(shell.storage, progress);
  renderPicker();
  updateUi();
}

function showCallout(text: string, band: 'warn' | 'bad', opts: { icon?: MoonIcon; prompt?: boolean } = {}): void {
  calloutEl.textContent = '';
  if (opts.icon) {
    const icon = document.createElement('span');
    icon.className = 'mt-callout-icon';
    icon.innerHTML = moonIcon(opts.icon);
    calloutEl.append(icon);
  }
  calloutEl.append(document.createTextNode(text));
  calloutEl.classList.toggle('is-prompt', opts.prompt === true);
  calloutEl.dataset['band'] = band;
  calloutEl.hidden = false;
  calloutLeft = opts.prompt ? PROMPT_TIME : CALLOUT_TIME;
}

/**
 * A manual pilot low on fuel: one gentle prompt per run, and the Help button pulses. The helper
 * can take over at any time; the 60 s and 30 s call-outs still play as before.
 */
function promptLowFuel(): void {
  lowFuelPrompted = true;
  showCallout('Low fuel: tap Help to land safely', 'warn', { icon: 'assist', prompt: true });
  assistBtn.classList.remove('is-pulse');
  // Restart the pulse animation (it may have played on the ready screen): force a layout.
  assistBtn.getBoundingClientRect();
  assistBtn.classList.add('is-pulse');
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
    const helped = best > 0 && bestHelped(progress, s.slug);
    const label = open
      ? `${s.name}, difficulty ${s.difficulty} of ${SITES.length}, best ${best} of 3 stars${helped ? ', with help' : ''}`
      : `${s.name}, locked: land softly on the site before it`;
    const helpMark = helped ? `<span class="mt-site-helped">${moonIcon('assist', 'g499-icon-svg')}</span>` : '';
    return `<button type="button" class="mt-site${open ? '' : ' is-locked'}${busy ? ' is-loading' : ''}${i === siteIdx ? ' is-current' : ''}" data-index="${i}" data-slug="${s.slug}" aria-label="${label}"${open ? '' : ' aria-disabled="true"'}>
      <span class="mt-site-map" aria-hidden="true">${moonMapSvg(s.lat, s.lon, 'mt-site-map-svg')}</span>
      <span class="mt-site-emblem" data-level="${s.difficulty}">${open ? moonIcon('lander', 'mt-site-svg') : moonIcon('lock', 'mt-site-svg')}</span>
      <span class="mt-site-name">${s.name}</span>
      <span class="mt-site-dots" aria-hidden="true">${difficultyDots(s.difficulty)}</span>
      <span class="mt-site-stars" aria-hidden="true">${starRow(best, 'mt-site-star')}${helpMark}</span>
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
  let reasonIcon: MoonIcon | null = null;
  if (fuelOutHeight !== null && !r.stars.fuel) {
    // The tank ran dry: explain why and give one tip, never blame.
    const advice = fuelOutAdvice(fuelOutHeight);
    reason = `${advice.text} ${advice.tip}`;
    reasonIcon = 'fuel';
  } else if (!soft) {
    reason = r.verdict.reasons.map((k) => BUMP_TEXT[k]).slice(0, 2).join(' ');
  } else if (!r.stars.close) {
    // Say who steers: the helper flies the engine only, the child tilts toward the ring.
    reason = helpedRun
      ? 'The helper flies the engine. You steer: tilt toward the ring.'
      : 'Land inside the green ring for another star.';
    reasonIcon = helpedRun ? 'tilt' : 'target';
  } else if (!r.stars.fuel) {
    reason = helpedRun ? 'The helper is careful, so it uses a lot of fuel. Fly the engine yourself to keep 30 s for the star.' : FUEL_STAR_TIP;
    reasonIcon = 'fuel';
  }
  outcomeReason.textContent = '';
  if (reasonIcon) {
    const icon = document.createElement('span');
    icon.className = 'mt-reason-icon';
    icon.innerHTML = moonIcon(reasonIcon);
    outcomeReason.append(icon);
  }
  outcomeReason.append(document.createTextNode(reason));
  outcomeReason.hidden = reason === '';
  starsEl.innerHTML = starRow(r.stars.stars, 'mt-star');
  starsEl.setAttribute('aria-label', `${r.stars.stars} of 3 stars`);
  statVs.textContent = `${r.touchdown.vs.toFixed(1)} m/s`;
  statHs.textContent = `${r.touchdown.hs.toFixed(1)} m/s`;
  statDist.textContent = `${Math.round(r.distance)} m`;
  statFuel.textContent = `${Math.floor(r.touchdown.fuelSeconds)} s`;
  statTime.textContent = `${Math.round(r.touchdown.time)} s`;
  showFuelNote(flight, r);
  factMap.innerHTML = moonMapSvg(site.lat, site.lon, 'mt-fact-map-svg', `Where ${site.name} is on the Moon`);
  factSite.textContent = factFor(site, runCount - 1);
  factReal.textContent = REAL_GROUND_FACT;
  factCrew.textContent = soft ? crewLine(site, r.touchdown.vs) : '';
  factCrew.hidden = !soft;
  factGravity.textContent = GRAVITY_FACT;
  factTalkText.textContent = site.talk;
  const next = siteIdx + 1;
  nextBtn.disabled = !(next < SITES.length && isUnlocked(progress, next));
  debriefEl.hidden = false;
  drawDescentChart(chartEl, flight.trace);
  retryBtn.focus({ preventScroll: true });
}

/**
 * "Fuel left: N s (star at 30 s)" with a star that fills when earned. When a star was missed on a
 * run the child flew, also "Helper would have left ~M s": a what-if helper run from the same
 * start on the same ground, so the child sees the number to beat.
 */
function showFuelNote(f: Flight, r: FlightResult): void {
  fuelLeftEl.textContent = fuelLeftText(r.touchdown.fuelSeconds);
  fuelNoteStar.innerHTML = moonIcon('star', 'g499-icon-svg', r.stars.fuel);
  fuelNoteStar.classList.toggle('is-on', r.stars.fuel);
  let helperText = '';
  if (!helpedRun && (!r.stars.fuel || !r.stars.close)) {
    const whatIf = flyHelper(f.terrain, f.start).flight.result;
    if (whatIf && whatIf.verdict.outcome === 'soft') helperText = helperLeftText(whatIf.touchdown.fuelSeconds);
  }
  fuelHelperText.textContent = helperText;
  fuelHelperEl.hidden = helperText === '';
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
  // New players: "Help is on, slide to take over". After a solo landing: the touchdown goals.
  readyTipHelp.hidden = progress.solo;
  readyTipSolo.hidden = !progress.solo;
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
    // Any engine or tilt input starts the descent. Engine input flies by hand; a tilt-only start
    // keeps the default helper for new players, so the engine is not off by surprise.
    const engine = intent.leverRate > 0 || (intent.lever !== null && intent.lever > 0.05);
    if (engine || Math.hypot(intent.tiltX, intent.tiltZ) > 0.2) {
      actions++;
      if (engine) startFlight();
      else goWithDefaultHelp(false);
    }
  }
  if (f && phase === 'flying' && !paused) {
    const intent = collectIntent(keys, touchOn ? touch : null);
    if (assist && (intent.lever !== null || intent.leverRate !== 0)) setAssist(false);
    if (assist && f.altitude < HELPED_HEIGHT) helpedRun = true;
    // Helper flight: at 200 m, pulse the ring arrow and the tilt pad once ("you steer").
    if (assist && !steerHinted && f.altitude < STEER_HINT_HEIGHT) {
      steerHinted = true;
      edgeRing.pulse(true);
      tiltPadEl.classList.add('is-pulse');
    }
    const c = shaper.update(intent, dt);
    lastInput = { throttle: c.throttle, tiltX: c.tiltX, tiltZ: c.tiltZ, tiltActive: c.tiltActive, assist };
    stepCarry += dt;
    while (stepCarry >= DT - 1e-9 && f.phase === 'flying') {
      stepCarry -= DT;
      handleEvents(f.step(lastInput));
    }
    if (phase === 'flying' && !assist && !lowFuelPrompted && f.fuelSeconds > 0 && f.fuelSeconds < LOW_FUEL_PROMPT_SECONDS) {
      promptLowFuel();
    }
    if (phase === 'flying') {
      predictClock += dt;
      if (predictClock >= PREDICT_EVERY - 1e-9) {
        predictClock = 0;
        prediction = predictTouchdown(f.terrain, f.state, lastInput, f.assistMemory(), { horizon: PREDICT_HORIZON });
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
      assist,
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
      updateEdges(s);
    },
    onResize: (w, h) => {
      s.resize(w, h);
      measureStage();
    },
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

// ---------- Edge arrows ----------

function measureStage(): void {
  const r = stageHost.getBoundingClientRect();
  stageBox = { left: r.left, top: r.top, width: Math.max(1, r.width), height: Math.max(1, r.height) };
}

/** The usable frame: below the HUD, above the touch controls, inside the safe areas. */
function edgeInsets(): Insets {
  const w = stageBox.width;
  const h = stageBox.height;
  const phone = window.innerWidth < 720;
  const side = phone ? 44 : 28;
  let bottom = 28;
  if (touchOn) bottom = h > w ? h * 0.3 : 130;
  else if (!assistBtn.hidden) bottom = 120;
  return { top: phone ? 150 : 96, right: side, bottom, left: side };
}

function updateEdges(s: MoonScene): void {
  const f = flight;
  if (!f || (phase !== 'ready' && phase !== 'flying') || paused || cardOpen()) {
    edgeRing.hide();
    edgeMarker.hide();
    ringOnScreen = false;
    markerOnScreen = false;
    return;
  }
  const inset = edgeInsets();
  s.project(0, s.targetHeight + 1, 0, ringPoint);
  const pr = placeEdge(ringPoint.x, ringPoint.y, ringPoint.behind, stageBox.width, stageBox.height, inset);
  ringOnScreen = pr.onScreen;
  if (pr.onScreen) edgeRing.hide();
  else {
    const away = Math.hypot(f.state.pos.x, f.state.pos.z);
    edgeRing.show(stageBox.left + pr.x, stageBox.top + pr.y, pr.angle, `${Math.round(away)} m`);
  }
  const p = phase === 'flying' ? prediction : null;
  if (!p) {
    edgeMarker.hide();
    markerOnScreen = false;
    return;
  }
  s.project(p.x, s.groundAt(p.x, p.z) + 0.5, p.z, markerPoint);
  const pm = placeEdge(markerPoint.x, markerPoint.y, markerPoint.behind, stageBox.width, stageBox.height, inset);
  markerOnScreen = pm.onScreen;
  if (pm.onScreen) edgeMarker.hide();
  else {
    const band = p.outcome === 'soft' ? 'good' : p.vs < 4 ? 'warn' : 'bad';
    if (edgeMarker.element.dataset['band'] !== band) edgeMarker.element.dataset['band'] = band;
    edgeMarker.show(stageBox.left + pm.x, stageBox.top + pm.y, pm.angle);
  }
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
    goWithDefaultHelp(fromButton);
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
  goWithDefaultHelp(false);
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
measureStage();
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
    helped: helpedRun,
    solo: progress.solo,
    ringOnScreen,
    markerOnScreen,
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
