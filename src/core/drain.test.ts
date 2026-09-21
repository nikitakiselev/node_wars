import { describe, expect, test } from 'vitest';
import { applyDrain } from './drain';
import { makeNode, makeState } from './fixtures';
import { drainRate } from './kinds';
import { MAX_LEVEL } from './levels';
import { NEUTRAL, type GameState } from './state';

const ME = 1;
const THEM = 2;

/** A battery of mine, with whatever neighbours the test needs. */
function board(neighbours: { owner: number; points: number }[]): GameState {
  const battery = makeNode(0, { owner: ME, kind: 'battery', points: 20 });
  const around = neighbours.map((spec, index) =>
    makeNode(index + 1, { owner: spec.owner, points: spec.points }),
  );

  return makeState(
    [battery, ...around],
    around.map((node): [number, number] => [0, node.id]),
  );
}

describe('a battery', () => {
  test('takes points off a neighbouring enemy, without being told to', () => {
    const state = board([{ owner: THEM, points: 50 }]);

    applyDrain(state, 1);

    expect(state.nodes[1]!.points).toBeCloseTo(50 - drainRate(state.nodes[0]!));
  });

  test('picks the strongest enemy neighbour, not the nearest', () => {
    const state = board([
      { owner: THEM, points: 10 },
      { owner: THEM, points: 80 },
    ]);

    applyDrain(state, 1);

    expect(state.nodes[1]!.points).toBe(10);
    expect(state.nodes[2]!.points).toBeLessThan(80);
  });

  test('leaves unclaimed ground alone', () => {
    // Neutral ground is meant to cost points to take — that is a whole match
    // setting. A battery that erased it would undo the choice the player made.
    const state = board([{ owner: NEUTRAL, points: 30 }]);

    applyDrain(state, 1);

    expect(state.nodes[1]!.points).toBe(30);
  });

  test('never fires on its own side', () => {
    const state = board([{ owner: ME, points: 30 }]);

    applyDrain(state, 1);

    expect(state.nodes[1]!.points).toBe(30);
  });

  test('cannot take a node: it stops at nothing left', () => {
    const state = board([{ owner: THEM, points: 0.1 }]);

    applyDrain(state, 10);

    expect(state.nodes[1]!.points).toBe(0);
    expect(state.nodes[1]!.owner).toBe(THEM);
  });

  test('is proportional to time, like everything else on the clock', () => {
    const slow = board([{ owner: THEM, points: 50 }]);
    const fast = board([{ owner: THEM, points: 50 }]);

    applyDrain(slow, 0.5);
    applyDrain(fast, 0.5);
    applyDrain(fast, 0.5);

    expect(50 - fast.nodes[1]!.points).toBeCloseTo((50 - slow.nodes[1]!.points) * 2);
  });

  test('a battery nobody holds is just a node', () => {
    const state = board([{ owner: THEM, points: 50 }]);
    state.nodes[0]!.owner = NEUTRAL;

    applyDrain(state, 1);

    expect(state.nodes[1]!.points).toBe(50);
  });

  test('bites harder the further it is built up', () => {
    for (let level = 1; level < MAX_LEVEL; level++) {
      expect(drainRate({ kind: 'battery', level: level + 1 })).toBeGreaterThan(
        drainRate({ kind: 'battery', level }),
      );
    }
  });

  test('no other kind drains anything', () => {
    for (const kind of ['base', 'fortress', 'farm', 'core'] as const) {
      expect(drainRate({ kind, level: MAX_LEVEL }), kind).toBe(0);
    }
  });
});
