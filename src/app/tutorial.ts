import { applyLevel } from '../core/levels';
import { HUMAN, NEUTRAL, type Edge, type GameNode, type GameState } from '../core/state';
import { HALF_KEY, QUARTER_KEY } from './keys';
import type { WireFill, WireShare } from '../core/wires';

/**
 * A scripted first match.
 *
 * The rules panel can say what a wire is; only the board can show it. So the
 * tutorial is a real match on a real board with the rules fully in force —
 * growth, combat, wires, everything — and exactly one thing taken away: the
 * opponent never moves. What is left is a game that waits for you.
 *
 * **The board is written out, never generated.** Every step points at a node
 * by its number, and map generation is tuned often — a board pinned to a seed
 * would be reshuffled by the next change to island sizes or the keep ratio,
 * and the script would go on pointing confidently at the wrong circles.
 *
 * It is square, so that standing a phone on its end does not need a second
 * layout. The steps are conditions on the state rather than pages to click
 * through: the player is asked to do something and the board decides whether
 * they did, which means they can do it their own way and still be right.
 */
export const TUTORIAL_WORLD = { width: 900, height: 900 } as const;

/**
 * How the lesson is wound up so its last act can be watched.
 *
 * The final steps build a hub and wire it to its neighbours, and then —
 * nothing, for the best part of a minute, while the node feeding it inches
 * towards the mark. A demonstration nobody stays for demonstrates nothing.
 *
 * Six times the earning, and a wire that fires at half full rather than full,
 * so points move through the hub every few seconds and the split is a thing
 * you watch rather than a thing you are told about. The rules are untouched:
 * both of these are numbers a match already carries.
 */
export const TUTORIAL_PACE = 6;
export const TUTORIAL_WIRE_FILL: WireFill = 'half';
export const TUTORIAL_WIRE_SHARE: WireShare = 'half';

/** The opponent, who holds ground and never uses it. */
const RIVAL = 1;

interface Placed {
  id: number;
  x: number;
  y: number;
  owner: number;
  level: number;
  points: number;
}

/*
 * The shape of it:
 *
 *                     (2)
 *                    /   \
 *   (1)--(0)        |     (4)--(5)
 *          \        |    /
 *           `------(3)---
 *
 *   yours, left      nobody's, middle      the rival, right
 *
 * **The ids are the indices, and that is not a style choice.** Everything in
 * the engine reads `state.nodes[id]`, so a board whose numbering has a hole
 * in it builds an adjacency list that is one short and takes the game down on
 * the first frame. Numbered straight through, and a test stands over it.
 *
 * **Laid out in groups on purpose.** A step says "these are yours" and draws
 * a box round them, and a box round scattered circles swallows whoever
 * happens to sit between them — which is how the first version managed to
 * point at two neutral nodes while calling them the player's. Who owns what
 * is the first thing the tutorial teaches, so on this board it is also a
 * place: yours on the left, nobody's down the middle, the rival on the right.
 *
 * **Node 0 opens with one neighbour of its own and needs three.** That is the
 * shape of the whole lesson: the two it is missing are the two neutrals
 * beside it, so taking them is not busywork before the interesting part — it
 * is what makes the interesting part possible. A hub with nothing to share
 * out to demonstrates nothing.
 *
 * Those two are joined to each other as well, so the second can be taken from
 * the first: a drag sends everything by default, and after the opening attack
 * node 0 has nothing to attack with for a long minute.
 */
const PLACED: Placed[] = [
  { id: 0, x: 250, y: 450, owner: HUMAN, level: 5, points: 240 },
  { id: 1, x: 150, y: 450, owner: HUMAN, level: 1, points: 18 },
  { id: 2, x: 450, y: 320, owner: NEUTRAL, level: 1, points: 6 },
  { id: 3, x: 450, y: 580, owner: NEUTRAL, level: 1, points: 10 },
  { id: 4, x: 645, y: 450, owner: NEUTRAL, level: 2, points: 20 },
  { id: 5, x: 815, y: 450, owner: RIVAL, level: 3, points: 90 },
];

const LINKS: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [2, 3],
  [2, 4],
  [3, 4],
  [4, 5],
];

/** The board the tutorial is played on, built fresh each time it is started. */
export function tutorialBoard(): GameState {
  const nodes: GameNode[] = PLACED.map((placed) => {
    const node: GameNode = {
      id: placed.id,
      x: placed.x,
      y: placed.y,
      radius: 15,
      level: 1,
      capacity: 25,
      kind: 'base',
      owner: placed.owner,
      points: placed.points,
    };
    applyLevel(node, placed.level);
    return node;
  });

  const adjacency: number[][] = nodes.map(() => []);
  const edges: Edge[] = LINKS.map(([a, b]) => {
    const from = nodes[a]!;
    const to = nodes[b]!;
    adjacency[a]!.push(b);
    adjacency[b]!.push(a);
    return { a, b, length: Math.hypot(to.x - from.x, to.y - from.y) };
  });

  return {
    nodes,
    edges,
    adjacency,
    islands: nodes.map(() => 0),
    wires: nodes.map(() => []),
    squads: [],
    time: 0,
    winner: null,
    nextSquadId: 1,
  };
}

/**
 * A step is either something to read or something to do.
 *
 * Doing steps close themselves: the board is asked whether it has happened,
 * so the player may do it their own way, and doing it early is never asked
 * for again. A reading step has nothing to watch for and closes on a button —
 * which is worth the one extra control, because the first thing a new player
 * needs is not an order but to know what they are looking at.
 */
interface Common {
  /** What to say, worded for whatever the player has in their hand. */
  say(touch: boolean): string;
  /** The nodes the step is about, so the board can point at them. */
  at: readonly number[];
  /**
   * What to draw a box around and hang the words off: some nodes, or the
   * whole board.
   *
   * A sentence about "your nodes" is no use until the player knows which
   * circles those are, and pointing with words — "the big one on the left" —
   * is how a tutorial ages badly. The box says it without saying it.
   */
  frame: readonly number[] | 'board';
}

export interface ReadStep extends Common {
  kind: 'read';
}

export interface DoStep extends Common {
  kind: 'do';
  /**
   * The movement being asked for, shown on the board.
   *
   * A ring says which circle; it does not say what to do with it. A drag is
   * shown travelling from the first node to the second, a press as a knock on
   * the spot — the difference between the two orders this game has, and the
   * one thing that cannot be put into words for somebody who has not played.
   */
  gesture: 'drag' | 'press';
  /**
   * Which mouse button does it.
   *
   * Written out and drawn, not implied by the wording. Which button gives
   * which order is the one thing about this game a newcomer cannot guess and
   * the one thing no amount of describing the result explains — and a
   * sentence that opens "Правой кнопкой" is read after the hand has already
   * reached for the left one.
   */
  button: 'left' | 'right';
  /** Whether the player has done it. Read off the board, not off a click. */
  done(state: GameState): boolean;
}

export type TutorialStep = ReadStep | DoStep;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    kind: 'read',
    say: () => 'Это игровое поле: узлы и связи между ними. Ходить можно только по связям.',
    at: [],
    frame: 'board',
  },
  {
    kind: 'read',
    say: () => 'Это ваши узлы. Число внутри — очки: и запас, и войско разом.',
    at: [],
    frame: [0, 1],
  },
  {
    kind: 'read',
    say: () => 'Это узел соперника. Он тоже растёт, и с него тоже ходят.',
    at: [],
    frame: [5],
  },
  {
    kind: 'read',
    say: () => 'Это нейтральные узлы. Они ничьи и не растут — их и захватывают.',
    at: [],
    frame: [2, 3, 4],
  },
  {
    kind: 'do',
    say: (touch) =>
      touch
        ? 'Проведите пальцем от большого узла к серому — он станет вашим. Долю выбирает полоса внизу.'
        : `Перетащите от большого узла к серому — уйдёт всё. С ${HALF_KEY} половина, с ${QUARTER_KEY} четверть.`,
    at: [0, 2],
    frame: [0, 2],
    gesture: 'drag',
    button: 'left',
    done: (state) => state.nodes[2]?.owner === HUMAN,
  },
  {
    kind: 'do',
    say: () => 'Теперь возьмите второй серый узел — точно так же, перетаскиванием.',
    at: [2, 3],
    frame: [2, 3],
    gesture: 'drag',
    button: 'left',
    done: (state) => state.nodes[3]?.owner === HUMAN,
  },
  {
    kind: 'do',
    say: (touch) =>
      touch
        ? 'Коснитесь малого узла слева и нажмите + — он станет вместительнее.'
        : 'Щёлкните малый узел слева и нажмите + — он станет вместительнее.',
    at: [1],
    frame: [1],
    gesture: 'press',
    button: 'left',
    done: (state) => (state.nodes[1]?.level ?? 1) >= 2,
  },
  {
    kind: 'do',
    say: (touch) =>
      touch
        ? 'Включите «Провод» внизу и проведите от малого узла к большому.'
        : 'Правой кнопкой протяните провод от малого узла к большому.',
    at: [1, 0],
    frame: [1, 0],
    gesture: 'drag',
    button: 'right',
    done: (state) => (state.wires[1]?.length ?? 0) > 0,
  },
  {
    kind: 'do',
    say: (touch) =>
      touch
        ? 'Коснитесь большого узла и постройте балансировщик: он не копит, а раздаёт.'
        : 'Щёлкните большой узел и постройте балансировщик: он не копит, а раздаёт.',
    at: [0],
    frame: [0],
    gesture: 'press',
    button: 'left',
    done: (state) => state.nodes[0]?.kind === 'balancer',
  },
  {
    kind: 'do',
    say: () => 'Теперь проведите от него провода к обоим соседям — и он начнёт раздавать.',
    at: [0, 2, 3],
    frame: [0, 2, 3],
    gesture: 'drag',
    button: 'right',
    done: (state) => (state.wires[0]?.length ?? 0) >= 2,
  },
  {
    kind: 'read',
    say: () => 'Смотрите: левый узел копит и отдаёт хабу, а тот делит поровну между соседями.',
    at: [],
    frame: [1, 0, 2, 3],
  },
];

/**
 * The step the player is on, walking forward from where they were.
 *
 * Doing steps that are already satisfied are walked straight past, so a
 * player who lays a wire before being asked is not asked for one; a reading
 * step stops the walk until it is acknowledged. Returns the number of steps
 * when there are none left.
 */
export function nextStep(state: GameState, from = 0): number {
  let at = Math.max(0, from);

  while (at < TUTORIAL_STEPS.length) {
    const step = TUTORIAL_STEPS[at]!;
    if (step.kind === 'read' || !step.done(state)) break;
    at++;
  }

  return at;
}

/** Whether the script is finished. */
export function taught(at: number): boolean {
  return at >= TUTORIAL_STEPS.length;
}
