import { describe, expect, test } from 'vitest';
import { createRng } from './rng';

describe('createRng', () => {
  test('same seed produces the same sequence', () => {
    const a = createRng(12345);
    const b = createRng(12345);

    const fromA = [a.next(), a.next(), a.next()];
    const fromB = [b.next(), b.next(), b.next()];

    expect(fromA).toEqual(fromB);
  });

  test('different seeds produce different sequences', () => {
    const a = createRng(1);
    const b = createRng(2);

    expect(a.next()).not.toEqual(b.next());
  });

  test('next returns values in [0, 1)', () => {
    const rng = createRng(999);

    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test('range returns an integer within the inclusive bounds', () => {
    const rng = createRng(7);
    const seen = new Set<number>();

    for (let i = 0; i < 500; i++) {
      const value = rng.range(3, 6);
      expect(Number.isInteger(value)).toBe(true);
      seen.add(value);
    }

    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  test('pick chooses an element of the given array', () => {
    const rng = createRng(42);
    const items = ['a', 'b', 'c'];

    expect(items).toContain(rng.pick(items));
  });
});
