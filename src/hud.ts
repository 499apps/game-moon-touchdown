/**
 * Flight HUD: height above the ground, speed down with green / yellow / red bands, a sideways
 * drift arrow, fuel in seconds with the 60 s mark, and a tilt ball. Colours and shapes first,
 * few words. Writes to the DOM only when a shown value changes.
 */
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
}

/** Speed-down scale of the bar (m/s) and its bands. */
export const VS_BAR_MAX = 8;
export const VS_GREEN = 2;
export const VS_YELLOW = 4;

export type Band = 'good' | 'warn' | 'bad';

/** Colour band of a downward speed (m/s, >= 0). */
export function vsBand(down: number): Band {
  if (down < VS_GREEN) return 'good';
  if (down < VS_YELLOW) return 'warn';
  return 'bad';
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
    this.put('vs-band', climbing ? 'good' : vsBand(down), (s) => (this.vsGauge.dataset['band'] = s));
    const vsPos = Math.min(1, down / VS_BAR_MAX);
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
