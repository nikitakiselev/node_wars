import { describe, expect, test } from 'vitest';
import { makeNode, makeState } from './fixtures';
import { applyLevel } from './levels';
import { NEUTRAL, type GameState } from './state';
import {
  WIRE_SEND_FRACTION,
  clearWire,
  cutWire,
  flushWires,
  setWire,
  wiresFrom,
} from './wires';

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
    expect(wiresFrom(state, 0)).toEqual([1]);
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

    expect(wiresFrom(state, 0)).toEqual([2]);
  });

  test('refuses a node that is not a neighbour', () => {
    const state = board();

    expect(setWire(state, 0, 0, 2)).toBe(false);
    expect(wiresFrom(state, 0)).toEqual([]);
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

    expect(wiresFrom(state, 0)).toEqual([]);
  });

  test('only the owner can take one down', () => {
    const state = board();
    setWire(state, 0, 0, 1);

    clearWire(state, 1, 0);

    expect(wiresFrom(state, 0)).toEqual([1]);
  });
});

describe('what a wire carries', () => {
  test('a node that has filled up sends half of what it holds', () => {
    const state = board();
    setWire(state, 0, 0, 1);
    fill(state, 0);
    const before = state.nodes[0]!.points;

    flushWires(state);

    expect(state.squads).toHaveLength(1);
    expect(state.squads[0]!.from).toBe(0);
    expect(state.squads[0]!.to).toBe(1);
    expect(state.squads[0]!.amount).toBe(Math.floor(before * WIRE_SEND_FRACTION));
  });

  test('a node with a stockpile keeps half of it, not half of its ceiling', () => {
    // The whole point of holding back: a wired node has to be worth attacking
    // rather than a free capture the moment it forwards.
    const state = board();
    setWire(state, 0, 0, 1);
    const node = state.nodes[0]!;
    node.points = node.capacity * 4;
    const before = node.points;

    flushWires(state);

    expect(node.points).toBe(before / 2);
    expect(node.points).toBeGreaterThan(node.capacity);
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

    expect(wiresFrom(state, 0)).toEqual([]);
  });

  test('a wire into a node you lost is dropped', () => {
    const state = board();
    setWire(state, 0, 0, 1);
    state.nodes[1]!.owner = 1;
    fill(state, 0);

    flushWires(state);

    expect(wiresFrom(state, 0)).toEqual([]);
    expect(state.squads).toHaveLength(0);
  });

  test('a balancer keeps the wires that still stand when one end changes hands', () => {
    const state = fan();
    setWire(state, 0, 0, 1);
    setWire(state, 0, 0, 2);
    state.nodes[1]!.owner = 1;

    flushWires(state);

    expect(wiresFrom(state, 0)).toEqual([2]);
  });
});

/** A balancer with three neighbours of its own to point at. */
function fan(): GameState {
  return makeState(
    [
      makeNode(0, { owner: 0, kind: 'balancer', level: 5, capacity: 240, points: 0 }),
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

describe('a balancer holds as many wires as it has neighbours', () => {
  test('laying a second one adds rather than replaces', () => {
    const state = fan();

    setWire(state, 0, 0, 1);
    setWire(state, 0, 0, 2);
    setWire(state, 0, 0, 3);

    expect(wiresFrom(state, 0)).toEqual([1, 2, 3]);
  });

  test('pointing at the same neighbour twice changes nothing', () => {
    const state = fan();

    setWire(state, 0, 0, 1);
    setWire(state, 0, 0, 1);

    expect(wiresFrom(state, 0)).toEqual([1]);
  });

  test('one wire can be cut without touching the rest', () => {
    const state = fan();
    setWire(state, 0, 0, 1);
    setWire(state, 0, 0, 2);

    cutWire(state, 0, 0, 1);

    expect(wiresFrom(state, 0)).toEqual([2]);
  });

  test('only the owner can cut one', () => {
    const state = fan();
    setWire(state, 0, 0, 1);

    cutWire(state, 1, 0, 1);

    expect(wiresFrom(state, 0)).toEqual([1]);
  });

  test('flushWires never ships from a hub: that is the balancer rule\'s job', () => {
    const state = fan();
    setWire(state, 0, 0, 1);
    const node = state.nodes[0]!;
    node.points = node.capacity;

    flushWires(state);

    expect(state.squads).toHaveLength(0);
    expect(node.points).toBe(node.capacity);
  });
});
