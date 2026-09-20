import { describe, expect, test } from 'vitest';
import { fractionFor } from './fractions';

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
