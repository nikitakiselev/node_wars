import { describe, expect, test } from 'vitest';
import { formatPoints } from './format';

describe('formatPoints', () => {
  test('small numbers are written out in full', () => {
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(7)).toBe('7');
    expect(formatPoints(999)).toBe('999');
  });

  test('fractions are dropped rather than rounded up', () => {
    expect(formatPoints(24.9)).toBe('24');
    expect(formatPoints(999.9)).toBe('999');
  });

  test('a thousand becomes 1K', () => {
    expect(formatPoints(1000)).toBe('1K');
  });

  test('a tenth of a thousand is worth showing', () => {
    expect(formatPoints(1200)).toBe('1.2K');
    expect(formatPoints(9900)).toBe('9.9K');
  });

  test('a trailing zero tenth is not', () => {
    expect(formatPoints(1050)).toBe('1K');
    expect(formatPoints(2000)).toBe('2K');
  });

  test('never rounds up into the next unit', () => {
    expect(formatPoints(999.99)).toBe('999');
    expect(formatPoints(9999)).toBe('9.9K');
    expect(formatPoints(999_999)).toBe('999K');
  });

  test('past ten thousand the tenth stops earning its place', () => {
    expect(formatPoints(10_000)).toBe('10K');
    expect(formatPoints(12_345)).toBe('12K');
  });

  test('millions get the same treatment', () => {
    expect(formatPoints(1_000_000)).toBe('1M');
    expect(formatPoints(2_500_000)).toBe('2.5M');
    expect(formatPoints(15_000_000)).toBe('15M');
  });

  test('a negative number keeps its sign', () => {
    expect(formatPoints(-1200)).toBe('-1.2K');
  });

  test('stays short enough to sit inside a node', () => {
    for (const value of [0, 999, 1000, 9900, 12_345, 999_999, 2_500_000]) {
      expect(formatPoints(value).length, String(value)).toBeLessThanOrEqual(5);
    }
  });
});
