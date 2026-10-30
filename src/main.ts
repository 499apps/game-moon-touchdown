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
 * engine is never off by surprise). Moving the throttle takes over the engine at once: Help turns
 * off on the key press itself (not a frame later), the toast says "You fly now" and the HUD input
 * chip shows who flies. Tilt input keeps Help on the engine; the player steers.
 */
import './kit/styles.css';
import './game.css';
import type { InputSource } from './kit/input';
import { hashSeed, createRng } from './kit/prng';
import { createShell } from './kit/shell';
import { createStage } from './kit/stage';
import { readTestMode } from './kit/test-mode';
import { EdgeArrow, arrowInsets, placeEdge, type Insets } from './edgeArrows';
import { drawDescentChart } from './graphs';
import { Hud, vsLimits } from './hud';
import { moonIcon, type MoonIcon } from './icons';
import {
  TOAST_TEXT,
  activeSource,
  activityOf,
  chipView,
  handover,
  keyHintDue,
  toastFor,
  type Activity,
  type LastSource,
  type Toast,
} from './input/control';
import { HeldKeys, TouchControls, collectDevices } from './input/devices';
import { ControlShaper, KEYS, throttleToLever } from './input/mapping';
import { InputChip } from './inputChip';
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
import { assistFuelNeed, lowFuelPrompt, type LowFuelPrompt } from './sim/assist';
import { DEG, DT, LEG_DROP, STAR_FUEL_SECONDS } from './sim/constants';
import { Flight, flyHelper, type FlightEvent, type FlightResult, type PilotInput } from './sim/flight';
import {
  BUMP_TEXT,
  FUEL_STAR_TIP,
  fuelLeftText,
  fuelOutAdvice,
  helperFuelOutAdvice,
  helperLeftText,
} from './sim/judge';
import { createLander, hoverThrottle, type LanderState } from './sim/lander';
import { LIVE_INPUT_FADE, predictTouchdown, type Prediction } from './sim/predictor';
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
/** Below this view width (px) the layout is a phone: drawer menu, folded debrief. */
const PHONE_WIDTH = 720;
/** Below this view height (px) the screen is a landscape phone: the debrief folds too. */
const PHONE_SHORT = 500;
/** Default HUD band (px) before the HUD is measured. */
const DEFAULT_HUD_BAND = 64;
/** Seconds the "You fly now" / "Help flies the engine" toast stays (long enough for a young reader). */
const TOAST_TIME = 2.5;
/** The marker edge arrow hides when its clamped point is this close (px) to the visible marker. */
const MARKER_ARROW_NEAR = 40;
/** Engine keys: a press of one while Help flies hands the engine over on the key event itself. */
const ENGINE_CODES: ReadonlySet<string> = new Set([...KEYS.throttleUp, ...KEYS.throttleDown]);

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`moon-touchdown: missing ${selector}`);
  return el;
}

const appEl = must<HTMLElement>('.game-app');
const stageHost = must<HTMLElement>('#stage');
const hudEl = must<HTMLElement>('#hud');
const calloutEl = must<HTMLElement>('#callout');
const toastEl = must<HTMLElement>('#toast');
const toastIcon = must<HTMLElement>('#toast-icon');
const toastText = must<HTMLElement>('#toast-text');
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
const statTime = must<HTMLElement>('#stat-time');
const debriefMore = must<HTMLDetailsElement>('#debrief-more');
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
const readyTipKeys = must<HTMLElement>('#ready-tip-keys');
const tiltPadEl = must<HTMLElement>('#tilt-pad');
const throttleEl = must<HTMLElement>('#throttle');
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
/** The one-time "tap Help" and "Brake now" prompts already showed in this run. */
let helpPrompted = false;
let brakePrompted = false;
/** What the low-fuel prompt says now (manual flight), and the last prompt shown (for tests). */
let promptNow: LowFuelPrompt = null;
let promptShown: LowFuelPrompt = null;
/** Height (m) where the tank ran dry in this run, or null; and whether Help was flying then. */
let fuelOutHeight: number | null = null;
let fuelOutHelped = false;
/** Edge arrows: the ring and the marker are inside the usable frame. */
let ringOnScreen = false;
let markerOnScreen = false;
/** The lander centre is in the view, below the HUD band; its page position (px). */
let landerOnScreen = false;
const landerPx = { x: 0, y: 0 };
let stageBox = { left: 0, top: 0, width: 1, height: 1 };
/** Page boxes of the slider, the pad and the Help button while they show (they hide what is under them). */
let coverBoxes: DOMRect[] = [];
/** Bottom of the HUD band, in px from the stage top (0 while the HUD is hidden). */
let hudBottom = 0;
const ringPoint: ScreenPoint = { x: 0, y: 0, behind: false };
const markerPoint: ScreenPoint = { x: 0, y: 0, behind: false };
const landerPoint: ScreenPoint = { x: 0, y: 0, behind: false };
/** Test mode only: `?fuel=<kg>` sets the start fuel (to check the low-fuel prompt). */
const testFuel = (() => {
  if (!testMode.enabled) return null;
  const v = Number(new URLSearchParams(window.location.search).get('fuel'));
  return Number.isFinite(v) && v > 0 ? v : null;
})();
/** Where the last control input came from ('helper' = Help took the engine), and when (ms). */
let lastSource: LastSource = null;
let lastInputAt = 0;
/** Engine and tilt input from any device in the last frame (lights the chip glyphs). */
let activity: Activity = { engine: false, tilt: false };
/** Seconds of manual flight with no player input since Help turned off (for the key hint). */
let manualIdle = 0;
/** The one-time key hint already showed on this page; Help turned off in this flight. */
let keyHintShown = false;
let helpOffInFlight = false;
/** Seconds the toast stays, and the toast on screen. */
let toastLeft = 0;
let toastNow: Toast = null;
const sources = new Map<string, TerrainSource>();
const shaper = new ControlShaper();
const keys = new HeldKeys({
  // Flight keys belong to the flight while no card or drawer is open: no page scroll then.
  capture: () => !cardOpen() && !shell.menu.isOpen(),
  onChange: (pressed) => onKeysChanged(pressed),
});
const hud = new Hud(hudEl);
const inputChip = new InputChip(must<HTMLElement>('#input-chip'));

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
  slider: throttleEl,
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
  const start = startConditions(site, rng, src.terrain);
  if (testFuel !== null) start.fuel = testFuel;
  flight = new Flight(src.terrain, start);
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
  helpPrompted = false;
  brakePrompted = false;
  promptNow = null;
  promptShown = null;
  fuelOutHeight = null;
  fuelOutHelped = false;
  manualIdle = 0;
  helpOffInFlight = false;
  // New players: Help is armed on the ready screen (no toast yet), so the chip, the Help button
  // and the tip ("Help is on, slide to take over") agree. Engine input at ready still flies by
  // hand: the flight starts and Help hands the engine over on that frame ("You fly now").
  assist = !progress.solo;
  renderAssist();
  renderChip();
  hideToast();
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
  // Help armed on the ready screen flies the engine from now on: say so once.
  if (assist) showToast('help');
  updateUi();
}

/** Go (button, tap, Space): new players start with the helper on, so the engine is never off. */
function goWithDefaultHelp(forceHelp: boolean): void {
  if (forceHelp || !progress.solo) setAssist(true);
  startFlight();
}

/**
 * Help on or off. In a flight (or on the ready screen) the change shows at once: the Help button
 * and the rail item press or un-press, the toast says who flies, and the input chip follows.
 */
function setAssist(on: boolean): void {
  if (assist === on) {
    renderAssist();
    return;
  }
  assist = on;
  // Hand the engine back at the throttle the helper was using: no jump.
  if (!on && flight) shaper.setLever(throttleToLever(flight.state.throttle));
  if (on) noteInput('helper');
  else if (phase === 'flying') helpOffInFlight = true;
  manualIdle = 0;
  sounds.assist(on);
  if (phase === 'flying' || phase === 'ready') showToast(toastFor(on));
  renderAssist();
  renderChip();
  stage.requestRender();
}

/** Remember where the last control input came from. */
function noteInput(source: LastSource): void {
  lastSource = source;
  lastInputAt = performance.now();
}

/** Toast: "You fly now" (lander icon) or "Help flies the engine" (Help icon), polite live region. */
function showToast(kind: Toast): void {
  if (!kind) return;
  toastNow = kind;
  toastEl.dataset['kind'] = kind;
  toastIcon.innerHTML = moonIcon(kind === 'help' ? 'assist' : 'lander');
  toastText.textContent = TOAST_TEXT[kind];
  toastEl.hidden = false;
  toastLeft = TOAST_TIME;
  stackMessages();
}

function hideToast(): void {
  toastEl.hidden = true;
  toastNow = null;
  toastLeft = 0;
  stackMessages();
}

function hideCallout(): void {
  calloutEl.hidden = true;
  stackMessages();
}

/**
 * The call-out and the toast both sit just below the HUD band (--mt-hud-bottom). When both show,
 * the toast moves one row down, below the call-out (--mt-callout-h), so they never overlap.
 */
function stackMessages(): void {
  const both = !calloutEl.hidden && !toastEl.hidden;
  appEl.classList.toggle('mt-stack', both);
  if (both) appEl.style.setProperty('--mt-callout-h', `${Math.ceil(calloutEl.offsetHeight)}px`);
}

/**
 * A flight key went down or up. A new press counts as keyboard input at once. An engine key while
 * Help flies hands the engine over on this event, not a frame later; the chip lights now.
 */
function onKeysChanged(pressed: string | null): void {
  if (pressed !== null) {
    noteInput('keyboard');
    manualIdle = 0;
    const live = (phase === 'flying' || phase === 'ready') && !paused && !cardOpen();
    if (live && phase === 'flying') {
      const h = handover(assist, { engine: ENGINE_CODES.has(pressed), tilt: false });
      if (h.assist !== assist) setAssist(h.assist);
    }
  }
  renderChip();
  stage.requestRender();
}

/** The HUD input chip from the current state. */
function renderChip(): void {
  inputChip.update(chipView({ assist, touchOn, last: lastSource, held: keys.held, activity }));
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
  measureHud();
}

function handleEvents(events: FlightEvent[]): void {
  for (const e of events) {
    if (e.type === 'callout') {
      if (assist && e.seconds <= STAR_FUEL_SECONDS && helperCanLand()) {
        // The helper flies: the fuel star is gone, but nothing is wrong. Lemon, not red.
        showCallout('Fuel star gone. Help still lands safely.', 'warn', { icon: 'fuel' });
      } else {
        showCallout(`${e.seconds} seconds of fuel`, e.seconds <= STAR_FUEL_SECONDS ? 'bad' : 'warn', { icon: 'fuel' });
      }
      sounds.callout(e.seconds);
    } else if (e.type === 'fuel-out') {
      fuelOutHeight = flight ? flight.altitude : 0;
      fuelOutHelped = assist;
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

function showCallout(
  text: string,
  band: 'warn' | 'bad',
  opts: { icon?: MoonIcon; prompt?: boolean; key?: string; parts?: readonly (string | { key: string })[] } = {},
): void {
  calloutEl.textContent = '';
  if (opts.icon) {
    const icon = document.createElement('span');
    icon.className = 'mt-callout-icon';
    icon.innerHTML = moonIcon(opts.icon);
    calloutEl.append(icon);
  }
  calloutEl.append(document.createTextNode(text));
  const keyCap = (label: string) => {
    const key = document.createElement('kbd');
    key.className = 'mt-key';
    key.textContent = label;
    calloutEl.append(key);
  };
  if (opts.key) keyCap(opts.key);
  for (const p of opts.parts ?? []) {
    if (typeof p === 'string') calloutEl.append(document.createTextNode(` ${p} `));
    else keyCap(p.key);
  }
  calloutEl.classList.toggle('is-prompt', opts.prompt === true);
  calloutEl.dataset['band'] = band;
  calloutEl.hidden = false;
  calloutLeft = opts.prompt ? PROMPT_TIME : CALLOUT_TIME;
  stackMessages();
}

/** The helper's fuel need from here (hover-seconds, assistFuelNeed). */
function helperNeed(f: Flight): number {
  const s = f.state;
  return assistFuelNeed(f.altitude, s.vel.y, f.horizontalSpeed, hoverThrottle(s));
}

/** The helper can still land softly with the fuel left. */
function helperCanLand(): boolean {
  return flight !== null && flight.fuelSeconds >= helperNeed(flight);
}

/**
 * Low-fuel prompts for a manual pilot, driven by the helper's real fuel need (lowFuelPrompt), so
 * "tap Help to land safely" is only said while it is true. Each shows once per run:
 * - 'help': the helper can still land softly, only just. The Help button pulses.
 * - 'brake': too late for the helper, and the lander falls faster than the safe speed: brake now
 *   ("slide up" on the touch slider, the W key on a keyboard).
 * The 60 s and 30 s call-outs still play as before.
 */
function updateLowFuelPrompt(f: Flight): void {
  if (phase !== 'flying' || assist || !(f.fuelSeconds > 0)) {
    promptNow = null;
    return;
  }
  promptNow = lowFuelPrompt(f.fuelSeconds, helperNeed(f));
  if (promptNow === 'help' && !helpPrompted) {
    helpPrompted = true;
    promptShown = 'help';
    showCallout('Low fuel: tap Help to land safely', 'warn', { icon: 'assist', prompt: true });
    assistBtn.classList.remove('is-pulse');
    // Restart the pulse animation (it may have played on the ready screen): force a layout.
    assistBtn.getBoundingClientRect();
    assistBtn.classList.add('is-pulse');
  } else if (promptNow === 'brake' && !brakePrompted) {
    const down = -f.state.vel.y;
    if (down < vsLimits(f.altitude).green) return;
    brakePrompted = true;
    promptShown = 'brake';
    if (touchOn) showCallout('Brake now: slide up', 'warn', { icon: 'slideUp', prompt: true });
    else showCallout('Brake now: hold', 'warn', { icon: 'slideUp', prompt: true, key: 'W' });
  }
}

/**
 * First manual flight with the keyboard: when no flight key is pressed for 3 s after Help turned
 * off, show the keys once, with the same key caps as the ready tip and the help card.
 */
function updateKeyHint(dt: number): void {
  if (assist) {
    manualIdle = 0;
    return;
  }
  manualIdle += dt;
  const due = keyHintDue({
    flying: phase === 'flying' && !paused,
    assist,
    keyboard: !touchOn,
    done: keyHintShown || progress.solo || !helpOffInFlight,
    idle: manualIdle,
  });
  // A low-fuel prompt on screen goes first; the hint waits for it.
  if (!due || !calloutEl.hidden) return;
  keyHintShown = true;
  showCallout('Press', 'warn', {
    icon: 'keyboard',
    prompt: true,
    parts: [{ key: 'W' }, 'for engine,', { key: '←' }, { key: '→' }, 'to steer,', { key: 'Space' }, 'for Help'],
  });
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
    // The tank ran dry: explain why and give one tip, never blame. When Help was flying, the
    // text is about Help (it started too late), not about the child's braking.
    const advice = fuelOutHelped ? helperFuelOutAdvice() : fuelOutAdvice(fuelOutHeight);
    reason = `${advice.text} ${advice.tip}`;
    reasonIcon = fuelOutHelped ? 'assist' : 'fuel';
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
  statTime.textContent = `${Math.round(r.touchdown.time)} s`;
  // Phones fold the chart and the fact card into "More", so Again / Next / Sites stay in view.
  debriefMore.open = window.innerWidth >= PHONE_WIDTH && window.innerHeight >= PHONE_SHORT;
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
}

function updateUi(): void {
  const flyingish = phase === 'ready' || phase === 'flying';
  const cardOpen = !pickerEl.hidden || !helpEl.hidden;
  hud.setVisible(phase !== 'pick');
  readyEl.hidden = phase !== 'ready' || paused || cardOpen;
  // Touch, new players: "Help is on, slide to take over". After a solo landing: the touchdown
  // goals. Keyboard (touch pad off): "Press W for engine, arrows to steer, Space for Help".
  readyTipHelp.hidden = progress.solo || !touchOn;
  readyTipSolo.hidden = !progress.solo;
  readyTipKeys.hidden = touchOn;
  // The pause card waits under the site picker and the help card.
  pauseOverlay.hidden = !paused || cardOpen;
  const showTouch = touchOn && flyingish && !paused;
  throttleEl.hidden = !showTouch;
  tiltPadEl.hidden = !showTouch;
  appEl.classList.toggle('mt-touch-on', showTouch);
  assistBtn.hidden = !flyingish || paused || cardOpen;
  if (phase !== 'landed') debriefEl.hidden = true;
  if (!flyingish) {
    hideCallout();
    hideToast();
  }
  renderAssist();
  renderChip();
  shell.menu.refresh();
  measureCovers();
  stage.requestRender();
}

// ---------- Frame update ----------

function sceneLander(): LanderState {
  return flight && phase !== 'pick' ? flight.state : preview;
}

function update(dt: number): void {
  const f = flight;
  const live = (phase === 'ready' || phase === 'flying') && !paused && !cardOpen();
  const dev = collectDevices(keys, touchOn ? touch : null);
  const intent = dev.intent;
  activity = live ? activityOf(intent) : { engine: false, tilt: false };
  const source = live ? activeSource(dev) : null;
  if (source) {
    noteInput(source);
    manualIdle = 0;
  }
  if (f && phase === 'ready' && live) {
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
    // Player engine input takes the engine from Help on this frame (keys already did on the key
    // event). Help never moves the lever after that.
    const h = handover(assist, activityOf(intent));
    if (h.assist !== assist) setAssist(h.assist);
    if (assist && f.altitude < HELPED_HEIGHT) helpedRun = true;
    updateKeyHint(dt);
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
    updateLowFuelPrompt(f);
    if (phase === 'flying') {
      predictClock += dt;
      if (predictClock >= PREDICT_EVERY - 1e-9) {
        predictClock = 0;
        // While a key, the pad or a stick is held, the input is a short press, not a plan: the
        // prediction fades it to the helper's lean and to hover over 1.5 s, so steering toward the
        // ring does not throw the marker far away in red. With no input it holds the input as is.
        prediction = predictTouchdown(f.terrain, f.state, lastInput, f.assistMemory(), {
          horizon: PREDICT_HORIZON,
          fade: LIVE_INPUT_FADE,
          fadeTilt: activity.tilt,
          fadeThrottle: activity.engine && !assist,
        });
      }
    }
  }
  if (phase === 'landed' && !paused) {
    landedFor += dt;
    if (!debriefShown && landedFor >= DEBRIEF_DELAY) showDebrief();
  }
  if (calloutLeft > 0 && !paused) {
    calloutLeft -= dt;
    if (calloutLeft <= 0) hideCallout();
  }
  if (toastLeft > 0 && !paused) {
    toastLeft -= dt;
    if (toastLeft <= 0) hideToast();
  }
  renderChip();
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
      cmdTiltX: phase === 'flying' && !paused ? lastInput.tiltX : 0,
      cmdTiltZ: phase === 'flying' && !paused ? lastInput.tiltZ : 0,
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
        // The shaped command, not the lagged sim tilt: the thruster puffs answer on this frame.
        cmdTiltX: phase === 'flying' ? lastInput.tiltX : 0,
        cmdTiltZ: phase === 'flying' ? lastInput.tiltZ : 0,
        tiltHeld: phase === 'flying' && activity.tilt,
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
  measureHud();
  measureCovers();
}

/**
 * The HUD band: the bottom of the HUD (and, on phones, of the drawer button at the top left), in
 * px from the stage top. The flight camera keeps the lander below it; edge arrows stay below it.
 */
function measureHud(): void {
  let bottom = 0;
  if (!hudEl.hidden) bottom = hudEl.getBoundingClientRect().bottom - stageBox.top;
  if (window.innerWidth < PHONE_WIDTH) {
    const t = shell.menu.toggleButton.getBoundingClientRect();
    if (t.height > 0) bottom = Math.max(bottom, t.bottom - stageBox.top);
  }
  hudBottom = Math.max(0, bottom);
  // The call-out and the toast sit just below the HUD band, which wraps to 2 or 3 rows on phones.
  // (The stage starts at the top of .game-app, so the band is the same in both boxes.)
  if (hudBottom > 0) appEl.style.setProperty('--mt-hud-bottom', `${Math.ceil(hudBottom)}px`);
  stackMessages();
  scene?.setFrameInsets(hudBottom > 0 ? hudBottom : DEFAULT_HUD_BAND, cameraBottom());
}

function measureCovers(): void {
  coverBoxes = [];
  for (const el of [throttleEl, tiltPadEl, assistBtn]) {
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) coverBoxes.push(r);
  }
}

function underCover(x: number, y: number): boolean {
  return coverBoxes.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
}

/** Controls band for the flight camera (px): the touch controls fill the bottom 30% in portrait. */
function cameraBottom(): number {
  return touchOn && stageBox.height > stageBox.width ? stageBox.height * 0.3 : 40;
}

/** Controls band for the edge arrows (px): the slider, the pad and the Help button. */
function controlsBottom(): number {
  const w = stageBox.width;
  const h = stageBox.height;
  if (touchOn) return h > w ? h * 0.3 : 130;
  if (!assistBtn.hidden) return 120;
  return 20;
}

/** The usable frame: below the HUD, above the controls, the whole circle inside every side. */
function edgeInsets(): Insets {
  return arrowInsets(hudBottom > 0 ? hudBottom : DEFAULT_HUD_BAND, controlsBottom());
}

/** Where the lander is on screen (it must not slide under the HUD band). */
function updateLanderPoint(s: MoonScene): void {
  const p = sceneLander().pos;
  s.project(p.x, p.y, p.z, landerPoint);
  const x = (landerPoint.x * 0.5 + 0.5) * stageBox.width;
  const y = (0.5 - landerPoint.y * 0.5) * stageBox.height;
  landerPx.x = stageBox.left + x;
  landerPx.y = stageBox.top + y;
  landerOnScreen = !landerPoint.behind && x >= 0 && x <= stageBox.width && y >= hudBottom && y <= stageBox.height;
}

function updateEdges(s: MoonScene): void {
  const f = flight;
  updateLanderPoint(s);
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
    // The label sits on the inner side of the circle, so it never leaves the view.
    edgeRing.show(stageBox.left + pr.x, stageBox.top + pr.y, pr.angle, `${Math.round(away)} m`, pr.x > stageBox.width / 2);
  }
  const p = phase === 'flying' ? prediction : null;
  if (!p) {
    edgeMarker.hide();
    markerOnScreen = false;
    return;
  }
  s.project(p.x, s.groundAt(p.x, p.z) + 0.5, p.z, markerPoint);
  const pm = placeEdge(markerPoint.x, markerPoint.y, markerPoint.behind, stageBox.width, stageBox.height, inset);
  // The marker counts as seen when it is inside the stage, below the HUD band and not under the
  // slider, the pad or the Help button. Then (or when the arrow would sit right on it) no arrow:
  // two symbols for one spot hide the marker colour near touchdown.
  const mx = (markerPoint.x * 0.5 + 0.5) * stageBox.width;
  const my = (0.5 - markerPoint.y * 0.5) * stageBox.height;
  const inStage = !markerPoint.behind && mx >= 0 && mx <= stageBox.width && my >= hudBottom && my <= stageBox.height;
  const covered = inStage && underCover(stageBox.left + mx, stageBox.top + my);
  const seen = inStage && !covered;
  const near = inStage && !covered && Math.hypot(pm.x - mx, pm.y - my) < MARKER_ARROW_NEAR;
  markerOnScreen = pm.onScreen || seen;
  if (pm.onScreen || seen || near) edgeMarker.hide();
  else {
    const band = p.outcome === 'soft' ? 'good' : p.vs < 4 ? 'warn' : 'bad';
    if (edgeMarker.element.dataset['band'] !== band) edgeMarker.element.dataset['band'] = band;
    edgeMarker.show(stageBox.left + pm.x, stageBox.top + pm.y, pm.angle, undefined, pm.x > stageBox.width / 2);
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
      if (source === 'keyboard') noteInput('keyboard');
      else if (source === 'gamepad') noteInput('pad');
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
// The chart is drawn at its shown size: draw it again when "More" opens on a phone.
debriefMore.addEventListener('toggle', () => {
  if (debriefMore.open && flight && !debriefEl.hidden) drawDescentChart(chartEl, flight.trace);
});

// Opening the drawer on a phone pauses the flight.
shell.menu.toggleButton.addEventListener('click', () => {
  if (shell.menu.isOpen() && phase === 'flying' && !paused) setPaused(true);
});

// Leaving the page (tab switch, app switch) pauses; the lander waits in the sky. HeldKeys drops
// the held keys too, so no key sticks when the page comes back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && phase === 'flying') setPaused(true);
});

/**
 * A mouse or touch click on a rail or game button leaves the focus on it, and Space would click
 * that button again instead of reaching the flight. After such a click (detail > 0; keyboard
 * activation has detail 0 and keeps the focus for keyboard users), the button lets go of the
 * focus, unless its handler moved the focus on purpose (help card, debrief, drawer).
 * Hold-to-confirm buttons keep it (blur cancels the hold).
 */
document.addEventListener('click', (e) => {
  if (e.detail === 0) return;
  // The dispatch path, not target.closest(): a handler may swap the button's icon markup, which
  // detaches the clicked SVG node from its button before this listener runs.
  const btn = e
    .composedPath()
    .find((n): n is HTMLElement => n instanceof HTMLElement && n.matches('button, summary'));
  if (!btn || btn.classList.contains('g499-menu-hold')) return;
  if (document.activeElement === btn) btn.blur();
});

// The HUD band changes when the HUD shows, wraps or resizes: the camera and the arrows follow.
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => measureHud()).observe(hudEl);

renderRailIcons();
renderPicker();
pickerEl.hidden = false;
measureStage();
updateUi();

/** The ring edge arrow shows and its whole box is inside the stage (test state only). */
function ringArrowInStage(): boolean {
  if (edgeRing.element.hidden) return false;
  const a = edgeRing.element.getBoundingClientRect();
  const st = stageHost.getBoundingClientRect();
  return a.width > 0 && a.left >= st.left - 0.5 && a.right <= st.right + 0.5 && a.top >= st.top - 0.5 && a.bottom <= st.bottom + 0.5;
}

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
    ringArrowOnScreen: ringArrowInStage(),
    landerOnScreen,
    landerPx: { x: landerPx.x, y: landerPx.y },
    hudBottom,
    fuelNeed: f && (phase === 'ready' || phase === 'flying') ? helperNeed(f) : null,
    lowFuelPrompt: promptNow,
    promptShown,
    debrief: !debriefEl.hidden,
    unlocked: progress.unlocked,
    touchControls: touchOn,
    stepFrames: TEST_STEP_FRAMES,
    // Controls (F4): where the last input came from and how long ago (ms), the held keys, the
    // lever (the helper's lever while Help flies), the player's tilt command and the lander's
    // real tilt (the model is drawn with it), both in degrees: +x = right (east), +z = toward
    // the camera (south).
    lastInputSource: lastSource,
    lastInputAgeMs: lastSource === null ? null : performance.now() - lastInputAt,
    heldKeys: Array.from(keys.held),
    litKeys: inputChip.litCaps(),
    lever: assist && f ? throttleToLever(f.state.throttle) : shaper.leverPosition,
    tiltX: lastInput.tiltX / DEG,
    tiltZ: lastInput.tiltZ / DEG,
    landerTilt: f ? { x: f.state.tiltX / DEG, z: f.state.tiltZ / DEG, deg: Math.hypot(f.state.tiltX, f.state.tiltZ) / DEG } : null,
    time: f ? f.state.t : 0,
    vx: f ? f.state.vel.x : 0,
    posX: f ? f.state.pos.x : 0,
    toast: toastNow ? TOAST_TEXT[toastNow] : null,
    keyHintShown,
    // Visible answers on the lander itself (R3 finding 1): attitude-thruster puffs alive now, and
    // the engine's share (0..1) in the halo tint and size high up.
    rcsPuffs: scene ? scene.rcsPuffs : 0,
    haloThrottle: scene ? scene.haloThrottle : 0,
  };
}

// Show the first site behind the picker, then tell tests the page is ready.
void loadSource(currentSite()).then((src) => {
  showSource(currentSite(), src);
  stage.requestRender();
  stage.ready(testState);
});
