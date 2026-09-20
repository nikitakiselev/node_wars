import { describe, expect, test } from 'vitest';
import { createAi, type Difficulty } from '../ai/ai';
import { generateMap } from '../core/mapgen';
import { createRng } from '../core/rng';
import { isEliminated, step } from '../core/simulation';
import { standingsFor } from '../core/standings';
import { NEUTRAL } from '../core/state';
import {
  HUMAN,
  MAP_SIZES,
  MAX_OPPONENTS,
  Match,
  STEP_SECONDS,
  WORLD,
  defaultSettings,
} from './match';

const MAP = { width: WORLD.width, height: WORLD.height, minDistance: 135, keepRatio: 0.5 };

/** Plays a whole match between two bots and reports how it ended. */
function playOut(seed: number, left: Difficulty, right: Difficulty, maxMinutes = 20) {
  const state = generateMap({ ...MAP, seed });
  const bots = [
    createAi(0, left, createRng(seed + 1)),
    createAi(1, right, createRng(seed + 2)),
  ];

  const maxSteps = Math.ceil((maxMinutes * 60) / STEP_SECONDS);
  for (let i = 0; i < maxSteps && state.winner === null; i++) {
    step(state, STEP_SECONDS);
    for (const bot of bots) bot.update(state, STEP_SECONDS);
  }

  return state;
}

describe('a full match', () => {
  test('the board is mostly claimed early and fully claimed later', () => {
    // The failure this guards against is a dead match: bots that expand a
    // little and then sit on their hands while the map stays neutral.
    // Measured: usually clear by minute three to five, once as late as twelve.
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = generateMap({ ...MAP, seed });
      const bots = [
        createAi(0, 'normal', createRng(seed + 1)),
        createAi(1, 'normal', createRng(seed + 2)),
      ];

      const neutralAfter = (seconds: number) => {
        while (state.time < seconds && state.winner === null) {
          step(state, STEP_SECONDS);
          for (const bot of bots) bot.update(state, STEP_SECONDS);
        }
        return state.nodes.filter((n) => n.owner === NEUTRAL).length;
      };

      const early = neutralAfter(300);
      expect(early / state.nodes.length, `seed ${seed} at five minutes`).toBeLessThan(0.1);
      expect(neutralAfter(900), `seed ${seed} at fifteen minutes`).toBe(0);
    }
  });

  test('nothing is left unclaimed, however long the war lasts', () => {
    // The old failure this guards against: a pocket of neutral nodes that no
    // frontier node could ever afford, leaving the map unwinnable for anyone.
    for (let seed = 1; seed <= 10; seed++) {
      const state = playOut(seed, 'normal', 'normal');
      const neutral = state.nodes.filter((n) => n.owner === NEUTRAL).length;

      expect(neutral, `seed ${seed} left ${neutral} nodes neutral`).toBe(0);
    }
  });

  test('most matches between equal bots are settled', () => {
    // Before nodes could be built up, two equal bots ground to a near-draw on
    // six maps out of ten. Compounding economies break that: a small lead now
    // grows into a win. Measured at 8/10; the bar leaves room for variance.
    let finished = 0;
    for (let seed = 1; seed <= 10; seed++) {
      if (playOut(seed, 'hard', 'hard').winner !== null) finished++;
    }

    expect(finished).toBeGreaterThanOrEqual(6);
  });

  test('a decided match leaves nothing unclaimed', () => {
    const state = playOut(4, 'hard', 'hard');

    expect(state.winner).not.toBeNull();
    expect(state.nodes.every((node) => node.owner === state.winner)).toBe(true);
  });

  test('a hard bot beats an easy one on most maps', () => {
    let hardWins = 0;
    for (let seed = 30; seed < 40; seed++) {
      // Sides are swapped by parity so the result is not a map-side artefact.
      const hardIsLeft = seed % 2 === 0;
      const state = playOut(
        seed,
        hardIsLeft ? 'hard' : 'easy',
        hardIsLeft ? 'easy' : 'hard',
      );
      if (state.winner === (hardIsLeft ? 0 : 1)) hardWins++;
    }

    expect(hardWins).toBeGreaterThanOrEqual(8);
  });
});

describe('Match', () => {
  const settings = (over: Partial<ReturnType<typeof defaultSettings>> = {}) => ({
    ...defaultSettings(),
    seed: 4242,
    ...over,
  });

  test('advances simulated time as real time passes', () => {
    const match = new Match(settings());

    for (let frame = 0; frame < 60; frame++) match.advance(1 / 60);

    expect(match.state.time).toBeGreaterThan(0.9);
    expect(match.state.time).toBeLessThanOrEqual(1.01);
  });

  test('the opponent starts expanding within the first few seconds', () => {
    const match = new Match(settings());

    for (let frame = 0; frame < 60 * 8; frame++) match.advance(1 / 60);

    expect(standingsFor(match.state, 1).nodes).toBeGreaterThan(1);
  });

  test('the same seed and difficulty replay identically', () => {
    const run = () => {
      const match = new Match(settings({ seed: 777, difficulty: 'hard' }));
      for (let frame = 0; frame < 60 * 20; frame++) match.advance(1 / 60);
      return match.state;
    };

    expect(run()).toEqual(run());
  });
});

describe('match settings', () => {
  const base = { ...defaultSettings(), seed: 909 };

  test('seats one opponent per requested bot', () => {
    for (const aiCount of [1, 2, 3, 4, 5]) {
      const match = new Match({ ...base, aiCount });
      const owners = new Set(match.state.nodes.map((n) => n.owner));

      for (let player = 0; player <= aiCount; player++) {
        expect(owners.has(player), `player ${player} of ${aiCount} bots`).toBe(true);
      }
      expect(owners.has(aiCount + 1)).toBe(false);
    }
  });

  test('every bot plays, not just the first', () => {
    const match = new Match({ ...base, aiCount: 3, difficulty: 'hard' });

    for (let frame = 0; frame < 60 * 20; frame++) match.advance(1 / 60);

    for (const player of [1, 2, 3]) {
      expect(
        match.state.nodes.filter((n) => n.owner === player).length,
        `bot ${player} never expanded`,
      ).toBeGreaterThan(1);
    }
  });

  test('a larger board holds more nodes', () => {
    const small = new Match({ ...base, mapSize: 'small' });
    const large = new Match({ ...base, mapSize: 'large' });

    expect(small.state.nodes.length).toBeLessThan(large.state.nodes.length);
  });

  test('every board size seats every allowed number of opponents', () => {
    for (const size of Object.keys(MAP_SIZES) as (keyof typeof MAP_SIZES)[]) {
      for (let aiCount = 1; aiCount <= MAX_OPPONENTS; aiCount++) {
        for (const seed of [11, 12, 13]) {
          const match = new Match({ ...base, seed, mapSize: size, aiCount });
          const owners = new Set(match.state.nodes.map((n) => n.owner));

          expect(match.state.nodes.length, `${size}/${aiCount}`).toBeGreaterThan(aiCount * 4);
          expect(owners.size, `${size}, ${aiCount} bots, seed ${seed}`).toBe(aiCount + 2);
        }
      }
    }
  });

  test('never seats more opponents than there are colours', () => {
    const match = new Match({ ...base, aiCount: 99 });

    expect(match.settings.aiCount).toBe(MAX_OPPONENTS);
  });

  test('a harsher board makes the neutral ground cost more', () => {
    const gentle = new Match({ ...base, mapDifficulty: 'gentle' });
    const harsh = new Match({ ...base, mapDifficulty: 'harsh' });

    const neutralPoints = (m: Match) =>
      m.state.nodes.filter((n) => n.owner === NEUTRAL).reduce((sum, n) => sum + n.points, 0);

    expect(neutralPoints(harsh)).toBeGreaterThan(neutralPoints(gentle));
  });
});

describe('a human who never plays', () => {
  test('is told they lost instead of being left staring at the board', () => {
    // The reported bug: wiped out, nothing left, and the game said nothing,
    // because no one yet held every node.
    const match = new Match({ ...defaultSettings(), seed: 512, difficulty: 'hard' });

    let toldAtSecond = -1;
    for (let frame = 0; frame < 60 * 60 * 6; frame++) {
      match.advance(1 / 60);
      if (match.state.winner !== null || isEliminated(match.state, HUMAN)) {
        toldAtSecond = Math.round(match.state.time);
        break;
      }
    }

    expect(toldAtSecond, 'six minutes passed without a verdict').toBeGreaterThan(0);
    expect(match.state.nodes.filter((n) => n.owner === HUMAN)).toHaveLength(0);
  });

  test('losing does not wait for the winner to mop up neutral ground', () => {
    const match = new Match({ ...defaultSettings(), seed: 512, difficulty: 'hard' });
    while (!isEliminated(match.state, HUMAN) && match.state.time < 600) {
      match.advance(1 / 60);
    }

    expect(isEliminated(match.state, HUMAN)).toBe(true);
    expect(match.state.winner).not.toBeNull();
  });
});
