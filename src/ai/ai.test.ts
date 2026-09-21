import { describe, expect, test } from 'vitest';
import { NEUTRAL, type GameState } from '../core/state';
import { makeNode, makeState } from '../core/fixtures';
import { createRng } from '../core/rng';
import { MAX_LEVEL, applyLevel, capacityForLevel, upgradeCost } from '../core/levels';
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

describe('a stack it cannot take', () => {
  /**
   * The board that came out of a real match: the bot holds a full network, the
   * player has piled ten thousand points onto the one node between them, and
   * there is nothing else to take.
   */
  function siegeBoard(): GameState {
    const wall = makeNode(0, { owner: 0, points: 10_000, level: MAX_LEVEL });
    applyLevel(wall, MAX_LEVEL);
    wall.points = 10_000;

    const mine = [1, 2, 3].map((id) => {
      const node = makeNode(id, { owner: AI_PLAYER, level: MAX_LEVEL });
      applyLevel(node, MAX_LEVEL);
      node.points = capacityForLevel(MAX_LEVEL);
      return node;
    });

    return makeState([wall, ...mine], [
      [1, 0],
      [1, 2],
      [2, 3],
    ]);
  }

  test('is worn down rather than left alone', () => {
    // A node above its own ceiling earns nothing, so points taken off it stay
    // off, while the bot grows its own back. Refusing the trade leaves the bot
    // standing at full strength for the rest of the match.
    const state = siegeBoard();

    letItThink(state);

    // Squads between its own nodes do not count: shuffling reserves behind the
    // line is exactly what the bot was doing while it did nothing.
    const attacks = state.squads.filter((squad) => squad.to === 0);
    expect(attacks.length, 'the bot never attacked the stack').toBeGreaterThan(0);
    expect(attacks[0]!.amount).toBeGreaterThan(0);
  });

  test('but a node that can heal is left alone', () => {
    // Below its ceiling the node grows the damage back, so a wave that bounces
    // is thrown away. This is the half of the rule that keeps the bot sane.
    const state = siegeBoard();
    const wall = state.nodes[0]!;
    wall.points = wall.capacity - 1;

    letItThink(state);

    const attacks = state.squads.filter((squad) => squad.to === 0);
    expect(attacks).toHaveLength(0);
  });
});

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

  test('values a farm above a plain node of the same size', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 60 }),
        makeNode(1, { owner: NEUTRAL, points: 5, capacity: 50, kind: 'base' }),
        makeNode(2, { owner: NEUTRAL, points: 5, capacity: 50, kind: 'farm' }),
      ],
      [
        [0, 1],
        [0, 2],
      ],
    );

    letItThink(state);

    expect(state.squads[0]!.to).toBe(2);
  });

  test('will not throw at a fortress a force that would only take a plain node', () => {
    const plainTarget = makeState(
      [makeNode(0, { owner: AI_PLAYER, points: 60 }), makeNode(1, { owner: 0, points: 25 })],
      [[0, 1]],
    );
    const walled = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 60 }),
        makeNode(1, { owner: 0, points: 25, kind: 'fortress', level: 5 }),
      ],
      [[0, 1]],
    );

    letItThink(plainTarget);
    letItThink(walled);

    expect(plainTarget.squads).toHaveLength(1);
    expect(walled.squads).toHaveLength(0);
  });

  test('storms a fortress once it has double the force', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 150 }),
        makeNode(1, { owner: 0, points: 25, kind: 'fortress', level: 5 }),
      ],
      [[0, 1]],
    );

    letItThink(state);

    expect(state.squads).toHaveLength(1);
    expect(state.squads[0]!.amount).toBeGreaterThan(50);
  });

  test('takes the cheaper of a plain node and a fortress worth the same', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 80 }),
        makeNode(1, { owner: NEUTRAL, points: 5, capacity: 50, kind: 'base' }),
        makeNode(2, { owner: NEUTRAL, points: 5, capacity: 50, kind: 'fortress' }),
      ],
      [
        [0, 1],
        [0, 2],
      ],
    );

    letItThink(state);

    expect(state.squads[0]!.to).toBe(1);
  });

  test('expects a farm it is attacking to regrow faster while the attack flies', () => {
    const plain = makeState(
      [makeNode(0, { owner: AI_PLAYER, points: 90 }), makeNode(1, { owner: 0, points: 30 })],
      [[0, 1]],
    );
    const farm = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 90 }),
        makeNode(1, { owner: 0, points: 30, kind: 'farm' }),
      ],
      [[0, 1]],
    );

    letItThink(plain);
    letItThink(farm);

    expect(farm.squads[0]!.amount).toBeGreaterThan(plain.squads[0]!.amount);
  });

  test('builds up a rear node that has stopped earning', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER }),
        makeNode(1, { owner: AI_PLAYER }),
        makeNode(2, { owner: NEUTRAL, points: 5 }),
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );
    // Node 0 sits behind the border, full to the brim and earning nothing.
    applyLevel(state.nodes[0]!, 1);
    state.nodes[0]!.points = state.nodes[0]!.capacity;

    letItThink(state);

    expect(state.nodes[0]!.level).toBe(2);
  });

  test('does not build up a node that is holding the border', () => {
    const state = makeState(
      [makeNode(0, { owner: AI_PLAYER }), makeNode(1, { owner: 0, points: 500 })],
      [[0, 1]],
    );
    applyLevel(state.nodes[0]!, 1);
    state.nodes[0]!.points = state.nodes[0]!.capacity;

    letItThink(state);

    expect(state.nodes[0]!.level).toBe(1);
  });

  test('does not build up a node that has not filled up yet', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER }),
        makeNode(1, { owner: AI_PLAYER }),
        makeNode(2, { owner: NEUTRAL, points: 5 }),
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );
    applyLevel(state.nodes[0]!, 1);
    state.nodes[0]!.points = upgradeCost(1)! - 1;

    letItThink(state);

    expect(state.nodes[0]!.level).toBe(1);
  });

  test('leaves a node alone once it is built as far as it goes', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER }),
        makeNode(1, { owner: AI_PLAYER }),
        makeNode(2, { owner: NEUTRAL, points: 5 }),
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );
    applyLevel(state.nodes[0]!, MAX_LEVEL);
    state.nodes[0]!.points = 10_000;

    letItThink(state);

    expect(state.nodes[0]!.level).toBe(MAX_LEVEL);
    expect(state.nodes[0]!.capacity).toBe(capacityForLevel(MAX_LEVEL));
  });

  test('building up does not cost it an attack', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER }),
        makeNode(1, { owner: AI_PLAYER, points: 60 }),
        makeNode(2, { owner: NEUTRAL, points: 5 }),
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );
    applyLevel(state.nodes[0]!, 1);
    state.nodes[0]!.points = state.nodes[0]!.capacity;

    letItThink(state);

    expect(state.nodes[0]!.level).toBe(2);
    expect(state.squads.some((squad) => squad.to === 2)).toBe(true);
  });

  test('builds up a bridge it is holding, even though it is on the border', () => {
    // A fortress exists to be defended from. Refusing to build one up because
    // it stands on the border is exactly backwards.
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, kind: 'fortress' }),
        makeNode(1, { owner: 0, points: 5 }),
      ],
      [[0, 1]],
    );
    applyLevel(state.nodes[0]!, 1);
    state.nodes[0]!.points = state.nodes[0]!.capacity * 3;

    letItThink(state);

    expect(state.nodes[0]!.level).toBe(2);
  });

  test('will not build up a bridge if that leaves it thin', () => {
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, kind: 'fortress' }),
        makeNode(1, { owner: 0, points: 5 }),
      ],
      [[0, 1]],
    );
    applyLevel(state.nodes[0]!, 1);
    state.nodes[0]!.points = state.nodes[0]!.capacity;

    letItThink(state);

    expect(state.nodes[0]!.level).toBe(1);
  });

  test('still never builds up a plain node on the border', () => {
    const state = makeState(
      [makeNode(0, { owner: AI_PLAYER }), makeNode(1, { owner: 0, points: 5 })],
      [[0, 1]],
    );
    applyLevel(state.nodes[0]!, 1);
    state.nodes[0]!.points = state.nodes[0]!.capacity * 3;

    letItThink(state);

    expect(state.nodes[0]!.level).toBe(1);
  });

  test('sends reserves to the threatened border, not just the nearest one', () => {
    // Node 0 is the rear. Node 1 faces a big enemy stack and is the further
    // of the two, so distance alone would send the reserves to node 2.
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 60, capacity: 90, x: 0, y: 0 }),
        makeNode(1, { owner: AI_PLAYER, points: 10, capacity: 90, x: 300, y: 0 }),
        makeNode(2, { owner: AI_PLAYER, points: 10, capacity: 90, x: 100, y: 0 }),
        makeNode(3, { owner: 0, points: 400, capacity: 400, x: 600, y: 0 }),
        makeNode(4, { owner: 0, points: 12, capacity: 90, x: 100, y: 300 }),
      ],
      [
        [0, 1],
        [0, 2],
        [1, 3],
        [2, 4],
      ],
    );

    letItThink(state);

    const support = state.squads.find((squad) => squad.from === 0);
    expect(support, 'no reserves moved at all').toBeDefined();
    expect(support!.to).toBe(1);
  });

  test('defends a bridge before a plain node under the same pressure', () => {
    // Both borders are the same distance away and under the same pressure, so
    // only what is standing there can decide it.
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 60, capacity: 90, x: 0, y: 0 }),
        makeNode(1, {
          owner: AI_PLAYER,
          points: 10,
          capacity: 90,
          kind: 'fortress',
          x: 300,
          y: 0,
        }),
        makeNode(2, { owner: AI_PLAYER, points: 10, capacity: 90, x: 0, y: 300 }),
        makeNode(3, { owner: 0, points: 100, capacity: 400, x: 600, y: 0 }),
        makeNode(4, { owner: 0, points: 100, capacity: 400, x: 0, y: 600 }),
      ],
      [
        [0, 1],
        [0, 2],
        [1, 3],
        [2, 4],
      ],
    );

    letItThink(state);

    const support = state.squads.find((squad) => squad.from === 0);
    expect(support!.to).toBe(1);
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
    // Node 0 is deliberately short of its cap, or it would spend the points
    // on building itself up instead of shipping them forward.
    const state = makeState(
      [
        makeNode(0, { owner: AI_PLAYER, points: 50, capacity: 90 }),
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

    // The hop nearest the fighting is served first, so the deep rear's turn
    // comes a decision or two later.
    const brain = ai('normal');
    for (let think = 0; think < 4; think++) {
      brain.update(state, DIFFICULTIES.normal.reactionTime + 0.01);
    }

    expect(state.squads.some((squad) => squad.from === 0 && squad.to === 1)).toBe(true);
  });

  test('moves reserves up even while there is fighting somewhere else', () => {
    // A starved outpost that cannot afford the node in front of it, and a
    // busy front with more easy captures than the bot has orders to give.
    const nodes = [
      makeNode(0, { owner: AI_PLAYER, points: 60, capacity: 60 }),
      makeNode(1, { owner: AI_PLAYER, points: 25, capacity: 25 }),
      makeNode(2, { owner: NEUTRAL, points: 80, capacity: 90 }),
    ];
    const edges: [number, number][] = [
      [0, 1],
      [1, 2],
    ];
    for (let i = 0; i < 8; i++) {
      const attacker = 3 + i * 2;
      nodes.push(makeNode(attacker, { owner: AI_PLAYER, points: 60, capacity: 60 }));
      nodes.push(makeNode(attacker + 1, { owner: NEUTRAL, points: 5, capacity: 25 }));
      edges.push([attacker, attacker + 1]);
    }
    const state = makeState(nodes, edges);

    letItThink(state, 'hard');

    expect(
      state.squads.some((squad) => squad.from === 0 && squad.to === 1),
      'the outpost never got reinforced while the front was busy',
    ).toBe(true);
    expect(state.squads.filter((squad) => squad.to % 2 === 0 && squad.to > 3).length)
      .toBeGreaterThan(0);
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
