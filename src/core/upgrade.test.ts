import { describe, expect, test } from 'vitest';
import { makeNode, makeState } from './fixtures';
import { MAX_LEVEL, applyLevel, capacityForLevel, upgradeCost } from './levels';
import { NEUTRAL } from './state';
import { upgradeNode } from './upgrade';

function board(level: number, points: number, owner = 0) {
  const node = makeNode(0, { owner, points });
  applyLevel(node, level);
  node.points = points;
  return makeState([node], []);
}

describe('upgradeNode', () => {
  test('raises the level and charges the node for it', () => {
    const state = board(1, 40);

    expect(upgradeNode(state, 0, 0)).toBe(true);
    expect(state.nodes[0]!.level).toBe(2);
    expect(state.nodes[0]!.points).toBe(40 - upgradeCost(1)!);
  });

  test('buys the room it charged for', () => {
    const state = board(1, 40);

    upgradeNode(state, 0, 0);

    expect(state.nodes[0]!.capacity).toBe(capacityForLevel(2));
  });

  test('a node can spend the reinforcements stacked above its cap', () => {
    const state = board(1, 100);

    expect(upgradeNode(state, 0, 0)).toBe(true);
    expect(state.nodes[0]!.points).toBe(100 - upgradeCost(1)!);
  });

  test('refuses when the node cannot pay', () => {
    const state = board(1, upgradeCost(1)! - 1);

    expect(upgradeNode(state, 0, 0)).toBe(false);
    expect(state.nodes[0]!.level).toBe(1);
  });

  test('paying the exact price is allowed, and leaves the node empty', () => {
    const state = board(1, upgradeCost(1)!);

    expect(upgradeNode(state, 0, 0)).toBe(true);
    expect(state.nodes[0]!.points).toBe(0);
  });

  test('refuses on a node someone else holds', () => {
    const state = board(1, 200, 1);

    expect(upgradeNode(state, 0, 0)).toBe(false);
    expect(state.nodes[0]!.level).toBe(1);
  });

  test('refuses on neutral ground', () => {
    const state = board(1, 200, NEUTRAL);

    expect(upgradeNode(state, NEUTRAL, 0)).toBe(false);
  });

  test('refuses at the top level, however rich the node is', () => {
    const state = board(MAX_LEVEL, 10_000);

    expect(upgradeNode(state, 0, 0)).toBe(false);
    expect(state.nodes[0]!.points).toBe(10_000);
  });

  test('refuses on a node that does not exist', () => {
    const state = board(1, 200);

    expect(upgradeNode(state, 0, 42)).toBe(false);
  });
});
