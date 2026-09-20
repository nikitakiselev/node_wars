import { describe, expect, test } from 'vitest';
import { NEUTRAL, type GameNode, type Squad } from './state';
import { resolveArrival } from './combat';

function node(overrides: Partial<GameNode> = {}): GameNode {
  return { id: 0, x: 0, y: 0, radius: 20, capacity: 50, owner: 0, points: 10, ...overrides };
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

  test('a neutral node is captured the same way as an enemy node', () => {
    const target = node({ owner: NEUTRAL, points: 10 });

    resolveArrival(target, squad({ owner: 1, amount: 14 }));

    expect(target.owner).toBe(1);
    expect(target.points).toBe(4);
  });
});
