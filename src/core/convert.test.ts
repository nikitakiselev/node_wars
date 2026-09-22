import { describe, expect, test } from 'vitest';
import { BALANCER_COST, CONVERSIONS, conversionsFor, convertNode, revertNode } from './convert';
import { makeNode, makeState } from './fixtures';
import { setWire } from './wires';
import type { GameState } from './state';

/** A finished node with three neighbours of its own — a hub waiting to be one. */
function crossroads(overrides: Parameters<typeof makeNode>[1] = {}): GameState {
  return makeState(
    [
      makeNode(0, {
        owner: 0,
        level: 5,
        capacity: 240,
        radius: 30,
        points: 240,
        ...overrides,
      }),
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

describe('becoming a balancer', () => {
  test('a finished crossroads can be built into one, and pays for it', () => {
    const state = crossroads();

    expect(convertNode(state, 0, 0, 'balancer')).toBe(true);
    expect(state.nodes[0]!.kind).toBe('balancer');
    expect(state.nodes[0]!.points).toBe(240 - BALANCER_COST);
  });

  test('it starts sharing round the list until told otherwise', () => {
    const state = crossroads();

    convertNode(state, 0, 0, 'balancer');

    expect(state.nodes[0]!.share).toBe('round');
  });

  test('an unfinished node cannot: a hub is what you build at the top', () => {
    const state = crossroads({ level: 4, capacity: 150, radius: 27 });

    expect(convertNode(state, 0, 0, 'balancer')).toBe(false);
    expect(state.nodes[0]!.kind).toBe('base');
  });

  test('a node that is not a crossroads cannot', () => {
    const state = crossroads();
    // Two of the three neighbours change hands: what is left is not a hub.
    state.nodes[2]!.owner = 1;
    state.nodes[3]!.owner = 1;

    expect(convertNode(state, 0, 0, 'balancer')).toBe(false);
  });

  test('a node that already does something else cannot', () => {
    const state = crossroads({ kind: 'farm' });

    expect(convertNode(state, 0, 0, 'balancer')).toBe(false);
  });

  test('it is paid from the garrison, so a poor node waits', () => {
    const state = crossroads({ points: BALANCER_COST - 1 });

    expect(convertNode(state, 0, 0, 'balancer')).toBe(false);
    expect(state.nodes[0]!.kind).toBe('base');
  });

  test('somebody else cannot build on your node', () => {
    const state = crossroads();

    expect(convertNode(state, 1, 0, 'balancer')).toBe(false);
  });
});

describe('going back', () => {
  test('a balancer returns to a plain node for nothing', () => {
    const state = crossroads();
    convertNode(state, 0, 0, 'balancer');
    const left = state.nodes[0]!.points;

    expect(revertNode(state, 0, 0)).toBe(true);
    expect(state.nodes[0]!.kind).toBe('base');
    expect(state.nodes[0]!.points).toBe(left);
  });

  test('its wires come down with it, and its settings go', () => {
    const state = crossroads();
    convertNode(state, 0, 0, 'balancer');
    setWire(state, 0, 0, 1);
    setWire(state, 0, 0, 2);

    revertNode(state, 0, 0);

    expect(state.wires[0]).toEqual([]);
    expect(state.nodes[0]!.share).toBeUndefined();
    expect(state.nodes[0]!.cursor).toBeUndefined();
  });

  test('a fortress cannot be demoted: nobody built it', () => {
    const state = crossroads({ kind: 'fortress' });

    expect(revertNode(state, 0, 0)).toBe(false);
    expect(state.nodes[0]!.kind).toBe('fortress');
  });
});

describe('what the ring may offer', () => {
  test('a finished crossroads is offered the balancer', () => {
    expect(conversionsFor(crossroads(), 0)).toEqual(['balancer']);
  });

  test('a node that does not qualify is offered nothing', () => {
    expect(conversionsFor(crossroads({ level: 3 }), 0)).toEqual([]);
  });

  test('every buildable kind names itself, for the button that offers it', () => {
    for (const conversion of Object.values(CONVERSIONS)) {
      expect(conversion.label.length).toBeGreaterThan(0);
    }
  });
});
