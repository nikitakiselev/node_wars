import { describe, expect, test } from 'vitest';
import { NEUTRAL, type GameNode } from './state';
import { GROWTH_PER_SECOND, applyGrowth } from './growth';
import { auraMultiplier } from './kinds';

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

describe('a core, which speeds up the network that holds it', () => {
  test('every node its owner holds earns faster', () => {
    const core = node({ id: 0, kind: 'core', owner: 1, points: 0 });
    const mine = node({ id: 1, owner: 1, points: 0 });

    applyGrowth([core, mine], 1);

    expect(mine.points).toBeCloseTo(GROWTH_PER_SECOND * auraMultiplier(core));
  });

  test('the core earns faster too: it is part of the network', () => {
    const core = node({ id: 0, kind: 'core', owner: 1, points: 0 });

    applyGrowth([core], 1);

    expect(core.points).toBeCloseTo(GROWTH_PER_SECOND * auraMultiplier(core));
  });

  test('it does nothing for anybody else', () => {
    const core = node({ id: 0, kind: 'core', owner: 1, points: 0 });
    const theirs = node({ id: 1, owner: 2, points: 0 });
    const unclaimed = node({ id: 2, owner: NEUTRAL, points: 0 });

    applyGrowth([core, theirs, unclaimed], 1);

    expect(theirs.points).toBeCloseTo(GROWTH_PER_SECOND);
    expect(unclaimed.points).toBe(0);
  });

  test('a core nobody holds speeds up nothing', () => {
    const core = node({ id: 0, kind: 'core', owner: NEUTRAL, points: 0 });
    const mine = node({ id: 1, owner: 1, points: 0 });

    applyGrowth([core, mine], 1);

    expect(mine.points).toBeCloseTo(GROWTH_PER_SECOND);
  });
});

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
