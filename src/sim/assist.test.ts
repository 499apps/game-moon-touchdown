import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LOW_FUEL_HELP_MARGIN, assistFuelNeed, lowFuelPrompt } from './assist';

describe('low-fuel prompt', () => {
  it('says "help" only while the helper can still land softly', () => {
    expect(lowFuelPrompt(60, 20)).toBeNull();
    expect(lowFuelPrompt(20 + LOW_FUEL_HELP_MARGIN, 20)).toBeNull();
    expect(lowFuelPrompt(20 + LOW_FUEL_HELP_MARGIN - 0.01, 20)).toBe('help');
    expect(lowFuelPrompt(20, 20)).toBe('help');
    expect(lowFuelPrompt(19.99, 20)).toBe('brake');
  });

  it('says "brake" when the fall is too fast to stop, and nothing on an empty tank', () => {
    expect(lowFuelPrompt(50, Infinity)).toBe('brake');
    expect(lowFuelPrompt(0, 20)).toBeNull();
    expect(lowFuelPrompt(-1, 20)).toBeNull();
    expect(lowFuelPrompt(30, Number.NaN)).toBeNull();
  });

  it('"help" always means the fuel covers the helper need (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 700, noNaN: true }),
        fc.double({ min: -25, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 6, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (h, vy, hs, fuel) => {
          const need = assistFuelNeed(h, vy, hs, 0.16);
          const p = lowFuelPrompt(fuel, need);
          if (p === 'help') return fuel >= need && fuel < need + LOW_FUEL_HELP_MARGIN;
          if (p === 'brake') return fuel > 0 && fuel < need;
          return fuel <= 0 || fuel >= need + LOW_FUEL_HELP_MARGIN;
        },
      ),
    );
  });
});
