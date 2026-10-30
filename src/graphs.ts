/**
 * Debrief chart on a 2D canvas: height and downward speed against time. Line styles differ
 * (solid / dashed) as well as colours. A soft green band shows the safe speed for the height at
 * each moment (the same envelope as the HUD), and a brighter band the touchdown limit (2 m/s).
 */
import { vsLimits } from './hud';
import { LIMITS } from './sim/constants';
import type { TraceSample } from './sim/flight';

const HEIGHT = '#63e6be';
const SPEED = '#ffe66d';
const SAFE = 'rgba(140, 233, 154, 0.16)';
const ENVELOPE = 'rgba(140, 233, 154, 0.1)';
const GRID = 'rgba(200, 210, 240, 0.16)';
const TEXT = 'rgba(255, 247, 230, 0.8)';

export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Draw the trace into the canvas at its CSS size (crisp on high-DPI screens). */
export function drawDescentChart(canvas: HTMLCanvasElement, trace: readonly TraceSample[]): void {
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || 150;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const n = trace.length;
  if (n < 2) return;
  const t0 = trace[0]?.t ?? 0;
  const t1 = trace[n - 1]?.t ?? 1;
  const pad = { l: 40, r: 44, t: 12, b: 20 };
  const w = cssW - pad.l - pad.r;
  const h = cssH - pad.t - pad.b;
  const xOf = (t: number) => pad.l + ((t - t0) / Math.max(1e-6, t1 - t0)) * w;
  const hMax = niceMax(Math.max(...trace.map((s) => s.height)));
  const vMax = niceMax(Math.max(LIMITS.vs * 2, ...trace.map((s) => Math.max(0, -s.vy))));
  const yH = (v: number) => pad.t + h - (v / hMax) * h;
  const yV = (v: number) => pad.t + h - (Math.max(0, Math.min(vMax, v)) / vMax) * h;

  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
  }
  // Safe speed for the height at each moment: fast is fine high up, slow near the ground.
  ctx.fillStyle = ENVELOPE;
  ctx.beginPath();
  ctx.moveTo(xOf(t0), yV(0));
  for (const s of trace) ctx.lineTo(xOf(s.t), yV(vsLimits(s.height).green));
  ctx.lineTo(xOf(t1), yV(0));
  ctx.closePath();
  ctx.fill();
  // Safe touchdown speeds.
  ctx.fillStyle = SAFE;
  ctx.fillRect(pad.l, yV(LIMITS.vs), w, yV(0) - yV(LIMITS.vs));

  ctx.textAlign = 'right';
  ctx.fillStyle = HEIGHT;
  ctx.fillText(`${hMax} m`, pad.l - 4, pad.t + 8);
  ctx.fillText('0', pad.l - 4, pad.t + h);
  ctx.textAlign = 'left';
  ctx.fillStyle = SPEED;
  ctx.fillText(`${vMax}`, pad.l + w + 4, pad.t + 8);
  ctx.fillText('m/s', pad.l + w + 4, pad.t + 20);
  ctx.fillStyle = TEXT;
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(t1 - t0)} s`, pad.l + w / 2, cssH - 4);

  const line = (yOf: (s: TraceSample) => number, color: string, dash: number[]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    trace.forEach((s, i) => {
      const x = xOf(s.t);
      const y = yOf(s);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line((s) => yH(s.height), HEIGHT, []);
  line((s) => yV(-s.vy), SPEED, [6, 4]);

  // Touchdown dot on the speed line.
  const last = trace[n - 1];
  if (last) {
    ctx.fillStyle = -last.vy < LIMITS.vs ? '#8ce99a' : '#ff8787';
    ctx.beginPath();
    ctx.arc(xOf(last.t), yV(-last.vy), 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
