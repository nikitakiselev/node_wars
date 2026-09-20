import { describe, expect, test } from 'vitest';
import { createRng } from './rng';
import { poissonDiskSample } from './poisson';

const WIDTH = 800;
const HEIGHT = 600;
const MIN_DIST = 60;

function sample(seed = 1, minDist = MIN_DIST) {
  return poissonDiskSample(WIDTH, HEIGHT, minDist, createRng(seed));
}

describe('poissonDiskSample', () => {
  test('keeps every point inside the bounds', () => {
    for (const p of sample()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(WIDTH);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(HEIGHT);
    }
  });

  test('keeps every pair of points at least minDist apart', () => {
    const points = sample();

    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!;
        const b = points[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(MIN_DIST - 1e-9);
      }
    }
  });

  test('fills the area rather than returning a handful of points', () => {
    // A 800x600 area at 60 units spacing has room for far more than 30 points.
    expect(sample().length).toBeGreaterThan(30);
  });

  test('the same seed produces the same points', () => {
    expect(sample(7)).toEqual(sample(7));
  });

  test('different seeds produce different layouts', () => {
    expect(sample(1)).not.toEqual(sample(2));
  });

  test('a larger spacing yields fewer points', () => {
    expect(sample(3, 120).length).toBeLessThan(sample(3, 50).length);
  });
});
