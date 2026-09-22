import { afterEach, describe, expect, test } from 'vitest';
import { CONVERSIONS, convertNode, costOf } from './convert';
import { setDevMode } from './dev';
import { makeNode, makeState } from './fixtures';
import { MAX_LEVEL, upgradeCost } from './levels';
import { upgradeNode } from './upgrade';
import type { GameState } from './state';

/** The switch is global, so no test may leave it on for the next one. */
afterEach(() => setDevMode(false));

function crossroads(points: number): GameState {
  return makeState(
    [
      makeNode(0, { owner: 0, level: 5, capacity: 240, radius: 30, points }),
      makeNode(1, { owner: 0 }),
      makeNode(2, { owner: 0 }),
      makeNode(3, { owner: 0 }),
    ],
    [
      [0, 1],
      [0, 2],
      [0, 3],
    ],
  );
}

describe('the developer switch', () => {
  test('is off to begin with, so a match plays by the real prices', () => {
    expect(upgradeCost(2)).toBeGreaterThan(0);
    expect(costOf('balancer')).toBe(CONVERSIONS['balancer']!.cost);
  });

  test('makes building up free, and leaves the ceiling where it was', () => {
    setDevMode(true);

    expect(upgradeCost(2)).toBe(0);
    expect(upgradeCost(MAX_LEVEL)).toBeNull();
  });

  test('a node with nothing in it can still be built up', () => {
    setDevMode(true);
    const state = makeState([makeNode(0, { owner: 0, level: 1, points: 0 })], []);

    expect(upgradeNode(state, 0, 0)).toBe(true);
    expect(state.nodes[0]!.level).toBe(2);
    expect(state.nodes[0]!.points).toBe(0);
  });

  test('makes building into a kind free as well', () => {
    setDevMode(true);
    const state = crossroads(0);

    expect(costOf('balancer')).toBe(0);
    expect(convertNode(state, 0, 0, 'balancer')).toBe(true);
    expect(state.nodes[0]!.points).toBe(0);
  });

  test('free is a price, not a way past the conditions', () => {
    setDevMode(true);
    // Three neighbours, but two of them are somebody else's.
    const state = crossroads(0);
    state.nodes[2]!.owner = 1;
    state.nodes[3]!.owner = 1;

    expect(convertNode(state, 0, 0, 'balancer')).toBe(false);
  });

  test('switched off again, the prices come back', () => {
    setDevMode(true);
    setDevMode(false);

    expect(upgradeCost(2)).toBeGreaterThan(0);
    expect(costOf('balancer')).toBe(CONVERSIONS['balancer']!.cost);
  });
});
