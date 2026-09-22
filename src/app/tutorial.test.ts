import { describe, expect, test } from 'vitest';
import { isConnected } from '../core/graph';
import { MAX_LEVEL, radiusForLevel } from '../core/levels';
import { step } from '../core/simulation';
import { NEUTRAL } from '../core/state';
import { setWire } from '../core/wires';
import { MIN_BALANCER_NEIGHBOURS, convertNode } from '../core/convert';
import { upgradeNode } from '../core/upgrade';
import { HUMAN, NODE_SPACING, STEP_SECONDS } from './match';
import {
  TUTORIAL_PACE,
  TUTORIAL_STEPS,
  TUTORIAL_WIRE_FILL,
  TUTORIAL_WIRE_SHARE,
  TUTORIAL_WORLD,
  nextStep,
  taught,
  tutorialBoard,
} from './tutorial';
import { WIRE_FILLS, WIRE_SHARES } from '../core/wires';

describe('the tutorial board', () => {
  test('is one piece: no step can ask for a node nothing reaches', () => {
    const board = tutorialBoard();
    expect(isConnected(board.nodes.length, board.edges)).toBe(true);
  });

  test('sits inside the world with room for a node built to the top', () => {
    const margin = radiusForLevel(MAX_LEVEL);

    for (const node of tutorialBoard().nodes) {
      expect(node.x, `node ${node.id}`).toBeGreaterThanOrEqual(margin);
      expect(node.y, `node ${node.id}`).toBeGreaterThanOrEqual(margin);
      expect(node.x, `node ${node.id}`).toBeLessThanOrEqual(TUTORIAL_WORLD.width - margin);
      expect(node.y, `node ${node.id}`).toBeLessThanOrEqual(TUTORIAL_WORLD.height - margin);
    }
  });

  test('is square, so a phone on its end needs no second board', () => {
    expect(TUTORIAL_WORLD.width).toBe(TUTORIAL_WORLD.height);
  });

  test('keeps its nodes a step apart, so none is drawn over another', () => {
    const nodes = tutorialBoard().nodes;

    for (const from of nodes) {
      for (const to of nodes) {
        if (from.id >= to.id) continue;
        const gap = Math.hypot(to.x - from.x, to.y - from.y);
        expect(gap, `${from.id}-${to.id}`).toBeGreaterThanOrEqual(NODE_SPACING);
      }
    }
  });

  test('leaves an opponent standing, or the match is won before it begins', () => {
    const state = tutorialBoard();
    const rivals = state.nodes.filter(
      (node) => node.owner !== HUMAN && node.owner !== NEUTRAL,
    );

    expect(rivals.length).toBeGreaterThan(0);
    step(state, STEP_SECONDS);
    expect(state.winner).toBeNull();
  });

  test('the ids are the indices, which is what the engine reads them as', () => {
    // A hole in the numbering builds an adjacency list one short, and the game
    // goes down on the first frame rather than failing anywhere near here.
    tutorialBoard().nodes.forEach((node, index) => {
      expect(node.id, `node at ${index}`).toBe(index);
    });
  });

  test('opens on a crossroads that has to earn the neighbours a hub needs', () => {
    const state = tutorialBoard();
    const hub = state.nodes[0]!;

    expect(hub.owner).toBe(HUMAN);
    expect(hub.level).toBe(MAX_LEVEL);

    const neighbours = state.adjacency[0]!;
    const own = neighbours.filter((id) => state.nodes[id]!.owner === HUMAN);
    const free = neighbours.filter((id) => state.nodes[id]!.owner === NEUTRAL);

    // One to begin with, two to take, three in the end — which is exactly
    // what building a balancer asks for.
    expect(own).toHaveLength(1);
    expect(free).toHaveLength(2);
    expect(own.length + free.length).toBe(MIN_BALANCER_NEIGHBOURS);
  });
});

/** The first step that asks for something rather than explaining something. */
const FIRST_DOING = TUTORIAL_STEPS.findIndex((step) => step.kind === 'do');

describe('walking the script', () => {
  test('opens by explaining before it asks for anything', () => {
    expect(TUTORIAL_STEPS[0]!.kind).toBe('read');
    expect(FIRST_DOING).toBeGreaterThanOrEqual(4);
  });

  test('a reading step waits for its button and nothing else', () => {
    const state = tutorialBoard();

    // Nothing on the board can close one; the walk stops where it starts.
    expect(nextStep(state, 0)).toBe(0);
    expect(nextStep(state, 1)).toBe(1);
  });

  test('every step can be finished, and finishing it moves the player on', () => {
    const state = tutorialBoard();
    // What the player would do, in the order the script asks for it.
    const orders: (() => void)[] = [
      () => void (state.nodes[2]!.owner = HUMAN),
      () => void (state.nodes[3]!.owner = HUMAN),
      () => {
        state.nodes[1]!.points = 100;
        upgradeNode(state, HUMAN, 1);
      },
      () => void setWire(state, HUMAN, 1, 0),
      () => {
        state.nodes[0]!.points = 240;
        convertNode(state, HUMAN, 0, 'balancer');
      },
      () => {
        setWire(state, HUMAN, 0, 2);
        setWire(state, HUMAN, 0, 3);
      },
    ];

    let at = 0;
    let guard = 0;

    while (!taught(at) && guard++ < 50) {
      const step = TUTORIAL_STEPS[at]!;
      if (step.kind === 'read') {
        // The button, which is the only thing that closes one.
        at += 1;
        continue;
      }

      orders.shift()!();
      const after = nextStep(state, at);
      expect(after, `step ${at} did not close`).toBeGreaterThan(at);
      at = after;
    }

    expect(taught(at)).toBe(true);
    // Every order the script asks for was needed; none was left over.
    expect(orders).toHaveLength(0);
  });

  test('doing something before being asked is not asked for again', () => {
    const state = tutorialBoard();
    setWire(state, HUMAN, 1, 0);

    expect(nextStep(state, FIRST_DOING)).toBe(FIRST_DOING);
    state.nodes[2]!.owner = HUMAN;
    state.nodes[3]!.owner = HUMAN;

    // Both captures close, and the wire step behind them is walked past too
    // once the reading step between them is out of the way.
    const after = nextStep(state, FIRST_DOING);
    expect(after).toBeGreaterThan(FIRST_DOING + 1);
  });

  test('every doing step names the button that does it', () => {
    for (const [index, step] of TUTORIAL_STEPS.entries()) {
      if (step.kind !== 'do') continue;
      expect(['left', 'right'], `step ${index}`).toContain(step.button);
    }
  });

  test('the wire steps are the right-button ones, and only those', () => {
    // Which button gives which order is the thing a newcomer cannot guess, so
    // the script and the game must not be able to disagree about it.
    const right = TUTORIAL_STEPS.filter((s) => s.kind === 'do' && s.button === 'right');
    expect(right).toHaveLength(2);
    for (const step of right) {
      expect(step.say(false).toLowerCase()).toContain('провод');
    }
  });

  test('every step says something, and says it for both hands', () => {
    for (const [index, entry] of TUTORIAL_STEPS.entries()) {
      expect(entry.say(false).length, `step ${index}`).toBeGreaterThan(20);
      expect(entry.say(true).length, `step ${index}`).toBeGreaterThan(20);
      // The callout is a card, not a page: past this it stops being read.
      expect(entry.say(false).length, `step ${index}`).toBeLessThanOrEqual(110);
      expect(entry.say(true).length, `step ${index}`).toBeLessThanOrEqual(110);
      // A reading step points with its box; a doing step points at the nodes
      // the hand has to move between.
      if (entry.kind === 'do') {
        expect(entry.at.length, `step ${index}`).toBeGreaterThan(0);
        if (entry.gesture === 'drag') {
          expect(entry.at.length, `step ${index}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  test('the board is introduced before anything on it is', () => {
    expect(TUTORIAL_STEPS[0]!.frame).toBe('board');
  });

  test('all three kinds of owner are pointed out before the first order', () => {
    const state = tutorialBoard();
    const shown = new Set<number>();

    for (const step of TUTORIAL_STEPS) {
      if (step.kind !== 'read') break;
      if (step.frame === 'board') continue;
      for (const id of step.frame) shown.add(state.nodes[id]!.owner);
    }

    expect(shown.has(HUMAN), 'your own').toBe(true);
    expect(shown.has(NEUTRAL), 'nobody\'s').toBe(true);
    expect([...shown].some((owner) => owner !== HUMAN && owner !== NEUTRAL)).toBe(true);
  });

  test('a box drawn round a step never catches a node the step is not about', () => {
    // The mistake this stands guard over: "these are yours" with a box round
    // three of your nodes and two of nobody's, because a rectangle over
    // scattered circles swallows whatever sits between them.
    const state = tutorialBoard();
    const room = 26;

    for (const [index, step] of TUTORIAL_STEPS.entries()) {
      if (step.frame === 'board') continue;

      const inside = step.frame.map((id) => state.nodes[id]!);
      const left = Math.min(...inside.map((n) => n.x - n.radius)) - room;
      const right = Math.max(...inside.map((n) => n.x + n.radius)) + room;
      const top = Math.min(...inside.map((n) => n.y - n.radius)) - room;
      const bottom = Math.max(...inside.map((n) => n.y + n.radius)) + room;

      for (const node of state.nodes) {
        if (step.frame.includes(node.id)) continue;
        const caught =
          node.x > left && node.x < right && node.y > top && node.y < bottom;
        expect(caught, `step ${index} boxes node ${node.id} as well`).toBe(false);
      }
    }
  });

  test('every step frames something that is on the board', () => {
    const state = tutorialBoard();

    for (const [index, step] of TUTORIAL_STEPS.entries()) {
      if (step.frame === 'board') continue;
      expect(step.frame.length, `step ${index}`).toBeGreaterThan(0);
      for (const id of step.frame) {
        expect(state.nodes[id], `step ${index} frames node ${id}`).toBeDefined();
      }
    }
  });

  test('the touch wording never names a key or a button that is not there', () => {
    const touch = TUTORIAL_STEPS.map((entry) => entry.say(true)).join(' ').toLowerCase();

    for (const word of ['мыш', 'щёлкн', 'правой', 'shift', 'alt']) {
      expect(touch, word).not.toContain(word);
    }
  });
});

describe('the lesson runs fast enough to be watched', () => {
  test('a wound-up match moves points through the hub in seconds, not minutes', () => {
    const state = tutorialBoard();
    state.growth = TUTORIAL_PACE;
    state.wireFill = WIRE_FILLS[TUTORIAL_WIRE_FILL].fill;
    state.wireShare = WIRE_SHARES[TUTORIAL_WIRE_SHARE].share;

    // The board as the last step leaves it: both neutrals taken, the feeder
    // wired into the hub, the hub wired out to each of them.
    state.nodes[2]!.owner = HUMAN;
    state.nodes[3]!.owner = HUMAN;
    state.nodes[0]!.kind = 'balancer';
    state.nodes[0]!.points = 0;
    state.nodes[1]!.points = 0;
    setWire(state, HUMAN, 1, 0);
    setWire(state, HUMAN, 0, 2);
    setWire(state, HUMAN, 0, 3);

    const before = [2, 3].map((id) => state.nodes[id]!.points);
    for (let tick = 0; tick < 30 * 20; tick++) step(state, STEP_SECONDS);
    const after = [2, 3].map((id) => state.nodes[id]!.points);

    // Twenty seconds is about as long as anybody watches a demonstration.
    expect(after[0]!, 'the first neighbour was fed').toBeGreaterThan(before[0]!);
    expect(after[1]!, 'the second neighbour was fed').toBeGreaterThan(before[1]!);
    // And the hub kept nothing for itself, which is the point of it.
    expect(state.nodes[0]!.points).toBeLessThan(1);
  });
});
