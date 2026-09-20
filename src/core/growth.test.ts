import { describe, expect, test } from 'vitest';
import { NEUTRAL, type GameNode } from './state';
import { GROWTH_PER_SECOND, applyGrowth } from './growth';

function node(overrides: Partial<GameNode> = {}): GameNode {
  return {
    id: 0,
    x: 0,
    y: 0,
    radius: 20,
    capacity: 50,
    owner: 0,
    points: 10,
    ...overrides,
  };
}

describe('applyGrowth', () => {
  test('an owned node gains points at the growth rate', () => {
    const n = node({ points: 10 });

    applyGrowth([n], 1);

    expect(n.points).toBeCloseTo(10 + GROWTH_PER_SECOND);
  });

  test('growth is proportional to elapsed time', () => {
    const n = node({ points: 0 });

    applyGrowth([n], 0.5);

    expect(n.points).toBeCloseTo(GROWTH_PER_SECOND * 0.5);
  });

  test('a neutral node does not grow', () => {
    const n = node({ owner: NEUTRAL, points: 10 });

    applyGrowth([n], 5);

    expect(n.points).toBe(10);
  });

  test('growth stops at capacity', () => {
    const n = node({ points: 49, capacity: 50 });

    applyGrowth([n], 10);

    expect(n.points).toBe(50);
  });

  test('a node reinforced above capacity keeps its points but does not grow', () => {
    const n = node({ points: 80, capacity: 50 });

    applyGrowth([n], 1);

    expect(n.points).toBe(80);
  });
});
