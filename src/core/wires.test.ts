import { describe, expect, test } from 'vitest';
import { makeNode, makeState } from './fixtures';
import { applyLevel } from './levels';
import { NEUTRAL, type GameState } from './state';
import { WIRE_KEEP_SHARE, clearWire, flushWires, setWire, wireFrom } from './wires';

/** Two adjacent nodes owned by player 0, plus a spare that is not adjacent. */
function board(): GameState {
  return makeState(
    [
      makeNode(0, { owner: 0, points: 10 }),
      makeNode(1, { owner: 0, points: 10 }),
      makeNode(2, { owner: 0, points: 10 }),
    ],
    [[0, 1]],
  );
}

function fill(state: GameState, id: number) {
  const node = state.nodes[id]!;
  node.points = node.capacity;
}

describe('laying a wire', () => {
  test('joins two of your own adjacent nodes', () => {
    const state = board();

    expect(setWire(state, 0, 0, 1)).toBe(true);
    expect(wireFrom(state, 0)).toBe(1);
  });

  test('a node has only one outgoing wire: a new one replaces it', () => {
    const state = makeState(
      [
        makeNode(0, { owner: 0 }),
        makeNode(1, { owner: 0 }),
        makeNode(2, { owner: 0 }),
      ],
      [
        [0, 1],
        [0, 2],
      ],
    );

    setWire(state, 0, 0, 1);
    setWire(state, 0, 0, 2);

    expect(wireFrom(state, 0)).toBe(2);
  });

  test('refuses a node that is not a neighbour', () => {
    const state = board();

    expect(setWire(state, 0, 0, 2)).toBe(false);
    expect(wireFrom(state, 0)).toBeNull();
  });

  test('refuses to wire a node to itself', () => {
    const state = board();

    expect(setWire(state, 0, 0, 0)).toBe(false);
  });

  test('refuses when either end is not yours', () => {
    const state = board();
    state.nodes[1]!.owner = 1;

    expect(setWire(state, 0, 0, 1)).toBe(false);

    state.nodes[1]!.owner = 0;
    state.nodes[0]!.owner = NEUTRAL;
    expect(setWire(state, 0, 0, 1)).toBe(false);
  });

  test('can be taken down again', () => {
    const state = board();
    setWire(state, 0, 0, 1);

    clearWire(state, 0, 0);

    expect(wireFrom(state, 0)).toBeNull();
  });

  test('only the owner can take one down', () => {
    const state = board();
    setWire(state, 0, 0, 1);

    clearWire(state, 1, 0);

    expect(wireFrom(state, 0)).toBe(1);
  });
});

describe('what a wire carries', () => {
  test('a node that has filled up sends everything above half its ceiling', () => {
    const state = board();
    setWire(state, 0, 0, 1);
    fill(state, 0);
    const capacity = state.nodes[0]!.capacity;

    flushWires(state);

    expect(state.squads).toHaveLength(1);
    expect(state.squads[0]!.from).toBe(0);
    expect(state.squads[0]!.to).toBe(1);
    expect(state.squads[0]!.amount).toBe(Math.floor(capacity * (1 - WIRE_KEEP_SHARE)));
    expect(state.nodes[0]!.points).toBe(capacity * WIRE_KEEP_SHARE);
  });

  test('a node handed more than it can hold forwards the surplus in one go', () => {
    // A node in the middle of a chain receives a shipment far over its cap.
    // Dribbling it out over several steps would look like a queue of scraps.
    const state = board();
    setWire(state, 0, 0, 1);
    const node = state.nodes[0]!;
    node.points = node.capacity * 4;

    flushWires(state);

    expect(state.squads).toHaveLength(1);
    expect(state.nodes[0]!.points).toBe(node.capacity * WIRE_KEEP_SHARE);
  });

  test('a node still filling up sends nothing', () => {
    const state = board();
    setWire(state, 0, 0, 1);
    state.nodes[0]!.points = state.nodes[0]!.capacity - 1;

    flushWires(state);

    expect(state.squads).toHaveLength(0);
  });

  test('a wired node never empties itself', () => {
    const state = board();
    setWire(state, 0, 0, 1);
    fill(state, 0);

    flushWires(state);

    expect(state.nodes[0]!.points).toBeGreaterThan(0);
  });

  test('it keeps pumping: fill, send, fill, send', () => {
    const state = board();
    setWire(state, 0, 0, 1);

    fill(state, 0);
    flushWires(state);
    fill(state, 0);
    flushWires(state);

    expect(state.squads).toHaveLength(2);
  });

  test('a bigger node sends a bigger load', () => {
    const state = board();
    setWire(state, 0, 0, 1);
    applyLevel(state.nodes[0]!, 5);
    fill(state, 0);
    flushWires(state);
    const big = state.squads[0]!.amount;

    const small = board();
    setWire(small, 0, 0, 1);
    applyLevel(small.nodes[0]!, 1);
    fill(small, 0);
    flushWires(small);

    expect(big).toBeGreaterThan(small.squads[0]!.amount);
  });
});

describe('wires that stop making sense', () => {
  test('a wire out of a node you lost is dropped', () => {
    const state = board();
    setWire(state, 0, 0, 1);
    state.nodes[0]!.owner = 1;

    flushWires(state);

    expect(wireFrom(state, 0)).toBeNull();
  });

  test('a wire into a node you lost is dropped', () => {
    const state = board();
    setWire(state, 0, 0, 1);
    state.nodes[1]!.owner = 1;
    fill(state, 0);

    flushWires(state);

    expect(wireFrom(state, 0)).toBeNull();
    expect(state.squads).toHaveLength(0);
  });
});
