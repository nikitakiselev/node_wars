import { describe, expect, test } from 'vitest';
import { NEUTRAL, type GameNode } from './state';
import { GROWTH_PER_SECOND, applyGrowth } from './growth';

function node(overrides: Partial<GameNode> = {}): GameNode {
  return {
    id: 0,
    x: 0,
    y: 0,
    level: 2,
    radius: 20,
    capacity: 50,
    kind: 'base',
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

  test('a farm out-earns a plain node of the same level', () => {
    const plain = node({ points: 0, kind: 'base', level: 1, capacity: 1000 });
    const farm = node({ points: 0, kind: 'farm', level: 1, capacity: 1000 });

    applyGrowth([plain, farm], 3);

    expect(farm.points).toBeGreaterThan(plain.points);
  });

  test('a farm earns more the further it is built up', () => {
    const young = node({ points: 0, kind: 'farm', level: 1, capacity: 1000 });
    const finished = node({ points: 0, kind: 'farm', level: 5, capacity: 1000 });

    applyGrowth([young, finished], 10);

    expect(finished.points).toBeGreaterThan(young.points);
  });

  test('a finished farm earns two and a half times a plain node', () => {
    const plain = node({ points: 0, kind: 'base', capacity: 1000 });
    const farm = node({ points: 0, kind: 'farm', level: 5, capacity: 1000 });

    applyGrowth([plain, farm], 4);

    expect(farm.points).toBeCloseTo(plain.points * 2.5);
  });

  test('a farm fills faster but holds no more', () => {
    const farm = node({ points: 0, capacity: 50, kind: 'farm' });

    applyGrowth([farm], 100);

    expect(farm.points).toBe(50);
  });

  test('a neutral farm does not grow either', () => {
    const farm = node({ owner: NEUTRAL, points: 10, kind: 'farm' });

    applyGrowth([farm], 5);

    expect(farm.points).toBe(10);
  });

  test('a fortress grows at the ordinary rate', () => {
    const fortress = node({ points: 0, kind: 'fortress' });

    applyGrowth([fortress], 4);

    expect(fortress.points).toBeCloseTo(GROWTH_PER_SECOND * 4);
  });

  test('a node reinforced above capacity keeps its points but does not grow', () => {
    const n = node({ points: 80, capacity: 50 });

    applyGrowth([n], 1);

    expect(n.points).toBe(80);
  });
});
