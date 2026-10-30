/**
 * HUD input chip: a small, always-visible readout at the top left of the stage (the first item
 * of the HUD row, right of the rail) that shows who flies and the live input:
 * - the device: keyboard, touch or gamepad icon;
 * - the engine: "Help" (Help flies it) or "You", then W / S key caps (keyboard) or the slider glyph;
 * - the tilt: the four arrow key caps (keyboard) or the pad glyph. The player always steers.
 * Held keys light their caps on the frame of the key press. Lit caps are filled and sink (shape,
 * not only colour). Display only: the chip takes no input. Writes to the DOM only on a change.
 */
import type { ChipView, ControlSource, LitKeys } from './input/control';
import { moonIcon, type MoonIcon } from './icons';

const DEVICE_ICON: Readonly<Record<ControlSource, MoonIcon>> = {
  keyboard: 'keyboard',
  touch: 'controls',
  pad: 'gamepad',
};

/** Key caps in chip order: engine (W, S), then tilt (left, up = away, down = toward, right). */
const ENGINE_CAPS: readonly [keyof LitKeys, string][] = [
  ['up', 'W'],
  ['down', 'S'],
];
const TILT_CAPS: readonly [keyof LitKeys, string][] = [
  ['left', '←'],
  ['away', '↑'],
  ['toward', '↓'],
  ['right', '→'],
];

function span(className: string, html = ''): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  if (html) el.innerHTML = html;
  return el;
}

export class InputChip {
  readonly root: HTMLElement;
  private readonly device: HTMLElement;
  private readonly whoIcon: HTMLElement;
  private readonly whoText: HTMLElement;
  private readonly engineGlyph: HTMLElement;
  private readonly tiltGlyph: HTMLElement;
  private readonly sr: HTMLElement;
  private readonly caps = new Map<keyof LitKeys, HTMLElement>();
  private readonly last = new Map<string, string>();

  constructor(root: HTMLElement) {
    this.root = root;
    root.textContent = '';
    this.device = span('mt-input-device');
    this.device.setAttribute('aria-hidden', 'true');

    const engine = span('mt-input-part mt-input-engine');
    engine.setAttribute('aria-hidden', 'true');
    const who = span('mt-input-who');
    this.whoIcon = span('mt-input-who-icon');
    this.whoText = span('mt-input-who-text');
    who.append(this.whoIcon, this.whoText);
    engine.append(who);
    for (const [k, label] of ENGINE_CAPS) engine.append(this.cap(k, label));
    this.engineGlyph = span('mt-input-glyph', moonIcon('slider'));
    engine.append(this.engineGlyph);

    const tilt = span('mt-input-part mt-input-tilt');
    tilt.setAttribute('aria-hidden', 'true');
    tilt.append(span('mt-input-tag', moonIcon('tilt')));
    for (const [k, label] of TILT_CAPS) tilt.append(this.cap(k, label));
    this.tiltGlyph = span('mt-input-glyph', moonIcon('pad'));
    tilt.append(this.tiltGlyph);

    this.sr = span('g499-sr-only');
    root.append(this.device, engine, tilt, this.sr);
  }

  private cap(key: keyof LitKeys, label: string): HTMLElement {
    const el = document.createElement('kbd');
    el.className = 'mt-cap';
    el.dataset['cap'] = key;
    el.textContent = label;
    this.caps.set(key, el);
    return el;
  }

  private put(key: string, value: string, apply: (v: string) => void): void {
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    apply(value);
  }

  update(v: ChipView): void {
    this.put('device', v.device, (d) => {
      this.root.dataset['device'] = d;
      this.device.innerHTML = moonIcon(DEVICE_ICON[d as ControlSource]);
    });
    this.put('engine', v.engine, (e) => {
      this.root.dataset['engine'] = e;
      this.whoIcon.innerHTML = moonIcon(e === 'help' ? 'assist' : 'lander');
      this.whoText.textContent = e === 'help' ? 'Help' : 'You';
    });
    for (const [k, el] of this.caps) {
      this.put(`cap-${k}`, v.keys[k] ? '1' : '0', (on) => el.classList.toggle('is-on', on === '1'));
    }
    this.put('engine-live', v.engineLive ? '1' : '0', (on) => this.engineGlyph.classList.toggle('is-on', on === '1'));
    this.put('tilt-live', v.tiltLive ? '1' : '0', (on) => this.tiltGlyph.classList.toggle('is-on', on === '1'));
    this.put('text', v.text, (t) => (this.sr.textContent = t));
  }

  /** Lit key caps now, e.g. ['up', 'left'] (test API). */
  litCaps(): string[] {
    const out: string[] = [];
    for (const [k, el] of this.caps) if (el.classList.contains('is-on')) out.push(k);
    return out;
  }
}
