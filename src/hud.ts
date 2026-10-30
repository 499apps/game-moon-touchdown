/**
 * Flight HUD: height above the ground, speed down with green / yellow / red bands, a sideways
 * drift arrow, fuel in seconds with the 60 s mark and a star tick at the fuel-star line (30 s),
 * and a tilt ball. Colours and shapes first,
 * few words. Writes to the DOM only when a shown value changes.
 *
 * The speed-down bands follow the height: fast is fine high up, slow near the ground. The safe
 * envelope is the hover helper's target speed, so correct helper flight always shows green. In
 * manual flight yellow means "fast but stoppable" and red means "brake now" (vsStopLimit).
 * In manual flight above 10 m a calm "slow" zone sits below green (F6): falling much slower than
 * the helper hovers away the fuel. It is never a failure and never red.
 * While the helper flies, or while the helper could still land softly (manual flight), the fuel bar
 * stays lemon below the star line (src/game.css): red means "the helper cannot save it now".
 */
import { assistTargetVs } from './sim/assist';
import { CALLOUTS, G_MOON, MAX_TILT, STAR_FUEL_SECONDS } from './sim/constants';
import { moonIcon, type MoonIcon } from './icons';

export interface HudView {
  altitude: number;
  /** Vertical velocity (m/s, negative = down). */
  vy: number;
  vx: number;
  vz: number;
  fuelSeconds: number;
  /** Fuel seconds at the start of the run (full bar). */
  fullFuelSeconds: number;
  tiltX: number;
  tiltZ: number;
  /**
   * The player's tilt command (rad). A ring on the tilt ball jumps to it on the frame of a key
   * press, before the lander has turned: the instant tilt cue.
   */
  cmdTiltX: number;
  cmdTiltZ: number;
  /** Applied throttle (0..1) and the throttle that would hover now. */
  throttle: number;
  hoverThrottle: number;
  /** The hover helper flies the engine (the speed mark does not blink then). */
  assist: boolean;
  /**
   * Low fuel is not danger yet: Help flies, or the helper could still land softly with the fuel
   * left (R4 finding 1). The fuel bar then stays lemon below the star line, not red.
   */
  fuelCalm?: boolean;
}

/** Speed-down bands near the ground (m/s): green under 2, yellow under 4. */
export const VS_BAR_MAX = 8;
export const VS_GREEN = 2;
export const VS_YELLOW = 4;
/** Below this height (m) the strict touchdown bands apply. */
export const VS_STRICT_HEIGHT = 10;
/** Above the safe envelope: green up to +0.5 m/s, yellow up to +2.5 m/s. */
export const VS_GREEN_SLACK = 0.5;
export const VS_YELLOW_SLACK = 2.5;
/**
 * Manual flight above the strict height: below this share of the safe speed the band is 'slow'
 * (F6). So green is [0.85 x safe, safe + 0.5] and its middle is 0.925 x safe + 0.25 m/s: about the
 * helper's speed, so a child who keeps the mark in the middle of green uses about the helper's
 * fuel per metre (DESIGN section 4), not twice as much.
 */
export const VS_SLOW_SHARE = 0.85;

/** 'slow' = slower than needed up high (uses fuel, never a failure); then green, yellow, red. */
export type Band = 'slow' | 'good' | 'warn' | 'bad';

export interface VsLimits {
  /** Below this speed down (m/s) the band is 'slow' (manual flight above 10 m; else 0). */
  slow: number;
  /** Below this speed down (m/s) the band is green. */
  green: number;
  /** Below this speed down (m/s) the band is yellow; red above. */
  yellow: number;
}

/** Manual flight: red starts where braking at this share of the spare thrust only just stops in time. */
export const VS_RED_BRAKE_SHARE = 0.75;
/** Manual flight: above this speed down (m/s) the band is red at any height (keeps the bar readable). */
export const VS_MANUAL_CAP = 25;

/** Who flies the engine, and the hover throttle (the hover mark on the engine bar). */
export interface VsMode {
  assist: boolean;
  hoverThrottle: number;
}

/** Safe speed down at a height (m/s): the helper's target, never below the touchdown limit. */
export function vsEnvelope(height: number): number {
  return Math.max(VS_GREEN, -assistTargetVs(height));
}

/**
 * Manual flight: the fastest speed down (m/s) that braking at VS_RED_BRAKE_SHARE of the spare
 * thrust (full thrust upright minus gravity) still brings to VS_YELLOW at the strict height. Above
 * it, a soft touchdown needs more than that share of the engine: real danger, so red.
 */
export function vsStopLimit(height: number, hoverThr: number, g = G_MOON): number {
  const h = Number.isFinite(height) ? height : 0;
  const spare = g / Math.max(1e-3, Number.isFinite(hoverThr) ? hoverThr : 1) - g;
  if (!(spare > 0)) return VS_YELLOW;
  return Math.sqrt(VS_YELLOW * VS_YELLOW + 2 * VS_RED_BRAKE_SHARE * spare * Math.max(0, h - VS_STRICT_HEIGHT));
}

/**
 * The band limits for speed down at a height above the ground.
 * - Slow, manual flight above 10 m only: below VS_SLOW_SHARE x the safe speed. Helper flight
 *   (and no mode given) has no slow zone, so it always reads green.
 * - Green: the helper's safe speed + 0.5 m/s (helper flight is always green).
 * - Yellow, helper flight (and no mode given): the safe speed + 2.5 m/s.
 * - Yellow, manual flight: "fast but stoppable", up to the stopping limit (vsStopLimit, at most
 *   VS_MANUAL_CAP). So the fuel-star technique (fall fast, brake late and hard) shows yellow, and
 *   red always means "brake now".
 * Below 10 m the strict touchdown bands apply in both modes (slow is good near the ground).
 */
export function vsLimits(height: number, mode?: VsMode): VsLimits {
  const h = Number.isFinite(height) ? height : 0;
  if (h < VS_STRICT_HEIGHT) return { slow: 0, green: VS_GREEN, yellow: VS_YELLOW };
  const safe = vsEnvelope(h);
  const green = safe + VS_GREEN_SLACK;
  let yellow = safe + VS_YELLOW_SLACK;
  if (!mode || mode.assist) return { slow: 0, green, yellow };
  yellow = Math.max(yellow, Math.min(VS_MANUAL_CAP, vsStopLimit(h, mode.hoverThrottle)));
  return { slow: VS_SLOW_SHARE * safe, green, yellow };
}

/** The middle of the green band (m/s): where a child aims the speed mark. */
export function vsGreenMiddle(lim: VsLimits): number {
  return (lim.slow + lim.green) / 2;
}

/** Colour band of a downward speed (m/s, >= 0) at a height (m). Height 0 = touchdown rules. */
export function vsBand(down: number, height = 0, mode?: VsMode): Band {
  const lim = vsLimits(height, mode);
  if (down < lim.slow) return 'slow';
  if (down < lim.green) return 'good';
  if (down < lim.yellow) return 'warn';
  return 'bad';
}

/** Above this speed up (m/s) the lander counts as climbing. */
export const VS_CLIMB = 0.05;

/**
 * The band the HUD shows for a vertical velocity (m/s, negative = down). Climbing counts as zero
 * speed down: green near the ground and in helper flight, 'slow' in manual flight up high.
 */
export function speedBand(vy: number, height: number, mode?: VsMode): Band {
  const v = Number.isFinite(vy) ? vy : 0;
  return vsBand(v > VS_CLIMB ? 0 : Math.max(0, -v), Math.max(0, height), mode);
}

/** Colour of the touchdown marker and its edge arrow: lime, lemon or coral. */
export type MarkerBand = 'good' | 'warn' | 'bad';

/**
 * The touchdown marker colour (R4 finding 1). In manual flight at VS_STRICT_HEIGHT and above, the
 * marker follows the HUD speed band (slow and green read lime): with the hover notch, "input held"
 * keeps the speed to the ground, so the predicted touchdown would read "bumpy" for a correct
 * descent. Below that height, and in helper flight, it shows the predicted touchdown.
 */
export function markerBand(
  predicted: { outcome: 'soft' | 'bumpy'; vs: number },
  view: { assist: boolean; band: Band; altitude: number },
): MarkerBand {
  if (!view.assist && view.altitude >= VS_STRICT_HEIGHT) return view.band === 'slow' ? 'good' : view.band;
  return predicted.outcome === 'soft' ? 'good' : predicted.vs < VS_YELLOW ? 'warn' : 'bad';
}

/** Full scale of the speed bar (m/s): twice the yellow limit, so red is always the right half. */
export function vsBarMax(height: number, mode?: VsMode): number {
  return Math.max(VS_BAR_MAX, 2 * vsLimits(height, mode).yellow);
}

/**
 * Speed bar zones (share of the bar width). The bar is a zone gauge: each band has a fixed width,
 * so the green part stays wide enough to aim at even when the manual yellow reaches 25 m/s. The
 * slow zone (striped, when there is one) ends at VS_BAR_SLOW, green at VS_BAR_GREEN, yellow at
 * the middle; red fills the right half.
 */
export const VS_BAR_SLOW = 0.16;
export const VS_BAR_GREEN = 0.34;
export const VS_BAR_YELLOW = 0.5;

export interface VsBarZones {
  /** End of the slow zone (0 when there is none). */
  slow: number;
  green: number;
  yellow: number;
}

export function vsBarZones(lim: VsLimits): VsBarZones {
  return { slow: lim.slow > 0 ? VS_BAR_SLOW : 0, green: VS_BAR_GREEN, yellow: VS_BAR_YELLOW };
}

/**
 * Where a speed down sits on the bar (0..1): straight lines between the zone edges, so the
 * middle of the green band in m/s is the middle of the green part on screen.
 */
export function vsBarPos(down: number, lim: VsLimits, barMax: number): number {
  const d = Number.isFinite(down) ? Math.max(0, down) : 0;
  const z = vsBarZones(lim);
  const speeds: number[] = [0];
  const marks: number[] = [0];
  if (lim.slow > 0) {
    speeds.push(lim.slow);
    marks.push(z.slow);
  }
  speeds.push(lim.green, lim.yellow, Math.max(barMax, lim.yellow + 1e-6));
  marks.push(z.green, z.yellow, 1);
  for (let i = 1; i < speeds.length; i++) {
    const v0 = speeds[i - 1] as number;
    const v1 = speeds[i] as number;
    if (d > v1) continue;
    const p0 = marks[i - 1] as number;
    const p1 = marks[i] as number;
    return p0 + ((p1 - p0) * (d - v0)) / Math.max(1e-9, v1 - v0);
  }
  return 1;
}

/** Seconds the speed mark sits in the slow zone (manual flight) before the gentle cue shows. */
export const SLOW_CUE_AFTER = 4;
/** Seconds after a cue before the next one may show. */
export const SLOW_CUE_GAP = 20;
export const SLOW_CUE_TEXT = 'A bit faster saves fuel';

export interface SlowCueInput {
  /** The band the HUD shows now (speedBand). */
  band: Band;
  /** The child flies the engine (not Help), the flight runs, there is fuel. */
  manual: boolean;
  /** The call-out slot is free (no low-fuel prompt or key hint on screen). */
  free: boolean;
}

/**
 * The gentle "A bit faster saves fuel" cue (F6): once the mark has sat in the slow zone for 4 s
 * of manual flight, at most once per stay in the slow zone and once every 20 s. Never while Help
 * flies, never over another call-out. It is a tip, not a warning.
 */
export class SlowCue {
  private inSlow = 0;
  private gap = 0;
  private shownThisStay = false;

  /** One frame. True on the frame the cue should show. */
  update(dt: number, o: SlowCueInput): boolean {
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.gap = Math.max(0, this.gap - step);
    if (!o.manual || o.band !== 'slow') {
      this.inSlow = 0;
      this.shownThisStay = false;
      return false;
    }
    this.inSlow += step;
    if (this.shownThisStay || this.inSlow < SLOW_CUE_AFTER || this.gap > 0 || !o.free) return false;
    this.shownThisStay = true;
    this.gap = SLOW_CUE_GAP;
    return true;
  }

  reset(): void {
    this.inSlow = 0;
    this.gap = 0;
    this.shownThisStay = false;
  }
}

/** The first fuel call-out (60 s): the plain tick on the fuel bar. */
export const FUEL_TICK_SECONDS = CALLOUTS[0] ?? 60;

/** Position of a fuel mark on the bar (percent of the full tank, 0..100). */
export function fuelMarkPercent(seconds: number, fullSeconds: number): number {
  const full = Math.max(1, Number.isFinite(fullSeconds) ? fullSeconds : 1);
  return Math.min(1, Math.max(0, seconds) / full) * 100;
}

function must<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`hud: missing ${selector}`);
  return el;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly alt: HTMLElement;
  private readonly vsValue: HTMLElement;
  private readonly vsIcon: HTMLElement;
  private readonly vsMark: HTMLElement;
  private readonly vsBar: HTMLElement;
  private readonly vsGauge: HTMLElement;
  private readonly driftValue: HTMLElement;
  private readonly driftArrow: SVGGElement;
  private readonly driftDot: SVGCircleElement;
  private readonly driftGauge: HTMLElement;
  private readonly fuelValue: HTMLElement;
  private readonly fuelFill: HTMLElement;
  private readonly fuelMark: HTMLElement;
  private readonly fuelStar: HTMLElement;
  private readonly fuelGauge: HTMLElement;
  private readonly tiltDot: SVGCircleElement;
  private readonly tiltCmd: SVGCircleElement;
  private readonly tiltGauge: HTMLElement;
  private readonly thrFill: HTMLElement;
  private readonly thrHover: HTMLElement;
  private readonly thrValue: HTMLElement;
  private readonly last = new Map<string, string>();

  constructor(root: HTMLElement) {
    this.root = root;
    this.alt = must<HTMLElement>(root, '#alt-value');
    this.vsValue = must<HTMLElement>(root, '#vs-value');
    this.vsIcon = must<HTMLElement>(root, '#vs-icon');
    this.vsMark = must<HTMLElement>(root, '#vs-mark');
    this.vsBar = must<HTMLElement>(root, '.mt-vs-bar');
    this.vsGauge = must<HTMLElement>(root, '.mt-vs');
    this.driftValue = must<HTMLElement>(root, '#drift-value');
    this.driftArrow = must<SVGGElement>(root, '#drift-arrow');
    this.driftDot = must<SVGCircleElement>(root, '#drift-dot');
    this.driftGauge = must<HTMLElement>(root, '.mt-drift');
    this.fuelValue = must<HTMLElement>(root, '#fuel-value');
    this.fuelFill = must<HTMLElement>(root, '#fuel-fill');
    this.fuelMark = must<HTMLElement>(root, '#fuel-mark');
    this.fuelStar = must<HTMLElement>(root, '#fuel-star');
    this.fuelGauge = must<HTMLElement>(root, '.mt-fuel');
    this.tiltDot = must<SVGCircleElement>(root, '#tilt-dot');
    this.tiltCmd = must<SVGCircleElement>(root, '#tilt-cmd');
    this.tiltGauge = must<HTMLElement>(root, '.mt-tilt');
    this.thrFill = must<HTMLElement>(root, '#thr-fill');
    this.thrHover = must<HTMLElement>(root, '#thr-hover');
    this.thrValue = must<HTMLElement>(root, '#thr-value');
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-icon]'))) {
      el.innerHTML = moonIcon((el.dataset['icon'] ?? 'lander') as MoonIcon);
    }
    // A filled star marks the fuel-star line (30 s) on the bar.
    this.fuelStar.innerHTML = moonIcon('star', 'g499-icon-svg', true);
  }

  setVisible(on: boolean): void {
    this.root.hidden = !on;
  }

  /** Set a text, attribute or style only when it changed. */
  private put(key: string, value: string, apply: (v: string) => void): void {
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    apply(value);
  }

  update(v: HudView): void {
    const alt = Math.max(0, v.altitude);
    this.put('alt', alt >= 100 ? String(Math.round(alt)) : alt.toFixed(1), (s) => (this.alt.textContent = s));

    const down = Math.max(0, -v.vy);
    const climbing = v.vy > 0.05;
    this.put('vs', Math.abs(v.vy).toFixed(1), (s) => (this.vsValue.textContent = s));
    this.put('vs-icon', climbing ? 'up' : 'down', (s) => (this.vsIcon.innerHTML = moonIcon(s === 'up' ? 'up' : 'down')));
    const mode: VsMode = { assist: v.assist, hoverThrottle: v.hoverThrottle };
    this.put('vs-band', speedBand(v.vy, alt, mode), (s) => (this.vsGauge.dataset['band'] = s));
    this.put('assist', v.assist ? 'on' : 'off', (s) => (this.root.dataset['assist'] = s));
    this.put('fuel-calm', v.assist || v.fuelCalm === true ? 'on' : 'off', (s) => (this.root.dataset['fuelCalm'] = s));
    // Zone gauge: the striped slow zone (manual flight up high), then green, yellow and red.
    const lim = vsLimits(alt, mode);
    const zones = vsBarZones(lim);
    this.put('vs-zones', `${zones.slow}|${zones.green}`, () => {
      this.vsBar.style.setProperty('--mt-vs-slow', `${(zones.slow * 100).toFixed(1)}%`);
      this.vsBar.style.setProperty('--mt-vs-green', `${(zones.green * 100).toFixed(1)}%`);
    });
    const vsPos = vsBarPos(climbing ? 0 : down, lim, vsBarMax(alt, mode));
    this.put('vs-mark', (vsPos * 100).toFixed(1), (s) => (this.vsMark.style.left = `${s}%`));

    const hs = Math.hypot(v.vx, v.vz);
    this.put('hs', hs.toFixed(1), (s) => (this.driftValue.textContent = s));
    this.put('hs-band', hs < 1.2 ? 'good' : hs < 3 ? 'warn' : 'bad', (s) => (this.driftGauge.dataset['band'] = s));
    // Screen axes: right = +x, down = +z (the camera looks north).
    const still = hs < 0.15;
    const angle = (Math.atan2(v.vz, v.vx) * 180) / Math.PI;
    const scale = 0.55 + 0.45 * Math.min(1, hs / 5);
    this.put('hs-arrow', still ? 'none' : `${angle.toFixed(0)}|${scale.toFixed(2)}`, (s) => {
      this.driftArrow.style.display = s === 'none' ? 'none' : '';
      this.driftDot.style.display = s === 'none' ? '' : 'none';
      if (s !== 'none') this.driftArrow.setAttribute('transform', `rotate(${angle.toFixed(0)}) scale(${scale.toFixed(2)})`);
    });

    const fs = Math.max(0, v.fuelSeconds);
    const full = Math.max(1, v.fullFuelSeconds);
    // Rounded down, the same as the debrief and the star (>= 30 s): "30" always means the star holds.
    this.put('fuel', String(Math.floor(fs)), (s) => (this.fuelValue.textContent = s));
    this.put('fuel-fill', fuelMarkPercent(fs, full).toFixed(1), (s) => (this.fuelFill.style.width = `${s}%`));
    this.put('fuel-mark', fuelMarkPercent(FUEL_TICK_SECONDS, full).toFixed(1), (s) => (this.fuelMark.style.left = `${s}%`));
    this.put('fuel-star', fuelMarkPercent(STAR_FUEL_SECONDS, full).toFixed(1), (s) => (this.fuelStar.style.left = `${s}%`));
    // Below the star line the band is red and the star tick fades: the fuel star is gone.
    this.put(
      'fuel-band',
      fs > FUEL_TICK_SECONDS ? 'good' : fs >= STAR_FUEL_SECONDS ? 'warn' : 'bad',
      (s) => (this.fuelGauge.dataset['band'] = s),
    );

    const tx = (v.tiltX / MAX_TILT) * 13;
    const tz = (v.tiltZ / MAX_TILT) * 13;
    this.put('tilt', `${tx.toFixed(1)},${tz.toFixed(1)}`, () => {
      this.tiltDot.setAttribute('cx', tx.toFixed(1));
      this.tiltDot.setAttribute('cy', tz.toFixed(1));
    });
    const cx = (v.cmdTiltX / MAX_TILT) * 13;
    const cz = (v.cmdTiltZ / MAX_TILT) * 13;
    const cmdOn = Math.hypot(cx, cz) > 0.5;
    this.put('tilt-cmd', cmdOn ? `${cx.toFixed(1)},${cz.toFixed(1)}` : 'none', (s) => {
      this.tiltCmd.classList.toggle('is-on', s !== 'none');
      if (s === 'none') return;
      this.tiltCmd.setAttribute('cx', cx.toFixed(1));
      this.tiltCmd.setAttribute('cy', cz.toFixed(1));
    });
    const level = Math.hypot(v.tiltX, v.tiltZ) < (10 * Math.PI) / 180;
    this.put('tilt-band', level ? 'good' : 'warn', (s) => (this.tiltGauge.dataset['band'] = s));

    const thr = Math.max(0, Math.min(1, v.throttle));
    this.put('thr', String(Math.round(thr * 100)), (s) => (this.thrValue.textContent = s));
    this.put('thr-fill', (thr * 100).toFixed(1), (s) => (this.thrFill.style.width = `${s}%`));
    this.put('thr-hover', (Math.min(1, v.hoverThrottle) * 100).toFixed(1), (s) => (this.thrHover.style.left = `${s}%`));
  }
}
