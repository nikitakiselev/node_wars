import { describe, expect, test } from 'vitest';
import { makeNode, makeState } from '../core/fixtures';
import { MAX_LEVEL, applyLevel, capacityForLevel } from '../core/levels';
import { createRng } from '../core/rng';
import { step } from '../core/simulation';
import type { GameState } from '../core/state';
import { createAi } from './ai';

const BOT = 1;
const STEP = 1 / 30;

/**
 * The shape that exposed the bug: one point of contact with the enemy and a
 * wide, deep territory of full nodes behind it.
 *
 * A chain of eight hid it — one order a decision is enough to keep eight nodes
 * moving. It takes an empire before the rear stops flowing.
 */
function empire(spineLength: number, leavesPerNode: number): GameState {
  const wall = makeNode(0, { owner: 0 });
  applyLevel(wall, MAX_LEVEL);
  // Far past its own ceiling, so it earns nothing back and cannot be taken in
  // one wave: the bot has to grind, and to keep its front supplied to do it.
  wall.points = 10_000;

  const nodes = [wall];
  const edges: [number, number][] = [];
  const full = (id: number, x: number, y: number) => {
    const node = makeNode(id, { owner: BOT, x, y });
    applyLevel(node, MAX_LEVEL);
    node.points = capacityForLevel(MAX_LEVEL);
    return node;
  };

  let next = 1;
  const spine: number[] = [];
  for (let along = 0; along < spineLength; along++) {
    const id = next++;
    nodes.push(full(id, 120 * (along + 1), 0));
    edges.push(spine.length === 0 ? [id, 0] : [id, spine[spine.length - 1]!]);
    spine.push(id);
  }

  for (const trunk of spine) {
    for (let leaf = 0; leaf < leavesPerNode; leaf++) {
      const id = next++;
      nodes.push(full(id, nodes[trunk]!.x, 120 * (leaf + 1)));
      edges.push([id, trunk]);
    }
  }

  return makeState(nodes, edges);
}

function play(state: GameState, seconds: number): void {
  const bot = createAi(BOT, 'normal', createRng(7));
  for (let tick = 0; tick < seconds / STEP; tick++) {
    step(state, STEP);
    bot.update(state, STEP);
  }
}

describe('a deep rear', () => {
  test('does not sit at capacity while there is fighting in front of it', () => {
    // The bug this guards: reserves were hauled by hand, one order a decision,
    // one node one hop. Half a thirty-six node empire stood full for a whole
    // minute while the front ground on without it.
    const state = empire(6, 5);
    const mine = () => state.nodes.filter((node) => node.owner === BOT);

    play(state, 60);

    const idle = mine().filter((node) => node.points >= node.capacity);
    expect(idle.length / mine().length).toBeLessThan(0.2);
  });

  test('is spent on the fighting rather than hoarded', () => {
    const state = empire(6, 5);

    play(state, 60);

    // Points taken off a stack that cannot heal are the whole measure of
    // whether the empire behind the front is doing anything at all.
    expect(10_000 - state.nodes[0]!.points).toBeGreaterThan(4000);
  });
});
