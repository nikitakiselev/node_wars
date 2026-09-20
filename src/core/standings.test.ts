import { describe, expect, test } from 'vitest';
import { NEUTRAL } from './state';
import { makeNode, makeState } from './fixtures';
import { standingsFor } from './standings';

describe('standingsFor', () => {
  test('counts the nodes and points a player holds', () => {
    const state = makeState(
      [
        makeNode(0, { owner: 0, points: 10 }),
        makeNode(1, { owner: 0, points: 5 }),
        makeNode(2, { owner: 1, points: 20 }),
      ],
      [],
    );

    expect(standingsFor(state, 0)).toMatchObject({ nodes: 2, points: 15 });
  });

  test('counts points still in flight as the sender’s', () => {
    const state = makeState([makeNode(0, { owner: 0, points: 10 })], []);
    state.squads.push({ id: 1, owner: 0, from: 0, to: 0, amount: 7, progress: 0.5, speed: 1 });

    expect(standingsFor(state, 0).points).toBe(17);
  });

  test('ignores nodes belonging to anyone else', () => {
    const state = makeState(
      [makeNode(0, { owner: NEUTRAL, points: 30 }), makeNode(1, { owner: 1, points: 8 })],
      [],
    );

    expect(standingsFor(state, 0)).toMatchObject({ nodes: 0, points: 0 });
  });

  test('reports the share of all points on the board', () => {
    const state = makeState(
      [makeNode(0, { owner: 0, points: 30 }), makeNode(1, { owner: 1, points: 10 })],
      [],
    );

    expect(standingsFor(state, 0).share).toBeCloseTo(0.75);
    expect(standingsFor(state, 1).share).toBeCloseTo(0.25);
  });

  test('an empty board gives a zero share rather than dividing by zero', () => {
    const state = makeState([makeNode(0, { owner: NEUTRAL, points: 0 })], []);

    expect(standingsFor(state, 0).share).toBe(0);
  });
});
