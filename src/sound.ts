/**
 * Moon Touchdown sounds, all synthesised by the kit synth (no audio files): a soft engine hum
 * that follows the throttle, two-note fuel call-out chimes, a touchdown thump, a gentle "boing"
 * for a bumpy landing and a happy jingle for a soft one. The kit synth honours mute and stays
 * silent in test mode.
 */
import { noteToFreq, type Synth } from './kit/audio';

/** Seconds between engine hum pulses (overlapping pulses blend into a steady hum). */
const HUM_STEP = 0.09;
/** Seconds between soft noise hisses at full throttle (slower at low throttle). */
const HISS_STEP = 1.6;

export class MoonSounds {
  private readonly synth: Synth;
  private humClock = 0;
  private hissClock = 0;

  constructor(synth: Synth) {
    this.synth = synth;
  }

  /**
   * Call every frame with the applied throttle (0 = engine off). A low hum (52-78 Hz), a quieter
   * layer at three times the pitch (156-234 Hz) that phone speakers can play, and a soft hiss.
   */
  engine(throttle: number, dt: number): void {
    if (throttle <= 0) {
      this.humClock = 0;
      this.hissClock = 0;
      return;
    }
    const k = Math.min(1, throttle);
    this.hissClock -= dt;
    if (this.hissClock <= 0 && k >= 0.3) {
      this.hissClock = HISS_STEP / k;
      this.synth.whoosh();
    }
    this.humClock -= dt;
    if (this.humClock > 0) return;
    this.humClock = HUM_STEP;
    const freq = 52 + 26 * k;
    const volume = 0.025 + 0.05 * k;
    this.synth.tone({ freq, duration: 0.16, type: 'triangle', volume, attack: 0.04, release: 0.08 });
    this.synth.tone({ freq: freq * 3, duration: 0.16, type: 'triangle', volume: volume * 0.4, attack: 0.04, release: 0.08 });
  }

  start(): void {
    this.synth.tone({ freq: noteToFreq(67), duration: 0.09, type: 'triangle', volume: 0.14 });
    this.synth.tone({ freq: noteToFreq(74), duration: 0.12, type: 'triangle', volume: 0.14, delay: 0.09 });
  }

  assist(on: boolean): void {
    const [a, b] = on ? [72, 79] : [79, 72];
    this.synth.tone({ freq: noteToFreq(a), duration: 0.07, type: 'sine', volume: 0.12 });
    this.synth.tone({ freq: noteToFreq(b), duration: 0.1, type: 'sine', volume: 0.12, delay: 0.07 });
  }

  /** Fuel call-out: two clear chimes, lower for 30 s than for 60 s. */
  callout(seconds: number): void {
    const base = seconds <= 30 ? 76 : 81;
    for (let i = 0; i < 2; i++) {
      this.synth.tone({ freq: noteToFreq(base), duration: 0.12, type: 'sine', volume: 0.16, delay: i * 0.22 });
      this.synth.tone({ freq: noteToFreq(base + 12), duration: 0.1, type: 'sine', volume: 0.05, delay: i * 0.22 });
    }
  }

  fuelOut(): void {
    this.synth.tone({ freq: noteToFreq(64), slideTo: noteToFreq(57), duration: 0.4, type: 'sine', volume: 0.14 });
  }

  /** A soft thump of the footpads on the dust. */
  touchdown(): void {
    this.synth.tone({ freq: 120, slideTo: 58, duration: 0.22, type: 'sine', volume: 0.3 });
    this.synth.whoosh();
  }

  soft(): void {
    this.synth.success();
    this.synth.tone({ freq: noteToFreq(91), duration: 0.3, type: 'sine', volume: 0.07, delay: 0.32 });
  }

  /** The legs went boing: a springy up-down slide, friendly and never harsh. */
  bumpy(): void {
    this.synth.tone({ freq: 220, slideTo: 440, duration: 0.14, type: 'sine', volume: 0.14, delay: 0.12 });
    this.synth.tone({ freq: 440, slideTo: 260, duration: 0.2, type: 'sine', volume: 0.12, delay: 0.26 });
  }

  pause(): void {
    this.synth.tone({ freq: noteToFreq(69), slideTo: noteToFreq(64), duration: 0.12, type: 'sine', volume: 0.1 });
  }

  resume(): void {
    this.synth.tone({ freq: noteToFreq(64), slideTo: noteToFreq(69), duration: 0.12, type: 'sine', volume: 0.1 });
  }
}
