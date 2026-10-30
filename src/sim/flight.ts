/**
 * One run: lander + terrain + pilot input, stepped at a fixed 1/60 s. Detects footpad contact,
 * judges the touchdown, raises fuel call-outs and records a trace for the debrief chart.
 * Deterministic: the same start and the same input script give the same trace.
 */
import { CALLOUTS, DT, G_MOON } from './constants';
import { assistThrottle, assistTilt, createAssistMemory, type AssistMemory } from './assist';
import { distanceFromTarget, judgeTouchdown, scoreStars, type StarBreakdown, type Touchdown, type Verdict } from './judge';
import {
  cloneLander,
  createLander,
  footpadPositions,
  fuelSeconds,
  stepLander,
  tiltAngle,
  type Command,
  type LanderState,
  type Vec3,
} from './lander';
import type { Terrain } from './terrain';

/** Pilot input for one step, after device mapping. */
export interface PilotInput {
  /** Manual throttle 0..1 (0 = engine off). Ignored while the assist is on. */
  throttle: number;
  /** Manual tilt command (rad). */
  tiltX: number;
  tiltZ: number;
  /** True when the player is tilting now (the assist then leaves tilt to the player). */
  tiltActive: boolean;
  /** Hover assist on. */
  assist: boolean;
}

export const IDLE_INPUT: Readonly<PilotInput> = {
  throttle: 0,
  tiltX: 0,
  tiltZ: 0,
  tiltActive: false,
  assist: false,
};

export interface StartConditions {
  pos: Vec3;
  vel: Vec3;
  fuel: number;
}

export type FlightPhase = 'flying' | 'landed';

export type FlightEvent =
  | { type: 'callout'; seconds: number }
  | { type: 'fuel-out' }
  | { type: 'touchdown'; result: FlightResult };

export interface FlightResult {
  touchdown: Touchdown;
  verdict: Verdict;
  stars: StarBreakdown;
  distance: number;
  fuelUsed: number;
}

export interface TraceSample {
  t: number;
  height: number;
  /** Vertical speed (m/s, negative = down). */
  vy: number;
  hs: number;
  fuelSeconds: number;
  throttle: number;
}

/** Trace sample every N steps (10 per second). */
export const TRACE_EVERY = 6;

/** Height of the lowest footpad above the ground (m). */
export function heightAboveGround(s: LanderState, terrain: Terrain): number {
  let low = Infinity;
  for (const p of footpadPositions(s)) {
    const c = p.y - terrain.heightAt(p.x, p.z);
    if (c < low) low = c;
  }
  return low;
}

/** Turn pilot input into an engine and attitude command (the assist may take over). */
export function resolveCommand(
  s: LanderState,
  input: PilotInput,
  height: number,
  mem: AssistMemory,
  dt: number,
  g = G_MOON,
): Command {
  if (!input.assist) {
    return { throttle: input.throttle, tiltX: input.tiltX, tiltZ: input.tiltZ };
  }
  const throttle = assistThrottle(s, height, mem, dt, g);
  if (input.tiltActive) return { throttle, tiltX: input.tiltX, tiltZ: input.tiltZ };
  const t = assistTilt(s);
  return { throttle, tiltX: t.x, tiltZ: t.z };
}

export class Flight {
  readonly terrain: Terrain;
  readonly start: StartConditions;
  readonly g: number;
  state: LanderState;
  phase: FlightPhase = 'flying';
  result: FlightResult | null = null;
  readonly trace: TraceSample[] = [];
  tick = 0;
  /** The command applied in the last step (for the HUD and the scene). */
  lastCommand: Command = { throttle: 0, tiltX: 0, tiltZ: 0 };
  private readonly memory: AssistMemory = createAssistMemory();
  private wasAssist = false;
  private lastFuelSeconds: number;
  private fuelOutSent = false;
  private height: number;

  constructor(terrain: Terrain, start: StartConditions, g = G_MOON) {
    this.terrain = terrain;
    this.start = { pos: { ...start.pos }, vel: { ...start.vel }, fuel: start.fuel };
    this.g = g;
    this.state = createLander(start.pos, start.vel, start.fuel);
    this.lastFuelSeconds = fuelSeconds(this.state, g);
    this.height = heightAboveGround(this.state, terrain);
    this.record();
  }

  /** Height of the lowest footpad above the ground (m). */
  get altitude(): number {
    return this.height;
  }

  get fuelSeconds(): number {
    return fuelSeconds(this.state, this.g);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.state.vel.x, this.state.vel.z);
  }

  /** Copy of the assist memory, so the predictor can continue from the same controller state. */
  assistMemory(): AssistMemory {
    return { ...this.memory };
  }

  step(input: PilotInput, dt = DT): FlightEvent[] {
    if (this.phase !== 'flying') return [];
    const events: FlightEvent[] = [];
    // A fresh assist engagement starts from a clean integral.
    if (input.assist && !this.wasAssist) this.memory.integral = 0;
    this.wasAssist = input.assist;
    const cmd = resolveCommand(this.state, input, this.height, this.memory, dt, this.g);
    this.lastCommand = cmd;
    const prev = this.state;
    const next = stepLander(prev, cmd, dt, this.g);
    this.state = next;
    this.tick++;

    const fs = fuelSeconds(next, this.g);
    for (const mark of CALLOUTS) {
      if (this.lastFuelSeconds > mark && fs <= mark && next.fuel > 0) {
        events.push({ type: 'callout', seconds: mark });
      }
    }
    this.lastFuelSeconds = fs;
    if (next.fuel <= 0 && !this.fuelOutSent) {
      this.fuelOutSent = true;
      events.push({ type: 'fuel-out' });
    }

    const h = heightAboveGround(next, this.terrain);
    this.height = h;
    if (h <= 0) {
      events.push({ type: 'touchdown', result: this.touchDown(h) });
    } else if (this.tick % TRACE_EVERY === 0) {
      this.record();
    }
    return events;
  }

  private touchDown(clearance: number): FlightResult {
    const s = this.state;
    const td: Touchdown = {
      vs: Math.max(0, -s.vel.y),
      hs: Math.hypot(s.vel.x, s.vel.z),
      tilt: tiltAngle(s),
      slope: this.terrain.slopeAt(s.pos.x, s.pos.z),
      x: s.pos.x,
      z: s.pos.z,
      time: s.t,
      fuel: s.fuel,
      fuelSeconds: fuelSeconds(s, this.g),
    };
    const verdict = judgeTouchdown(td);
    const distance = distanceFromTarget(s.pos.x, s.pos.z);
    const result: FlightResult = {
      touchdown: td,
      verdict,
      stars: scoreStars(verdict, distance, td.fuelSeconds),
      distance,
      fuelUsed: this.start.fuel - s.fuel,
    };
    // Settle on the ground: the lowest pad touches, the engine stops.
    const settled = cloneLander(s);
    settled.pos.y -= clearance;
    settled.vel = { x: 0, y: 0, z: 0 };
    settled.throttle = 0;
    this.state = settled;
    this.height = 0;
    this.phase = 'landed';
    this.result = result;
    this.record(td.vs);
    return result;
  }

  private record(vsAtContact?: number): void {
    const s = this.state;
    this.trace.push({
      t: s.t,
      height: Math.max(0, this.height),
      vy: vsAtContact !== undefined ? -vsAtContact : s.vel.y,
      hs: Math.hypot(s.vel.x, s.vel.z),
      fuelSeconds: fuelSeconds(s, this.g),
      throttle: s.throttle,
    });
  }
}

/** One step of an input script: from this tick on, use this input. */
export interface ScriptStep {
  tick: number;
  input: PilotInput;
}

/** Run a whole input script (for replays and determinism tests). Stops at touchdown or maxTicks. */
export function runScript(flight: Flight, script: readonly ScriptStep[], maxTicks: number): FlightEvent[] {
  const events: FlightEvent[] = [];
  let k = 0;
  let input: PilotInput = IDLE_INPUT;
  while (flight.phase === 'flying' && flight.tick < maxTicks) {
    while (k < script.length && (script[k] as ScriptStep).tick <= flight.tick) {
      input = (script[k] as ScriptStep).input;
      k++;
    }
    events.push(...flight.step(input));
  }
  return events;
}
