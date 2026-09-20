import { describe, expect, test } from 'vitest';
import { NEUTRAL, type GameState } from '../core/state';
import { makeNode, makeState } from '../core/fixtures';
import { createRng } from '../core/rng';
import { DIFFICULTIES, createAi, type Difficulty } from './ai';

const AI_PLAYER = 1;

function ai(difficulty: Difficulty = 'normal', seed = 1) {
  return createAi(AI_PLAYER, difficulty, createRng(seed));
}

/** Runs the AI long enough for one decision at the given difficulty. */
function letItThink(state: GameState, difficulty: Difficulty = 'normal', seed = 1) {
  const brain = ai(difficulty, seed);
  brain.update(state, DIFFICULTIES[difficulty].reactionTime + 0.01);
  return brain;
}

describe('createAi', () => {
  test('does nothing when it owns no nodes', () => {
    const state = makeState([makeNode(0, { owner: 0, points: 40 }), makeNode(1)], [[0, 1]]);

    letItThink(state);

    expect(state.squads).toHaveLength(0);
  });

  test('waits for its reaction time before acting', () => {
    const state = makeState(
      [makeNode(0, { owner: AI_PLAYER, points: 40 }), makeNode(1, { owner: NEUTRAL, points: 5 })],
      [[0, 1]],
    );
    const brain = ai('normal');

    brain.update(state, DIFFICULTIES.normal.reactionTime * 0.5);

    expect(state.squads).toHaveLength(0);
  });

  test('takes an adjacent neutral node it can afford', () => {
    const state = makeState(
      [makeNode(0, { owner: AI_PLAYER, points: 40 }), makeNode(1, { owner: NEUTRAL, points: 5 })],
      [[0, 1]],
    );

    letItThink(state);

    expect(state.squads).toHaveLength(1);
    expect(state.squads[0]!.to).toBe(1);
    expect(state.squads[0]!.amount).toBeGreaterThan(5);
  });

  test('does not attack a target it cannot take', () => {
    const state = makeState(
      [makeNode(0, { owner: AI_PLAYER, points: 10 }), makeNode(1, { owner: 0, points: 90 })],
      [[0, 1]],
    );

    letItThink(state);

    expect(state.squads).toHaveLength(0);
    expect(state.nodes[0]!.points).toBe(10);
  });

  test('prefers the more valuable of two affordable targets', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 60 }),
        makeNode(1, { owner: NEUTRAL, points: 5, capacity: 25, radius: 16 }),
        makeNode(2, { owner: NEUTRAL, points: 5, capacity: 90, radius: 31 }),
      ],
      [
        [0, 1],
        [0, 2],
      ],
    );

    letItThink(state);

    expect(state.squads[0]!.to).toBe(2);
  });

  test('leaves a garrison behind rather than emptying a node', () => {
    const state = makeState(
      [makeNode(0, { owner: AI_PLAYER, points: 40 }), makeNode(1, { owner: NEUTRAL, points: 5 })],
      [[0, 1]],
    );

    letItThink(state);

    expect(state.nodes[0]!.points).toBeGreaterThan(0);
  });

  test('sends enough to beat the defenders that grow during the flight', () => {
    const state = makeState(
      [makeNode(0, { owner: AI_PLAYER, points: 60 }), makeNode(1, { owner: 0, points: 20 })],
      [[0, 1]],
    );

    letItThink(state);

    const flightSeconds = state.edges[0]!.length / 140;
    expect(state.squads[0]!.amount).toBeGreaterThan(20 + flightSeconds);
  });

  test('the safety margin does not scale with the size of the battle', () => {
    // A 20-point cushion is prudent on a skirmish and unreachable on a siege.
    const state = makeState(
      [makeNode(0, { owner: AI_PLAYER, points: 520 }), makeNode(1, { owner: 0, points: 500 })],
      [[0, 1]],
    );

    letItThink(state);

    expect(state.squads).toHaveLength(1);
    expect(state.squads[0]!.amount).toBeGreaterThan(500);
  });

  test('goes all in when that is the only way to break a stalemate', () => {
    const state = makeState(
      [makeNode(0, { owner: AI_PLAYER, points: 100 }), makeNode(1, { owner: 0, points: 80 })],
      [[0, 1]],
    );

    letItThink(state);

    expect(state.squads).toHaveLength(1);
    expect(state.squads[0]!.amount).toBeGreaterThan(80);
  });

  test('prefers a cheap attack over going all in elsewhere', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 100 }),
        makeNode(1, { owner: 0, points: 80, capacity: 90 }),
        makeNode(2, { owner: NEUTRAL, points: 5, capacity: 50 }),
      ],
      [
        [0, 1],
        [0, 2],
      ],
    );

    letItThink(state);

    expect(state.squads[0]!.to).toBe(2);
  });

  test('a harder opponent commands several nodes at once', () => {
    const build = () =>
      makeState(
        [
          makeNode(0, { owner: AI_PLAYER, points: 60 }),
          makeNode(1, { owner: AI_PLAYER, points: 60 }),
          makeNode(2, { owner: NEUTRAL, points: 5 }),
          makeNode(3, { owner: NEUTRAL, points: 5 }),
        ],
        [
          [0, 2],
          [1, 3],
        ],
      );
    const slow = build();
    const fast = build();

    letItThink(slow, 'easy');
    letItThink(fast, 'hard');

    expect(slow.squads).toHaveLength(1);
    expect(fast.squads.length).toBeGreaterThan(1);
  });

  test('stops issuing orders once nothing is worth doing', () => {
    const state = makeState(
      [makeNode(0, { owner: AI_PLAYER, points: 60 }), makeNode(1, { owner: NEUTRAL, points: 5 })],
      [[0, 1]],
    );

    letItThink(state, 'hard');

    expect(state.squads).toHaveLength(1);
  });

  test('a harder opponent reacts faster', () => {
    expect(DIFFICULTIES.hard.reactionTime).toBeLessThan(DIFFICULTIES.normal.reactionTime);
    expect(DIFFICULTIES.normal.reactionTime).toBeLessThan(DIFFICULTIES.easy.reactionTime);
  });

  test('an easy opponent stays idle while a hard one has already moved', () => {
    const build = () =>
      makeState(
        [makeNode(0, { owner: AI_PLAYER, points: 40 }), makeNode(1, { owner: NEUTRAL, points: 5 })],
        [[0, 1]],
      );
    const slow = build();
    const fast = build();
    const elapsed = DIFFICULTIES.hard.reactionTime + 0.01;

    ai('easy').update(slow, elapsed);
    ai('hard').update(fast, elapsed);

    expect(slow.squads).toHaveLength(0);
    expect(fast.squads).toHaveLength(1);
  });

  test('stops acting once the match is decided', () => {
    const state = makeState(
      [makeNode(0, { owner: AI_PLAYER, points: 40 }), makeNode(1, { owner: NEUTRAL, points: 5 })],
      [[0, 1]],
    );
    state.winner = AI_PLAYER;

    letItThink(state);

    expect(state.squads).toHaveLength(0);
  });

  test('only ever issues legal orders for its own nodes', () => {
    const state = makeState(
      [
        makeNode(0, { owner: 0, points: 40 }),
        makeNode(1, { owner: AI_PLAYER, points: 40 }),
        makeNode(2, { owner: NEUTRAL, points: 5 }),
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );

    letItThink(state);

    for (const squad of state.squads) {
      expect(squad.owner).toBe(AI_PLAYER);
      expect(state.adjacency[squad.from]).toContain(squad.to);
    }
  });

  test('ships points forward when its frontier node cannot attack alone', () => {
    // Node 1 sits on the frontier but can never afford node 2 by itself.
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 50, capacity: 50 }),
        makeNode(1, { owner: AI_PLAYER, points: 10, capacity: 25 }),
        makeNode(2, { owner: NEUTRAL, points: 31, capacity: 90 }),
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );

    letItThink(state);

    expect(state.squads).toHaveLength(1);
    expect(state.squads[0]!.from).toBe(0);
    expect(state.squads[0]!.to).toBe(1);
  });

  test('moves reserves up from the deep rear, not just from the border', () => {
    // A chain: node 3 holds the border, node 0 is two hops behind it.
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 50, capacity: 50 }),
        makeNode(1, { owner: AI_PLAYER, points: 10, capacity: 50 }),
        makeNode(2, { owner: AI_PLAYER, points: 10, capacity: 50 }),
        makeNode(3, { owner: AI_PLAYER, points: 10, capacity: 25 }),
        makeNode(4, { owner: 0, points: 400, capacity: 90 }),
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
      ],
    );

    letItThink(state);

    expect(state.squads.some((squad) => squad.from === 0 && squad.to === 1)).toBe(true);
  });

  test('never sends reserves backwards, away from the fighting', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 10, capacity: 50 }),
        makeNode(1, { owner: AI_PLAYER, points: 50, capacity: 50 }),
        makeNode(2, { owner: 0, points: 400, capacity: 90 }),
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );

    letItThink(state);

    // Node 1 holds the border; shipping its garrison back to node 0 would be
    // the one move that loses ground for free.
    expect(state.squads.every((squad) => squad.to !== 0)).toBe(true);
  });

  test('prefers attacking over reinforcing when an attack is available', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 50, capacity: 50 }),
        makeNode(1, { owner: AI_PLAYER, points: 10, capacity: 25 }),
        makeNode(2, { owner: NEUTRAL, points: 5, capacity: 25 }),
      ],
      [
        [0, 1],
        [0, 2],
        [1, 2],
      ],
    );

    letItThink(state);

    expect(state.squads[0]!.to).toBe(2);
  });

  test('does not reinforce a node that is nowhere near the fighting', () => {
    // Both of its nodes are safe and there is nothing to attack.
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 50, capacity: 50 }),
        makeNode(1, { owner: AI_PLAYER, points: 10, capacity: 25 }),
      ],
      [[0, 1]],
    );

    letItThink(state);

    expect(state.squads).toHaveLength(0);
  });

  test('the same situation and seed give the same decision', () => {
    const build = () =>
      makeState(
        [
          makeNode(0, { owner: AI_PLAYER, points: 60 }),
          makeNode(1, { owner: NEUTRAL, points: 5, capacity: 50 }),
          makeNode(2, { owner: NEUTRAL, points: 5, capacity: 50 }),
        ],
        [
          [0, 1],
          [0, 2],
        ],
      );
    const first = build();
    const second = build();

    letItThink(first, 'normal', 99);
    letItThink(second, 'normal', 99);

    expect(first.squads).toEqual(second.squads);
  });
});
