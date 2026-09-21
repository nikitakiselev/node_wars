import { describe, expect, test } from 'vitest';
import { applyDrain } from './drain';
import { makeNode, makeState } from './fixtures';
import { drainRate } from './kinds';
import { GROWTH_PER_SECOND } from './growth';
import { MAX_LEVEL } from './levels';
import { step } from './simulation';
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

  test('does not care whose the node is, only how big it is', () => {
    // Three different enemies around one battery. It fires on the largest
    // stack, whoever happens to own it.
    const state = board([
      { owner: 2, points: 30 },
      { owner: 3, points: 90 },
      { owner: 4, points: 60 },
    ]);

    applyDrain(state, 1);

    expect(state.nodes[1]!.points).toBe(30);
    expect(state.nodes[2]!.points).toBeLessThan(90);
    expect(state.nodes[3]!.points).toBe(60);
  });

  test('moves onto the next one as soon as it is no longer the biggest', () => {
    const state = board([
      { owner: 2, points: 60 },
      { owner: 3, points: 50 },
    ]);

    // Long enough to take the first target below the second.
    for (let tick = 0; tick < 30 * 20; tick++) step(state, 1 / 30);

    // Neither is left standing while the other is ground down: the battery
    // keeps whichever is currently largest shaved back.
    expect(state.nodes[1]!.points).toBeLessThan(60);
    expect(state.nodes[2]!.points).toBeLessThan(50);
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

  test('several of mine on one node all fire on it', () => {
    // Two batteries either side of the same node, and nothing else.
    const left = makeNode(0, { owner: ME, kind: 'battery' });
    const right = makeNode(1, { owner: ME, kind: 'battery' });
    const caught = makeNode(2, { owner: THEM, points: 50 });
    const state = makeState([left, right, caught], [
      [0, 2],
      [1, 2],
    ]);

    applyDrain(state, 1);

    expect(50 - caught.points).toBeCloseTo(drainRate(left) + drainRate(right));
  });

  test('each of mine picks its own target, so they spread along a front', () => {
    const one = makeNode(0, { owner: ME, kind: 'battery' });
    const two = makeNode(1, { owner: ME, kind: 'battery' });
    const near = makeNode(2, { owner: THEM, points: 50 });
    const far = makeNode(3, { owner: THEM, points: 50 });
    const state = makeState([one, two, near, far], [
      [0, 2],
      [1, 3],
    ]);

    applyDrain(state, 1);

    expect(near.points).toBeLessThan(50);
    expect(far.points).toBeLessThan(50);
  });

  test('a node ringed by batteries loses more than it can earn', () => {
    // Which is the point of taking several: four of them at full size take
    // points off faster than any node makes them, so the ground under them
    // cannot be held by standing on it.
    const ring = [0, 1, 2, 3].map((id) =>
      makeNode(id, { owner: ME, kind: 'battery', level: MAX_LEVEL }),
    );
    const caught = makeNode(4, { owner: THEM, points: 100 });
    const state = makeState(
      [...ring, caught],
      ring.map((node): [number, number] => [node.id, 4]),
    );

    applyDrain(state, 1);

    expect(100 - caught.points).toBeGreaterThan(GROWTH_PER_SECOND);
  });

  test('outpaces what a node earns, at every level', () => {
    // The trap this guards. A node earns a point a second up to its ceiling,
    // so a battery draining less than that does not take anything off it — it
    // only slows it down, and against a node already at its ceiling it does
    // nothing at all, because growth puts back every point it took. Measured
    // at 0.35 a second: a full node beside it sat at exactly full for ever.
    for (let level = 1; level <= MAX_LEVEL; level++) {
      expect(drainRate({ kind: 'battery', level }), `level ${level}`).toBeGreaterThan(
        GROWTH_PER_SECOND,
      );
    }
  });

  test('a node at its ceiling really does lose ground to the smallest one', () => {
    const state = makeState(
      [
        makeNode(0, { owner: ME, kind: 'battery', level: 1 }),
        makeNode(1, { owner: THEM, points: 90, capacity: 90 }),
      ],
      [[0, 1]],
    );

    for (let tick = 0; tick < 30 * 10; tick++) step(state, 1 / 30);

    expect(state.nodes[1]!.points).toBeLessThan(90);
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
