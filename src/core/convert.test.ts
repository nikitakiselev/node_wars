import { describe, expect, test } from 'vitest';
import {
  BALANCER_COST,
  CONVERSIONS,
  MIN_BALANCER_NEIGHBOURS,
  conversionsFor,
  convertNode,
  missingFor,
  revertNode,
} from './convert';
import { DEFAULT_SHARE } from './balancer';
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

  test('it starts on the levelling mode until told otherwise', () => {
    const state = crossroads();

    convertNode(state, 0, 0, 'balancer');

    expect(state.nodes[0]!.share).toBe(DEFAULT_SHARE);
    expect(DEFAULT_SHARE).toBe('adaptive');
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

  test('a hub keeps the one wire a plain node may have, and loses the rest', () => {
    const state = crossroads();
    convertNode(state, 0, 0, 'balancer');
    setWire(state, 0, 0, 1);
    setWire(state, 0, 0, 2);
    setWire(state, 0, 0, 3);

    revertNode(state, 0, 0);

    expect(state.wires[0]).toEqual([3]);
    expect(state.nodes[0]!.share).toBeUndefined();
    expect(state.nodes[0]!.cursor).toBeUndefined();
  });

  test('a fortress can be cleared too: it is ground you hold', () => {
    const state = crossroads({ kind: 'fortress' });

    expect(revertNode(state, 0, 0)).toBe(true);
    expect(state.nodes[0]!.kind).toBe('base');
  });

  test('a farm keeps its wire: nothing about it was outgrown', () => {
    const state = crossroads({ kind: 'farm' });
    setWire(state, 0, 0, 2);

    revertNode(state, 0, 0);

    expect(state.nodes[0]!.kind).toBe('base');
    expect(state.wires[0]).toEqual([2]);
  });

  test('a plain node has nothing to clear', () => {
    const state = crossroads();

    expect(revertNode(state, 0, 0)).toBe(false);
  });

  test('somebody else cannot clear your ground', () => {
    const state = crossroads({ kind: 'farm' });

    expect(revertNode(state, 1, 0)).toBe(false);
    expect(state.nodes[0]!.kind).toBe('farm');
  });
});

describe('what the ring may offer', () => {
  test('a finished crossroads is offered the balancer', () => {
    expect(conversionsFor(crossroads(), 0)).toEqual(['balancer']);
  });

  test('a node that does not qualify is offered nothing', () => {
    expect(conversionsFor(crossroads({ level: 3 }), 0)).toEqual([]);
  });

  test('every buildable kind names itself and says what pressing it does', () => {
    for (const conversion of Object.values(CONVERSIONS)) {
      expect(conversion.label.length).toBeGreaterThan(0);
      expect(conversion.needs.length).toBeGreaterThan(0);
      // The button's own words, not a label with a verb glued on the front.
      expect(conversion.action.toLowerCase()).toContain(conversion.label.toLowerCase());
    }
  });
});

describe('when a node is offered nothing', () => {
  test('a finished node that is no crossroads is told what it would need', () => {
    const state = crossroads();
    state.nodes[2]!.owner = 1;
    state.nodes[3]!.owner = 1;

    const missing = missingFor(state, 0);

    expect(missing).toContain('Балансировщик');
    expect(missing).toContain(String(MIN_BALANCER_NEIGHBOURS));
  });

  test('a node that is offered something is told nothing', () => {
    expect(missingFor(crossroads(), 0)).toBeNull();
  });

  test('an unfinished node is not being refused anything: it has building to do', () => {
    expect(missingFor(crossroads({ level: 3 }), 0)).toBeNull();
  });

  test('a node that already does something else is not nagged about a hub', () => {
    expect(missingFor(crossroads({ kind: 'farm' }), 0)).toBeNull();
  });
});
