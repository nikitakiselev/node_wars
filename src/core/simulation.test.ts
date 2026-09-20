import { describe, expect, test } from 'vitest';
import { NEUTRAL } from './state';
import { makeNode, makeState } from './fixtures';
import { sendSquad } from './orders';
import { step } from './simulation';

describe('step', () => {
  test('advances simulated time', () => {
    const state = makeState([makeNode(0)], []);

    step(state, 0.25);
    step(state, 0.25);

    expect(state.time).toBeCloseTo(0.5);
  });

  test('grows owned nodes', () => {
    const state = makeState([makeNode(0, { owner: 0, points: 10 })], []);

    step(state, 2);

    expect(state.nodes[0]!.points).toBeCloseTo(12);
  });

  test('moves squads along their edge without arriving early', () => {
    const state = makeState(
      [makeNode(0, { owner: 0, points: 20 }), makeNode(1, { owner: 1, points: 50 })],
      [[0, 1]],
    );
    const squad = sendSquad(state, 0, 0, 1, 0.5)!;

    step(state, 0.1);

    expect(state.squads).toHaveLength(1);
    expect(squad.progress).toBeCloseTo(squad.speed * 0.1);
  });

  test('a squad that reaches its target resolves and disappears', () => {
    const state = makeState(
      [makeNode(0, { owner: 0, points: 20 }), makeNode(1, { owner: NEUTRAL, points: 4 })],
      [[0, 1]],
    );
    sendSquad(state, 0, 0, 1, 0.5);

    step(state, 1);

    expect(state.squads).toHaveLength(0);
    expect(state.nodes[1]!.owner).toBe(0);
    expect(state.nodes[1]!.points).toBe(6);
  });

  test('a defender keeps growing while the attack is in flight', () => {
    const state = makeState(
      [makeNode(0, { owner: 0, points: 20 }), makeNode(1, { owner: 1, points: 12 })],
      [[0, 1]],
    );
    sendSquad(state, 0, 0, 1, 0.5);

    step(state, 1);

    // 12 defenders, +1 grown during the second of flight, minus a 10-point hit.
    expect(state.nodes[1]!.owner).toBe(1);
    expect(state.nodes[1]!.points).toBeCloseTo(3);
  });

  test('squads in flight do not interact when they pass on the same edge', () => {
    const state = makeState(
      [makeNode(0, { owner: 0, points: 20 }), makeNode(1, { owner: 1, points: 20 })],
      [[0, 1]],
    );
    sendSquad(state, 0, 0, 1, 0.5);
    sendSquad(state, 1, 1, 0, 0.5);

    step(state, 0.2);

    expect(state.squads).toHaveLength(2);
  });

  test('declares a winner when one player holds every node', () => {
    const state = makeState(
      [makeNode(0, { owner: 0 }), makeNode(1, { owner: 0 })],
      [[0, 1]],
    );

    step(state, 0.1);

    expect(state.winner).toBe(0);
  });

  test('no winner while a neutral node remains', () => {
    const state = makeState(
      [makeNode(0, { owner: 0 }), makeNode(1, { owner: NEUTRAL })],
      [[0, 1]],
    );

    step(state, 0.1);

    expect(state.winner).toBeNull();
  });

  test('no winner while an enemy squad is still in flight', () => {
    const state = makeState(
      [makeNode(0, { owner: 1, points: 20 }), makeNode(1, { owner: 1, points: 20 })],
      [[0, 1]],
    );
    sendSquad(state, 1, 0, 1, 0.5);
    state.nodes[0]!.owner = 0;
    state.nodes[1]!.owner = 0;

    step(state, 0.1);

    expect(state.winner).toBeNull();
  });

  test('a finished match ignores further steps', () => {
    const state = makeState([makeNode(0, { owner: 0, points: 10 })], []);
    step(state, 0.1);
    expect(state.winner).toBe(0);

    step(state, 5);

    expect(state.nodes[0]!.points).toBeCloseTo(10.1);
  });
});
