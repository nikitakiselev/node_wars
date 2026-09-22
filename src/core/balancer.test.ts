import { describe, expect, test } from 'vitest';
import { flushBalancers } from './balancer';
import { makeNode, makeState } from './fixtures';
import { applyGrowth } from './growth';
import { setWire } from './wires';
import type { GameState, ShareMode } from './state';

/** A balancer in the middle with two outputs of its own either side. */
function hub(share: ShareMode, points = 30): GameState {
  const state = makeState(
    [
      makeNode(0, { owner: 0, kind: 'balancer', level: 5, capacity: 240, points, share }),
      makeNode(1, { owner: 0, points: 0 }),
      makeNode(2, { owner: 0, points: 0 }),
    ],
    [
      [0, 1],
      [0, 2],
    ],
  );
  setWire(state, 0, 0, 1);
  setWire(state, 0, 0, 2);
  return state;
}

/** Where the squads currently in the air are headed, in the order they left. */
function outbound(state: GameState): number[] {
  return state.squads.map((squad) => squad.to);
}

describe('transit', () => {
  test('keeps nothing: what arrives leaves', () => {
    const state = hub('round');

    flushBalancers(state);

    expect(state.nodes[0]!.points).toBeLessThan(1);
    expect(state.squads).toHaveLength(1);
    expect(state.squads[0]!.amount).toBe(30);
  });

  test('a balancer with no outputs holds on to what it has', () => {
    const state = hub('round');
    state.wires[0] = [];

    flushBalancers(state);

    expect(state.nodes[0]!.points).toBe(30);
    expect(state.squads).toHaveLength(0);
  });

  test('nothing to share is not an order', () => {
    const state = hub('round', 0);

    flushBalancers(state);

    expect(state.squads).toHaveLength(0);
  });

  test('a balancer never earns, whatever else is growing', () => {
    const state = hub('round', 0);

    applyGrowth(state.nodes, 10);

    expect(state.nodes[0]!.points).toBe(0);
    expect(state.nodes[1]!.points).toBe(10);
  });

  test('only the owner ships: a neutral hub sits still', () => {
    const state = hub('round');
    state.nodes[0]!.owner = -1;

    flushBalancers(state);

    expect(state.squads).toHaveLength(0);
  });
});

describe('round robin', () => {
  test('each parcel goes to the next output in turn', () => {
    const state = hub('round');

    for (let parcel = 0; parcel < 3; parcel++) {
      state.nodes[0]!.points = 30;
      flushBalancers(state);
    }

    expect(outbound(state)).toEqual([1, 2, 1]);
  });

  test('it carries on round the shorter list when a wire is cut', () => {
    const state = hub('round');
    state.nodes[0]!.points = 30;
    flushBalancers(state);
    expect(outbound(state)).toEqual([1]);

    state.wires[0] = [2];
    state.nodes[0]!.points = 30;
    flushBalancers(state);

    expect(outbound(state)).toEqual([1, 2]);
  });
});

describe('balance', () => {
  test('the parcel goes to whichever output is emptiest against its ceiling', () => {
    const state = hub('balance');
    state.nodes[1]!.points = 40;
    state.nodes[2]!.points = 10;

    flushBalancers(state);

    expect(outbound(state)).toEqual([2]);
  });

  test('it reads fullness, not the raw number', () => {
    const state = hub('balance');
    // Node 1 holds less, but node 2 is the emptier of the two for its size.
    state.nodes[1]!.points = 20;
    state.nodes[1]!.capacity = 25;
    state.nodes[2]!.points = 25;
    state.nodes[2]!.capacity = 240;

    flushBalancers(state);

    expect(outbound(state)).toEqual([2]);
  });

  test('parcel after parcel, the outputs draw level', () => {
    const state = hub('balance', 0);
    state.nodes[1]!.points = 0;
    state.nodes[2]!.points = 60;

    // Each parcel lands where it was sent, so the next one sees the result.
    for (let parcel = 0; parcel < 4; parcel++) {
      state.nodes[0]!.points = 30;
      flushBalancers(state);
      for (const squad of state.squads) state.nodes[squad.to]!.points += squad.amount;
      state.squads = [];
    }

    expect(state.nodes[1]!.points).toBe(90);
    expect(state.nodes[2]!.points).toBe(90);
  });
});
