import { describe, expect, test } from 'vitest';
import { SHARE_MODES, flushBalancers, shareModeOf } from './balancer';
import { makeNode, makeState } from './fixtures';
import { applyGrowth } from './growth';
import { setWire } from './wires';
import type { GameState, ShareMode } from './state';

/** A hub with three outputs of its own, each holding what it is told to. */
function hub(share: ShareMode, points: number, held: number[] = [0, 0, 0]): GameState {
  const state = makeState(
    [
      makeNode(0, { owner: 0, kind: 'balancer', level: 5, capacity: 240, points, share }),
      ...held.map((has, index) => makeNode(index + 1, { owner: 0, points: has })),
    ],
    held.map((_, index) => [0, index + 1] as [number, number]),
  );

  for (let index = 0; index < held.length; index++) setWire(state, 0, 0, index + 1);
  return state;
}

/** Where the parcel went, as output id to points. */
function sent(state: GameState): Record<number, number> {
  const out: Record<number, number> = {};
  for (const squad of state.squads) out[squad.to] = (out[squad.to] ?? 0) + squad.amount;
  return out;
}

/** Delivers everything in the air, so the next parcel sees the result. */
function land(state: GameState): void {
  for (const squad of state.squads) state.nodes[squad.to]!.points += squad.amount;
  state.squads = [];
}

describe('a hub keeps nothing and earns nothing', () => {
  test('it never earns, whatever else is growing', () => {
    const state = hub('round', 0);

    applyGrowth(state.nodes, 10);

    expect(state.nodes[0]!.points).toBe(0);
    expect(state.nodes[1]!.points).toBe(10);
  });

  test('with one output the whole parcel leaves', () => {
    const state = hub('round', 30, [0]);

    flushBalancers(state);

    expect(state.nodes[0]!.points).toBeLessThan(1);
    expect(sent(state)).toEqual({ 1: 30 });
  });

  test('a hub with no outputs holds on to what it has', () => {
    const state = hub('round', 30);
    state.wires[0] = [];

    flushBalancers(state);

    expect(state.nodes[0]!.points).toBe(30);
    expect(state.squads).toHaveLength(0);
  });

  test('nothing to share is not an order', () => {
    const state = hub('broadcast', 0);

    flushBalancers(state);

    expect(state.squads).toHaveLength(0);
  });

  test('only the owner ships: a neutral hub sits still', () => {
    const state = hub('round', 30);
    state.nodes[0]!.owner = -1;

    flushBalancers(state);

    expect(state.squads).toHaveLength(0);
  });

  test('a mode nobody recognises is read as the plain one', () => {
    const state = hub('round', 30);
    // A save written by another build, or by hand.
    state.nodes[0]!.share = 'nonsense' as ShareMode;

    expect(shareModeOf(state.nodes[0]!)).toBe('round');
    flushBalancers(state);
    expect(state.squads).toHaveLength(1);
  });
});

describe('Round Robin', () => {
  test('the whole parcel goes to one output, the next one each time', () => {
    const state = hub('round', 0);

    for (let parcel = 0; parcel < 4; parcel++) {
      state.nodes[0]!.points = 90;
      flushBalancers(state);
    }

    expect(state.squads.map((squad) => squad.to)).toEqual([1, 2, 3, 1]);
    expect(state.squads.every((squad) => squad.amount === 90)).toBe(true);
  });

  test('it carries on round the shorter list when a wire is cut', () => {
    const state = hub('round', 90);
    flushBalancers(state);
    state.squads = [];

    state.wires[0] = [3];
    state.nodes[0]!.points = 90;
    flushBalancers(state);

    expect(sent(state)).toEqual({ 3: 90 });
  });
});

describe('Broadcast', () => {
  test('the parcel is cut into equal shares, one to each output', () => {
    const state = hub('broadcast', 99);

    flushBalancers(state);

    expect(sent(state)).toEqual({ 1: 33, 2: 33, 3: 33 });
  });

  test('it pays no attention to what an output already holds', () => {
    const state = hub('broadcast', 90, [0, 200, 1000]);

    flushBalancers(state);

    expect(sent(state)).toEqual({ 1: 30, 2: 30, 3: 30 });
  });

  test('what will not divide stays on the hub rather than being invented', () => {
    const state = hub('broadcast', 100);

    flushBalancers(state);

    expect(sent(state)).toEqual({ 1: 33, 2: 33, 3: 33 });
    expect(state.nodes[0]!.points).toBe(1);
  });
});

describe('Adaptive', () => {
  test('the ones behind are brought level, and the rest is split evenly', () => {
    const state = hub('adaptive', 100, [10, 40, 40]);

    flushBalancers(state);
    land(state);

    expect(state.nodes[1]!.points).toBe(63);
    expect(state.nodes[2]!.points).toBe(63);
    expect(state.nodes[3]!.points).toBe(63);
  });

  test('a parcel too small to level them is shared out in proportion', () => {
    const state = hub('adaptive', 12, [10, 40, 40]);

    flushBalancers(state);

    expect(sent(state)).toEqual({ 1: 12 });
  });

  test('once they are level it shares evenly, which is what keeps them level', () => {
    const state = hub('adaptive', 99, [20, 20, 20]);

    flushBalancers(state);

    expect(sent(state)).toEqual({ 1: 33, 2: 33, 3: 33 });
  });

  test('parcel after parcel, outputs that started far apart stay together', () => {
    const state = hub('adaptive', 0, [0, 150, 600]);

    for (let parcel = 0; parcel < 6; parcel++) {
      state.nodes[0]!.points = 300;
      flushBalancers(state);
      land(state);
    }

    const held = [1, 2, 3].map((id) => state.nodes[id]!.points);
    expect(Math.max(...held) - Math.min(...held)).toBeLessThanOrEqual(3);
  });
});

describe('what a hub can never do', () => {
  test('no mode ever sends out more than came in', () => {
    for (const mode of Object.keys(SHARE_MODES) as ShareMode[]) {
      for (const parcel of [1, 7, 50, 99, 100, 241]) {
        const state = hub(mode, parcel, [3, 17, 200]);

        flushBalancers(state);

        const total = state.squads.reduce((sum, squad) => sum + squad.amount, 0);
        expect(total, `${mode} with ${parcel}`).toBeLessThanOrEqual(parcel);
        expect(state.nodes[0]!.points, `${mode} with ${parcel}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('every mode says what it does', () => {
    for (const mode of Object.values(SHARE_MODES)) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.hint.length).toBeGreaterThan(0);
    }
  });
});
