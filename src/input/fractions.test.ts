import { describe, expect, test } from 'vitest';
import { SEND_MODES, fractionFor } from './fractions';

describe('fractionFor', () => {
  test('a plain drag commits the whole garrison', () => {
    expect(fractionFor({ shiftKey: false, altKey: false })).toBe(1);
  });

  test('shift holds half of it back', () => {
    expect(fractionFor({ shiftKey: true, altKey: false })).toBe(0.5);
  });

  test('alt sends only a probe', () => {
    expect(fractionFor({ shiftKey: false, altKey: true })).toBe(0.25);
  });

  test('shift wins when both modifiers are held', () => {
    expect(fractionFor({ shiftKey: true, altKey: true })).toBe(0.5);
  });

  test('the mode picked on the touch bar decides what a plain drag sends', () => {
    expect(fractionFor({ shiftKey: false, altKey: false }, 'half')).toBe(0.5);
    expect(fractionFor({ shiftKey: false, altKey: false }, 'probe')).toBe(0.25);
  });

  test('a modifier still wins over the mode, so the mouse plays as it did', () => {
    expect(fractionFor({ shiftKey: true, altKey: false }, 'probe')).toBe(0.5);
    expect(fractionFor({ shiftKey: false, altKey: true }, 'half')).toBe(0.25);
  });

  test('no mode named means everything, as a bare drag always has', () => {
    expect(fractionFor({ shiftKey: false, altKey: false })).toBe(
      fractionFor({ shiftKey: false, altKey: false }, 'all'),
    );
  });

  test('the wire mode carries no fraction: it lays a wire instead of shipping', () => {
    expect(SEND_MODES.wire.fraction).toBeNull();
  });

  test('every mode but the wire ships a real share of the garrison', () => {
    for (const [mode, { fraction }] of Object.entries(SEND_MODES)) {
      if (mode === 'wire') continue;
      expect(fraction).toBeGreaterThan(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });

  test('every fraction sends something and never more than the node holds', () => {
    for (const shiftKey of [false, true]) {
      for (const altKey of [false, true]) {
        const fraction = fractionFor({ shiftKey, altKey });
        expect(fraction).toBeGreaterThan(0);
        expect(fraction).toBeLessThanOrEqual(1);
      }
    }
  });
});
