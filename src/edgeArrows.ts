/**
 * Edge arrows: when the target ring or the predicted touchdown marker is out of the frame, an
 * arrow on the frame edge points to it (the ring arrow also shows the distance in metres). The
 * frame is the view inset by the HUD, the safe areas and the touch controls.
 *
 * `placeEdge` is pure (unit tested); `EdgeArrow` only writes the DOM when a value changes.
 */

/** Margins (px) of the usable frame inside the view. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface EdgePlacement {
  /** The point is inside the usable frame (no arrow needed). */
  onScreen: boolean;
  /** Arrow position in view pixels (y down). */
  x: number;
  y: number;
  /** Arrow direction (rad, screen space, 0 = right, + = clockwise because y is down). */
  angle: number;
}

/**
 * Place a projected point (NDC, y up) in a view of width x height pixels. When it is outside the
 * inset frame, or behind the camera, return the point on the frame edge toward it.
 */
export function placeEdge(
  ndcX: number,
  ndcY: number,
  behind: boolean,
  width: number,
  height: number,
  inset: Insets,
): EdgePlacement {
  const x0 = Math.min(inset.left, width / 2 - 1);
  const x1 = Math.max(width - inset.right, width / 2 + 1);
  const y0 = Math.min(inset.top, height / 2 - 1);
  const y1 = Math.max(height - inset.bottom, height / 2 + 1);
  const px = (ndcX * 0.5 + 0.5) * width;
  const py = (0.5 - ndcY * 0.5) * height;
  if (!behind && px >= x0 && px <= x1 && py >= y0 && py <= y1) {
    return { onScreen: true, x: px, y: py, angle: 0 };
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let dx = px - cx;
  let dy = py - cy;
  // Behind the camera the projection is mirrored: point the other way.
  if (behind) {
    dx = -dx;
    dy = -dy;
  }
  if (Math.hypot(dx, dy) < 1e-6) {
    dx = 0;
    dy = 1;
  }
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  const t = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { onScreen: false, x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx) };
}

/** One arrow element: `.mt-edge` with an inner `.mt-edge-arrow` and an optional label. */
export class EdgeArrow {
  private readonly el: HTMLElement;
  private readonly arrow: HTMLElement | null;
  private readonly label: HTMLElement | null;
  private readonly last = new Map<string, string>();

  constructor(el: HTMLElement) {
    this.el = el;
    this.arrow = el.querySelector<HTMLElement>('.mt-edge-arrow');
    this.label = el.querySelector<HTMLElement>('.mt-edge-dist');
  }

  get element(): HTMLElement {
    return this.el;
  }

  private put(key: string, value: string, apply: (v: string) => void): void {
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    apply(value);
  }

  hide(): void {
    this.put('shown', 'no', () => (this.el.hidden = true));
  }

  /** Show the arrow at (left, top) in page pixels, pointing along `angle`. */
  show(left: number, top: number, angle: number, label?: string): void {
    this.put('shown', 'yes', () => (this.el.hidden = false));
    this.put('pos', `${left.toFixed(0)},${top.toFixed(0)}`, () => {
      this.el.style.left = `${left.toFixed(0)}px`;
      this.el.style.top = `${top.toFixed(0)}px`;
    });
    const deg = ((angle * 180) / Math.PI).toFixed(0);
    this.put('angle', deg, (d) => {
      if (this.arrow) this.arrow.style.transform = `rotate(${d}deg)`;
    });
    if (label !== undefined && this.label) {
      const el = this.label;
      this.put('label', label, (s) => (el.textContent = s));
    }
  }

  /** Play the one-time attention pulse (CSS class `is-pulse`). */
  pulse(on: boolean): void {
    this.el.classList.toggle('is-pulse', on);
  }
}
