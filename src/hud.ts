/**
 * Flight HUD: height above the ground, speed down with green / yellow / red bands, a sideways
 * drift arrow, fuel in seconds with the 60 s mark, and a tilt ball. Colours and shapes first,
 * few words. Writes to the DOM only when a shown value changes.
 *
 * The speed-down bands follow the height: fast is fine high up, slow near the ground. The safe
 * envelope is the hover helper's target speed, so correct helper flight always shows green.
 */
import { assistTargetVs } from './sim/assist';
import { MAX_TILT } from './sim/constants';
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
  /** Applied throttle (0..1) and the throttle that would hover now. */
  throttle: number;
  hoverThrottle: number;
  /** The hover helper flies the engine (the speed mark does not blink then). */
  assist: boolean;
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

export type Band = 'good' | 'warn' | 'bad';

export interface VsLimits {
  /** Below this speed down (m/s) the band is green. */
  green: number;
  /** Below this speed down (m/s) the band is yellow; red above. */
  yellow: number;
}

/** Safe speed down at a height (m/s): the helper's target, never below the touchdown limit. */
export function vsEnvelope(height: number): number {
  return Math.max(VS_GREEN, -assistTargetVs(height));
}

/** The green and yellow limits for speed down at a height above the ground. */
export function vsLimits(height: number): VsLimits {
  const h = Number.isFinite(height) ? height : 0;
  if (h < VS_STRICT_HEIGHT) return { green: VS_GREEN, yellow: VS_YELLOW };
  const safe = vsEnvelope(h);
  return { green: safe + VS_GREEN_SLACK, yellow: safe + VS_YELLOW_SLACK };
}

/** Colour band of a downward speed (m/s, >= 0) at a height (m). Height 0 = touchdown rules. */
export function vsBand(down: number, height = 0): Band {
  const lim = vsLimits(height);
  if (down < lim.green) return 'good';
  if (down < lim.yellow) return 'warn';
  return 'bad';
}

/** Full scale of the speed bar (m/s): twice the yellow limit, so red is always the right half. */
export function vsBarMax(height: number): number {
  return Math.max(VS_BAR_MAX, 2 * vsLimits(height).yellow);
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
  private readonly fuelGauge: HTMLElement;
  private readonly tiltDot: SVGCircleElement;
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
    this.fuelGauge = must<HTMLElement>(root, '.mt-fuel');
    this.tiltDot = must<SVGCircleElement>(root, '#tilt-dot');
    this.tiltGauge = must<HTMLElement>(root, '.mt-tilt');
    this.thrFill = must<HTMLElement>(root, '#thr-fill');
    this.thrHover = must<HTMLElement>(root, '#thr-hover');
    this.thrValue = must<HTMLElement>(root, '#thr-value');
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-icon]'))) {
      el.innerHTML = moonIcon((el.dataset['icon'] ?? 'lander') as MoonIcon);
    }
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
    this.put('vs-band', climbing ? 'good' : vsBand(down, alt), (s) => (this.vsGauge.dataset['band'] = s));
    this.put('assist', v.assist ? 'on' : 'off', (s) => (this.root.dataset['assist'] = s));
    // The green part of the bar reaches the safe speed for this height.
    const lim = vsLimits(alt);
    const barMax = vsBarMax(alt);
    this.put('vs-green', ((lim.green / barMax) * 100).toFixed(1), (s) => this.vsBar.style.setProperty('--mt-vs-green', `${s}%`));
    const vsPos = Math.min(1, down / barMax);
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
    this.put('fuel', String(Math.ceil(fs)), (s) => (this.fuelValue.textContent = s));
    this.put('fuel-fill', ((Math.min(1, fs / full) * 100).toFixed(1)), (s) => (this.fuelFill.style.width = `${s}%`));
    this.put('fuel-mark', ((Math.min(1, 60 / full) * 100).toFixed(1)), (s) => (this.fuelMark.style.left = `${s}%`));
    this.put('fuel-band', fs > 60 ? 'good' : fs > 30 ? 'warn' : 'bad', (s) => (this.fuelGauge.dataset['band'] = s));

    const tx = (v.tiltX / MAX_TILT) * 13;
    const tz = (v.tiltZ / MAX_TILT) * 13;
    this.put('tilt', `${tx.toFixed(1)},${tz.toFixed(1)}`, () => {
      this.tiltDot.setAttribute('cx', tx.toFixed(1));
      this.tiltDot.setAttribute('cy', tz.toFixed(1));
    });
    const level = Math.hypot(v.tiltX, v.tiltZ) < (10 * Math.PI) / 180;
    this.put('tilt-band', level ? 'good' : 'warn', (s) => (this.tiltGauge.dataset['band'] = s));

    const thr = Math.max(0, Math.min(1, v.throttle));
    this.put('thr', String(Math.round(thr * 100)), (s) => (this.thrValue.textContent = s));
    this.put('thr-fill', (thr * 100).toFixed(1), (s) => (this.thrFill.style.width = `${s}%`));
    this.put('thr-hover', (Math.min(1, v.hoverThrottle) * 100).toFixed(1), (s) => (this.thrHover.style.left = `${s}%`));
  }
}
