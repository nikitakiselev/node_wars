import { describe, expect, test } from 'vitest';
import { NEUTRAL } from './state';
import { makeNode, makeState } from './fixtures';
import { SQUAD_SPEED, sendSquad } from './orders';

function twoNodes(ownerOfFirst = 0, points = 20) {
  return makeState(
    [makeNode(0, { owner: ownerOfFirst, points }), makeNode(1, { owner: 1, points: 5 })],
    [[0, 1]],
  );
}

describe('sendSquad', () => {
  test('sends the requested fraction and deducts it from the source', () => {
    const state = twoNodes(0, 20);

    sendSquad(state, 0, 0, 1, 0.5);

    expect(state.nodes[0]!.points).toBe(10);
    expect(state.squads).toHaveLength(1);
    expect(state.squads[0]!.amount).toBe(10);
  });

  test('rounds the sent amount down so points are never created', () => {
    const state = twoNodes(0, 15);

    sendSquad(state, 0, 0, 1, 0.5);

    expect(state.squads[0]!.amount).toBe(7);
    expect(state.nodes[0]!.points).toBe(8);
  });

  test('the new squad starts at the source and is owned by the sender', () => {
    const state = twoNodes(0, 20);

    const squad = sendSquad(state, 0, 0, 1, 0.5);

    expect(squad).not.toBeNull();
    expect(squad!.from).toBe(0);
    expect(squad!.to).toBe(1);
    expect(squad!.owner).toBe(0);
    expect(squad!.progress).toBe(0);
  });

  test('squad speed crosses the edge at a constant world speed', () => {
    const state = twoNodes(0, 20);

    const squad = sendSquad(state, 0, 0, 1, 0.5)!;

    const edgeLength = state.edges[0]!.length;
    expect(squad.speed * edgeLength).toBeCloseTo(SQUAD_SPEED);
  });

  test('refuses to send from a node the actor does not own', () => {
    const state = twoNodes(1, 20);

    const squad = sendSquad(state, 0, 0, 1, 0.5);

    expect(squad).toBeNull();
    expect(state.squads).toHaveLength(0);
    expect(state.nodes[0]!.points).toBe(20);
  });

  test('refuses to send to a node that is not adjacent', () => {
    const state = makeState(
      [makeNode(0, { owner: 0, points: 20 }), makeNode(1), makeNode(2)],
      [[0, 1]],
    );

    expect(sendSquad(state, 0, 0, 2, 0.5)).toBeNull();
    expect(state.squads).toHaveLength(0);
  });

  test('refuses to send when the fraction rounds down to nothing', () => {
    const state = twoNodes(0, 1);

    expect(sendSquad(state, 0, 0, 1, 0.5)).toBeNull();
    expect(state.nodes[0]!.points).toBe(1);
  });

  test('a neutral node cannot be ordered to attack', () => {
    const state = twoNodes(NEUTRAL, 20);

    expect(sendSquad(state, NEUTRAL, 0, 1, 0.5)).toBeNull();
  });

  test('each squad gets a distinct id', () => {
    const state = twoNodes(0, 40);

    const first = sendSquad(state, 0, 0, 1, 0.5)!;
    const second = sendSquad(state, 0, 0, 1, 0.5)!;

    expect(first.id).not.toBe(second.id);
  });
});
