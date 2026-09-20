import { describe, expect, test } from 'vitest';
import { NEUTRAL, type GameNode, type Squad } from './state';
import { resolveArrival } from './combat';

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

function squad(overrides: Partial<Squad> = {}): Squad {
  return { id: 0, owner: 0, from: 1, to: 0, amount: 5, progress: 1, speed: 0.2, ...overrides };
}

describe('resolveArrival', () => {
  test('a squad arriving at a friendly node reinforces it', () => {
    const target = node({ owner: 0, points: 10 });

    resolveArrival(target, squad({ owner: 0, amount: 7 }));

    expect(target.owner).toBe(0);
    expect(target.points).toBe(17);
  });

  test('reinforcement may push a node above its capacity', () => {
    const target = node({ owner: 0, points: 48, capacity: 50 });

    resolveArrival(target, squad({ owner: 0, amount: 10 }));

    expect(target.points).toBe(58);
  });

  test('an attack weaker than the defence only reduces the defenders', () => {
    const target = node({ owner: 1, points: 20 });

    resolveArrival(target, squad({ owner: 0, amount: 8 }));

    expect(target.owner).toBe(1);
    expect(target.points).toBe(12);
  });

  test('an attack larger than the defence captures the node with the remainder', () => {
    const target = node({ owner: 1, points: 12 });

    resolveArrival(target, squad({ owner: 0, amount: 20 }));

    expect(target.owner).toBe(0);
    expect(target.points).toBe(8);
  });

  test('an attack exactly equal to the defence leaves the node with its owner at zero', () => {
    const target = node({ owner: 1, points: 15 });

    resolveArrival(target, squad({ owner: 0, amount: 15 }));

    expect(target.owner).toBe(1);
    expect(target.points).toBe(0);
  });

  test('a fortress absorbs half of an attack', () => {
    const target = node({ owner: 1, points: 20, kind: 'fortress' });

    resolveArrival(target, squad({ owner: 0, amount: 30 }));

    expect(target.owner).toBe(1);
    expect(target.points).toBe(5);
  });

  test('taking a fortress costs double, and the surplus is what is left of the halved force', () => {
    const target = node({ owner: 1, points: 10, kind: 'fortress' });

    resolveArrival(target, squad({ owner: 0, amount: 40 }));

    expect(target.owner).toBe(0);
    expect(target.points).toBe(10);
  });

  test('an attack that would take a plain node bounces off a fortress', () => {
    const plain = node({ owner: 1, points: 20, kind: 'base' });
    const fortress = node({ owner: 1, points: 20, kind: 'fortress' });

    resolveArrival(plain, squad({ owner: 0, amount: 25 }));
    resolveArrival(fortress, squad({ owner: 0, amount: 25 }));

    expect(plain.owner).toBe(0);
    expect(fortress.owner).toBe(1);
  });

  test('a fortress defends just as well once you hold it', () => {
    const mine = node({ owner: 0, points: 20, kind: 'fortress' });

    resolveArrival(mine, squad({ owner: 1, amount: 30 }));

    expect(mine.owner).toBe(0);
    expect(mine.points).toBe(5);
  });

  test('reinforcing your own fortress is not halved', () => {
    const mine = node({ owner: 0, points: 10, kind: 'fortress' });

    resolveArrival(mine, squad({ owner: 0, amount: 12 }));

    expect(mine.points).toBe(22);
  });

  test('a farm defends like any other node', () => {
    const farm = node({ owner: 1, points: 20, kind: 'farm' });

    resolveArrival(farm, squad({ owner: 0, amount: 8 }));

    expect(farm.points).toBe(12);
  });

  test('taking neutral ground keeps whatever level it had', () => {
    // Nobody built it up, so there is nothing for the storm to wreck, and
    // demoting it would only punish expanding early.
    const target = node({ owner: NEUTRAL, points: 10, level: 3, capacity: 90 });

    resolveArrival(target, squad({ owner: 0, amount: 20 }));

    expect(target.owner).toBe(0);
    expect(target.level).toBe(3);
    expect(target.capacity).toBe(90);
  });

  test('a node captured from a player loses a level: storming wrecks what was built', () => {
    const target = node({ owner: 1, points: 10, level: 3, capacity: 90 });

    resolveArrival(target, squad({ owner: 0, amount: 20 }));

    expect(target.owner).toBe(0);
    expect(target.level).toBe(2);
    expect(target.capacity).toBe(50);
  });

  test('a first-level node cannot be knocked any lower', () => {
    const target = node({ owner: 1, points: 5, level: 1, capacity: 25 });

    resolveArrival(target, squad({ owner: 0, amount: 20 }));

    expect(target.level).toBe(1);
  });

  test('demotion does not touch the garrison the attacker won', () => {
    const target = node({ owner: 1, points: 10, level: 3, capacity: 90 });

    resolveArrival(target, squad({ owner: 0, amount: 25 }));

    expect(target.points).toBe(15);
  });

  test('an attack that fails to take the node leaves its level alone', () => {
    const target = node({ owner: 1, points: 40, level: 3, capacity: 90 });

    resolveArrival(target, squad({ owner: 0, amount: 10 }));

    expect(target.level).toBe(3);
  });

  test('reinforcing your own node never demotes it', () => {
    const mine = node({ owner: 0, points: 10, level: 3, capacity: 90 });

    resolveArrival(mine, squad({ owner: 0, amount: 10 }));

    expect(mine.level).toBe(3);
  });

  test('a neutral node is captured the same way as an enemy node', () => {
    const target = node({ owner: NEUTRAL, points: 10 });

    resolveArrival(target, squad({ owner: 1, amount: 14 }));

    expect(target.owner).toBe(1);
    expect(target.points).toBe(4);
  });
});
