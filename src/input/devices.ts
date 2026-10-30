/**
 * Input devices for the flight: held keys, gamepad sticks and the touch controls (left
 * throttle slider, right tilt pad). They only collect raw state; src/input/mapping.ts turns it
 * into an intent. Edge actions (Space, P, M, gamepad A) come through the kit InputManager.
 */
import { KeyTracker, type DeviceIntents } from './control';
import { mapGamepad, mapKeyboard, mapTouch, mergeIntents, type Intent, type TouchState } from './mapping';

export interface HeldKeysOptions {
  /** True while the flight owns the keyboard (no card or drawer open). */
  capture: () => boolean;
  /** The held set changed; `pressed` is the code of a new press (null for a release or a clear). */
  onChange?: (pressed: string | null) => void;
}

/**
 * Keys held down right now (only the flight keys), by KeyboardEvent.code so every layout works.
 * The rules live in KeyTracker (src/input/control.ts). Listeners sit on the window, so a key
 * still reaches the flight after a click moved the focus to a rail or game button. Held keys are
 * dropped on window blur and when the page hides (a missed keyup never sticks a key).
 */
export class HeldKeys {
  private readonly tracker = new KeyTracker();
  private readonly opts: HeldKeysOptions;
  /** Key presses seen (for the test API's input counter). */
  pressed = 0;

  private readonly onDown = (e: KeyboardEvent) => {
    const t = e.target instanceof HTMLElement ? e.target : null;
    const r = this.tracker.down(
      {
        code: e.code,
        repeat: e.repeat,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: t ? t.tagName : '',
        editable: t ? t.isContentEditable : false,
      },
      this.opts.capture(),
    );
    if (r.preventDefault) e.preventDefault();
    if (r.pressed) {
      this.pressed++;
      this.opts.onChange?.(e.code);
    }
  };
  private readonly onUp = (e: KeyboardEvent) => {
    if (this.tracker.up(e.code)) this.opts.onChange?.(null);
  };
  private readonly onBlur = () => this.clear();
  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') this.clear();
  };

  constructor(opts: HeldKeysOptions) {
    this.opts = opts;
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get held(): ReadonlySet<string> {
    return this.tracker.held;
  }

  clear(): void {
    if (this.tracker.clear()) this.opts.onChange?.(null);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}

/** First connected standard gamepad's sticks and triggers as an intent (empty when none). */
export function readGamepadIntent(): Intent | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  let pads: (Gamepad | null)[];
  try {
    pads = Array.from(navigator.getGamepads());
  } catch {
    return null;
  }
  for (const p of pads) {
    if (!p || !p.connected) continue;
    return mapGamepad({ axes: p.axes, buttons: p.buttons.map((b) => ({ pressed: b.pressed, value: b.value })) });
  }
  return null;
}

export interface TouchElements {
  slider: HTMLElement;
  sliderFill: HTMLElement;
  sliderKnob: HTMLElement;
  sliderHover: HTMLElement;
  pad: HTMLElement;
  padKnob: HTMLElement;
}

/** Pad radius (px) for full tilt. */
const PAD_REACH = 56;

/** Slider knob height (px), the same as the CSS. */
const KNOB = 40;

/**
 * Touch controls. Both are relative. The slider moves the lever by the drag distance from where
 * the finger landed (a tap changes nothing, so the lever never jumps). The pad: where the thumb
 * lands is the centre, and dragging away from it tilts the lander that way.
 */
export class TouchControls {
  readonly state: TouchState = { slider: null, padX: 0, padY: 0 };
  /** Touches that started on a control (for the test API's input counter). */
  touches = 0;
  private readonly el: TouchElements;
  private sliderId: number | null = null;
  private padId: number | null = null;
  private padOrigin = { x: 0, y: 0 };
  /** Lever on screen now, and the finger and lever at the start of a slider drag. */
  private shownLever = 0;
  private dragStart = { y: 0, lever: 0 };

  constructor(el: TouchElements) {
    this.el = el;
    const s = el.slider;
    s.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.sliderId = e.pointerId;
      this.touches++;
      try {
        s.setPointerCapture(e.pointerId);
      } catch {
        /* capture not supported */
      }
      this.dragStart = { y: e.clientY, lever: this.shownLever };
      this.moveSlider(e);
    });
    s.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.sliderId) this.moveSlider(e);
    });
    const endSlider = (e: PointerEvent) => {
      if (e.pointerId !== this.sliderId) return;
      this.sliderId = null;
      this.state.slider = null;
      s.classList.remove('is-active');
    };
    s.addEventListener('pointerup', endSlider);
    s.addEventListener('pointercancel', endSlider);

    const p = el.pad;
    p.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.padId = e.pointerId;
      this.touches++;
      this.padOrigin = { x: e.clientX, y: e.clientY };
      try {
        p.setPointerCapture(e.pointerId);
      } catch {
        /* capture not supported */
      }
      p.classList.add('is-active');
      this.movePad(e);
    });
    p.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.padId) this.movePad(e);
    });
    const endPad = (e: PointerEvent) => {
      if (e.pointerId !== this.padId) return;
      this.padId = null;
      this.state.padX = 0;
      this.state.padY = 0;
      p.classList.remove('is-active');
      el.padKnob.style.transform = '';
    };
    p.addEventListener('pointerup', endPad);
    p.addEventListener('pointercancel', endPad);
  }

  private moveSlider(e: PointerEvent): void {
    const r = this.el.slider.getBoundingClientRect();
    // Relative: the lever moves by the drag distance over the slider travel (up = more).
    const travel = Math.max(1, r.height - KNOB);
    const v = this.dragStart.lever + (this.dragStart.y - e.clientY) / travel;
    this.state.slider = Math.max(0, Math.min(1, v));
    this.el.slider.classList.add('is-active');
  }

  private movePad(e: PointerEvent): void {
    let x = (e.clientX - this.padOrigin.x) / PAD_REACH;
    let y = (e.clientY - this.padOrigin.y) / PAD_REACH;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    this.state.padX = x;
    this.state.padY = y;
    this.el.padKnob.style.transform = `translate(${(x * 44).toFixed(1)}px, ${(y * 44).toFixed(1)}px)`;
  }

  /** Show the lever position and the hover mark (both 0..1). */
  showLever(lever: number, hoverLever: number): void {
    this.shownLever = Math.max(0, Math.min(1, lever));
    const pct = (this.shownLever * 100).toFixed(1);
    this.el.sliderFill.style.height = `${pct}%`;
    this.el.sliderKnob.style.bottom = `calc(${pct}% - ${(lever * KNOB).toFixed(1)}px)`;
    this.el.sliderHover.style.bottom = `${(Math.max(0, Math.min(1, hoverLever)) * 100).toFixed(1)}%`;
    this.el.slider.setAttribute('aria-valuenow', String(Math.round(lever * 100)));
  }

  reset(): void {
    this.shownLever = 0;
    this.sliderId = null;
    this.padId = null;
    this.state.slider = null;
    this.state.padX = 0;
    this.state.padY = 0;
    this.el.padKnob.style.transform = '';
    this.el.slider.classList.remove('is-active');
    this.el.pad.classList.remove('is-active');
  }
}

/** Each device's intent for this frame, and all of them merged into one. */
export function collectDevices(keys: HeldKeys, touch: TouchControls | null): DeviceIntents & { intent: Intent } {
  const keyboard = mapKeyboard(keys.held);
  const pad = readGamepadIntent();
  const touchIntent = touch ? mapTouch(touch.state) : null;
  const list: Intent[] = [keyboard];
  if (pad) list.push(pad);
  if (touchIntent) list.push(touchIntent);
  return { keyboard, pad, touch: touchIntent, intent: mergeIntents(list) };
}
