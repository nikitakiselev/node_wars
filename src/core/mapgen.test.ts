import { describe, expect, test } from 'vitest';
import { NEUTRAL, type GameState } from './state';
import { CONVERSIONS } from './convert';
import { isConnected } from './graph';
import { START_POINTS, generateMap, neighbourhoodCapacity } from './mapgen';
import { MAX_PLAYERS, factionOf } from '../render/theme';
import { BRIDGE } from './islands';
import { MAX_LEVEL, capacityForLevel, radiusForLevel } from './levels';

// A board the size the game actually plays on, at the spacing it uses.
const CONFIG = { width: 1600, height: 1000, minDistance: 70 };

function map(seed: number): GameState {
  return generateMap({ ...CONFIG, seed });
}

function ownedBy(state: GameState, owner: number) {
  return state.nodes.filter((n) => n.owner === owner);
}

describe('a board is a network, not a string of beads', () => {
  /** Nodes on islands; a bridge always has exactly two neighbours by design. */
  function inland(state: GameState) {
    return state.nodes.filter((node) => state.islands[node.id] !== BRIDGE);
  }

  test('the average node has somewhere to go besides back', () => {
    // At half the Delaunay edges this was 2.3 — a node's two neighbours were
    // where it came from and where it was going, so every front was one node
    // wide and nothing could be gone round.
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = map(seed);
      const nodes = inland(state);
      const degree =
        nodes.reduce((sum, n) => sum + (state.adjacency[n.id]?.length ?? 0), 0) / nodes.length;

      expect(degree, `seed ${seed}`).toBeGreaterThan(2.6);
    }
  });

  test('dead ends are rare rather than a fifth of the board', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = map(seed);
      const nodes = inland(state);
      const deadEnds = nodes.filter((n) => (state.adjacency[n.id]?.length ?? 0) <= 1);

      expect(deadEnds.length / nodes.length, `seed ${seed}`).toBeLessThan(0.15);
    }
  });

  test('there are real loops to go round through', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = map(seed);
      // Edges beyond a spanning tree: every one of them is another way round.
      const loops = state.edges.length - state.nodes.length + 1;

      expect(loops, `seed ${seed}`).toBeGreaterThan(state.nodes.length / 4);
    }
  });
});

describe('the core, the one node worth crossing the board for', () => {
  test('every board carries exactly one', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(map(seed).nodes.filter((n) => n.kind === 'core'), `seed ${seed}`).toHaveLength(1);
    }
  });

  test('nobody starts on it', () => {
    for (const seed of [11, 12, 13]) {
      const core = map(seed).nodes.find((n) => n.kind === 'core')!;
      expect(core.owner, `seed ${seed}`).toBe(NEUTRAL);
    }
  });

  test('it is defended more heavily than plain ground', () => {
    const state = map(14);
    const core = state.nodes.find((n) => n.kind === 'core')!;
    const plain = state.nodes.find((n) => n.owner === NEUTRAL && n.kind === 'base')!;

    expect(core.points / core.capacity).toBeGreaterThan(plain.points / plain.capacity);
  });

  test('it sits near the middle, where everyone has to come to it', () => {
    const centre = { x: CONFIG.width / 2, y: CONFIG.height / 2 };
    const away = (n: { x: number; y: number }) => Math.hypot(n.x - centre.x, n.y - centre.y);

    for (const seed of [21, 22, 23]) {
      const state = map(seed);
      const core = state.nodes.find((n) => n.kind === 'core')!;
      const distances = state.nodes.map(away).sort((a, b) => a - b);
      const median = distances[Math.floor(distances.length / 2)]!;

      expect(away(core), `seed ${seed}`).toBeLessThan(median);
    }
  });
});

describe('generateMap', () => {
  test('the same seed produces an identical map', () => {
    expect(map(2024)).toEqual(map(2024));
  });

  test('different seeds produce different maps', () => {
    expect(map(1)).not.toEqual(map(2));
  });

  test('produces a playable number of nodes', () => {
    const state = map(11);

    expect(state.nodes.length).toBeGreaterThanOrEqual(25);
    expect(state.nodes.length).toBeLessThanOrEqual(90);
  });

  test('node ids match their position in the array', () => {
    const state = map(12);

    state.nodes.forEach((node, index) => expect(node.id).toBe(index));
  });

  test('the graph is connected', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const state = map(seed);
      expect(isConnected(state.nodes.length, state.edges)).toBe(true);
    }
  });

  test('adjacency agrees with the edge list', () => {
    const state = map(13);

    for (const edge of state.edges) {
      expect(state.adjacency[edge.a]).toContain(edge.b);
      expect(state.adjacency[edge.b]).toContain(edge.a);
    }
  });

  test('gives each player exactly one starting node and leaves the rest neutral', () => {
    const state = map(14);

    expect(ownedBy(state, 0)).toHaveLength(1);
    expect(ownedBy(state, 1)).toHaveLength(1);
    expect(ownedBy(state, NEUTRAL)).toHaveLength(state.nodes.length - 2);
  });

  test('both players start with the same points and capacity', () => {
    const state = map(15);
    const [first] = ownedBy(state, 0);
    const [second] = ownedBy(state, 1);

    expect(first!.points).toBe(START_POINTS);
    expect(second!.points).toBe(START_POINTS);
    expect(first!.capacity).toBe(second!.capacity);
  });

  test('starts the players at opposite ends of the map', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const state = map(seed);
      const a = ownedBy(state, 0)[0]!;
      const b = ownedBy(state, 1)[0]!;
      const diagonal = Math.hypot(CONFIG.width, CONFIG.height);

      // Seats go on different islands, which bounds how far apart they can be
      // put: the furthest pair of islands is not the furthest pair of nodes.
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(diagonal * 0.3);
    }
  });

  test('gives both players a comparable neighbourhood to expand into', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const state = map(seed);
      const a = neighbourhoodCapacity(state, ownedBy(state, 0)[0]!.id, 2);
      const b = neighbourhoodCapacity(state, ownedBy(state, 1)[0]!.id, 2);

      expect(Math.min(a, b) / Math.max(a, b)).toBeGreaterThan(0.7);
    }
  });

  test('gives each player a start with more than one way out', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = map(seed);
      for (const player of [0, 1]) {
        const start = ownedBy(state, player)[0]!;
        expect(
          state.adjacency[start.id]!.length,
          `seed ${seed}, player ${player} starts in a dead end`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test('gives each player a neighbour they can take with their starting points', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = map(seed);
      for (const player of [0, 1]) {
        const start = ownedBy(state, player)[0]!;
        const affordable = state.adjacency[start.id]!.some(
          (id) => state.nodes[id]!.points < START_POINTS,
        );
        expect(affordable, `seed ${seed}, player ${player} is walled in at the start`).toBe(
          true,
        );
      }
    }
  });

  test('neutral nodes are garrisoned in proportion to their capacity', () => {
    const state = map(16);

    for (const node of state.nodes) {
      if (node.owner !== NEUTRAL) continue;
      expect(node.points).toBeGreaterThan(0);
      expect(node.points).toBeLessThan(node.capacity);
    }
  });

  test('bigger nodes hold more points', () => {
    const state = map(17);
    const sorted = [...state.nodes].sort((x, y) => x.radius - y.radius);

    expect(sorted[0]!.capacity).toBeLessThan(sorted[sorted.length - 1]!.capacity);
  });

  test('keeps every node inside the map bounds', () => {
    for (const node of map(18).nodes) {
      expect(node.x).toBeGreaterThanOrEqual(node.radius);
      expect(node.x).toBeLessThanOrEqual(CONFIG.width - node.radius);
      expect(node.y).toBeGreaterThanOrEqual(node.radius);
      expect(node.y).toBeLessThanOrEqual(CONFIG.height - node.radius);
    }
  });

  test('starts the match with no squads and no winner', () => {
    const state = map(19);

    expect(state.squads).toHaveLength(0);
    expect(state.winner).toBeNull();
    expect(state.time).toBe(0);
  });
});

describe('neighbourhoodCapacity', () => {
  test('counts only what is reachable within the hop limit', () => {
    const state = map(20);
    const start = ownedBy(state, 0)[0]!.id;

    expect(neighbourhoodCapacity(state, start, 1)).toBeLessThanOrEqual(
      neighbourhoodCapacity(state, start, 3),
    );
  });
});

describe('more than two players', () => {
  function multi(seed: number, playerCount: number) {
    return generateMap({ ...CONFIG, seed, playerCount });
  }

  test('gives every player exactly one starting node', () => {
    for (const playerCount of [2, 3, 4]) {
      const state = multi(31, playerCount);

      for (let player = 0; player < playerCount; player++) {
        expect(
          state.nodes.filter((n) => n.owner === player),
          `player ${player} of ${playerCount}`,
        ).toHaveLength(1);
      }
      expect(state.nodes.filter((n) => n.owner === NEUTRAL)).toHaveLength(
        state.nodes.length - playerCount,
      );
    }
  });

  test('keeps every pair of players apart, not just the first two', () => {
    const state = multi(32, 4);
    const starts = [0, 1, 2, 3].map((p) => state.nodes.find((n) => n.owner === p)!);
    const diagonal = Math.hypot(CONFIG.width, CONFIG.height);

    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        const a = starts[i]!;
        const b = starts[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(diagonal * 0.15);
      }
    }
  });

  test('every player gets a viable opening, not only the first two', () => {
    for (let seed = 40; seed < 50; seed++) {
      const state = multi(seed, 4);
      for (let player = 0; player < 4; player++) {
        const start = state.nodes.find((n) => n.owner === player)!;
        expect(state.adjacency[start.id]!.length).toBeGreaterThanOrEqual(2);
        expect(
          state.adjacency[start.id]!.some((id) => state.nodes[id]!.points < START_POINTS),
          `seed ${seed}: player ${player} is walled in`,
        ).toBe(true);
      }
    }
  });

  test('every seat has a colour of its own', () => {
    const colours = Array.from({ length: MAX_PLAYERS }, (_, p) => factionOf(p).glow);

    expect(new Set(colours).size).toBe(MAX_PLAYERS);
  });
});

describe('map difficulty', () => {
  test('a harder map garrisons its neutral nodes more heavily', () => {
    const gentle = generateMap({ ...CONFIG, seed: 60, neutralGarrison: 0.2 });
    const harsh = generateMap({ ...CONFIG, seed: 60, neutralGarrison: 0.55 });

    const total = (state: GameState) =>
      state.nodes.filter((n) => n.owner === NEUTRAL).reduce((sum, n) => sum + n.points, 0);

    expect(total(harsh)).toBeGreaterThan(total(gentle));
  });

  test('a neutral node never starts beyond what it can hold', () => {
    const state = generateMap({ ...CONFIG, seed: 61, neutralGarrison: 0.55 });

    for (const node of state.nodes) {
      if (node.owner !== NEUTRAL) continue;
      expect(node.points).toBeLessThanOrEqual(node.capacity);
    }
  });
});

describe('map size', () => {
  test('a bigger board holds more of everything', () => {
    const small = generateMap({ ...CONFIG, seed: 70, width: 1150, height: 760 });
    const large = generateMap({ ...CONFIG, seed: 70, width: 2150, height: 1340 });

    expect(small.nodes.length).toBeLessThan(large.nodes.length);
    expect(new Set(small.islands).size).toBeLessThan(new Set(large.islands).size);
  });

  test('a spacing too wide for islands still produces a board', () => {
    // Rather than failing, generation packs the nodes closer and tries again.
    const state = generateMap({ ...CONFIG, seed: 71, minDistance: 320 });

    expect(state.nodes.length).toBeGreaterThan(8);
    expect(new Set(state.islands).size).toBeGreaterThan(1);
  });
});

describe('node kinds', () => {
  function kindsOn(seed: number) {
    return generateMap({ ...CONFIG, seed }).nodes.map((n) => n.kind);
  }

  test('a board carries both fortresses and farms', () => {
    for (const seed of [80, 81, 82]) {
      const kinds = kindsOn(seed);

      expect(kinds, `seed ${seed}`).toContain('fortress');
      expect(kinds, `seed ${seed}`).toContain('farm');
    }
  });

  test('plain ground is still the most common kind', () => {
    const kinds = kindsOn(83);
    const count = (kind: string) => kinds.filter((value) => value === kind).length;

    expect(count('base')).toBeGreaterThan(count('fortress'));
    expect(count('base')).toBeGreaterThan(count('farm'));
  });

  test('both players open on a plain node, so neither starts with terrain', () => {
    for (let seed = 90; seed < 100; seed++) {
      const state = generateMap({ ...CONFIG, seed });

      for (const player of [0, 1]) {
        expect(state.nodes.find((n) => n.owner === player)!.kind, `seed ${seed}`).toBe('base');
      }
    }
  });

  test('a kind can land on a node of any size', () => {
    const radii = new Set<number>();
    for (let seed = 100; seed < 115; seed++) {
      for (const node of generateMap({ ...CONFIG, seed }).nodes) {
        if (node.kind === 'fortress') radii.add(node.radius);
      }
    }

    expect(radii.size).toBeGreaterThan(1);
  });
});

describe('starting levels', () => {
  test('capacity and radius always match the level', () => {
    for (const node of map(200).nodes) {
      expect(node.capacity, `node ${node.id}`).toBe(capacityForLevel(node.level));
      expect(node.radius, `node ${node.id}`).toBe(radiusForLevel(node.level));
    }
  });

  test('a fresh board has nothing built up yet', () => {
    const levels = new Set(map(201).nodes.map((n) => n.level));

    expect(Math.min(...levels)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...levels)).toBeLessThanOrEqual(3);
  });

  test('a board still offers a mix of sizes', () => {
    expect(new Set(map(202).nodes.map((n) => n.level)).size).toBeGreaterThan(1);
  });

  test('both players open on the same level', () => {
    const state = map(203);
    const [first] = ownedBy(state, 0);
    const [second] = ownedBy(state, 1);

    expect(first!.level).toBe(second!.level);
  });

  test('a node upgraded to the top still fits inside the board', () => {
    const state = map(204);
    const room = radiusForLevel(MAX_LEVEL);

    for (const node of state.nodes) {
      expect(node.x, `node ${node.id}`).toBeGreaterThanOrEqual(room);
      expect(node.x).toBeLessThanOrEqual(CONFIG.width - room);
      expect(node.y).toBeGreaterThanOrEqual(room);
      expect(node.y).toBeLessThanOrEqual(CONFIG.height - room);
    }
  });
});

describe('islands', () => {
  function island(seed: number) {
    return generateMap({ ...CONFIG, seed });
  }

  /** Islands proper; a bridge belongs to none of them. */
  function islandsOn(state: GameState) {
    const seen = new Set(state.islands);
    seen.delete(BRIDGE);
    return seen;
  }

  test('the board is divided into islands of roughly the size asked for', () => {
    const state = island(300);
    const count = islandsOn(state).size;

    expect(count).toBeGreaterThan(1);
    expect(state.nodes.length / count).toBeGreaterThan(4);
    expect(state.nodes.length / count).toBeLessThan(18);
  });

  test('every node belongs to an island', () => {
    const state = island(301);

    expect(state.islands).toHaveLength(state.nodes.length);
  });

  test('the only way between islands is over a bridge, and every bridge is a fortress', () => {
    for (let seed = 302; seed < 310; seed++) {
      const state = island(seed);

      for (const edge of state.edges) {
        const from = state.islands[edge.a]!;
        const to = state.islands[edge.b]!;
        if (from === to) continue;

        const bridge = from === BRIDGE ? edge.a : edge.b;
        expect(from === BRIDGE || to === BRIDGE, `seed ${seed}: islands touch`).toBe(true);
        expect(state.nodes[bridge]!.kind, `seed ${seed}, bridge ${bridge}`).toBe('fortress');
      }
    }
  });

  test('no island is a dead end', () => {
    for (let seed = 310; seed < 318; seed++) {
      const state = island(seed);
      const ways = new Map<number, number>();

      for (const edge of state.edges) {
        const from = state.islands[edge.a]!;
        const to = state.islands[edge.b]!;
        if (from === to) continue;
        const shore = from === BRIDGE ? to : from;
        ways.set(shore, (ways.get(shore) ?? 0) + 1);
      }

      for (const which of islandsOn(state)) {
        expect(ways.get(which) ?? 0, `seed ${seed}, island ${which}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test('every island has at least one farm to be worth taking', () => {
    for (let seed = 320; seed < 328; seed++) {
      const state = island(seed);

      for (const which of islandsOn(state)) {
        const farms = state.nodes.filter(
          (n) => state.islands[n.id] === which && n.kind === 'farm',
        );
        expect(farms.length, `seed ${seed}, island ${which}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('a farm stands on an island, never on a bridge', () => {
    const state = island(329);

    for (const node of state.nodes) {
      if (node.kind !== 'farm') continue;
      expect(state.islands[node.id], `node ${node.id}`).not.toBe(BRIDGE);
    }
  });

  test('an island is mostly its own ground, not crossings', () => {
    const state = island(331);
    const bridges = state.islands.filter((island) => island === BRIDGE).length;

    expect(bridges / state.nodes.length).toBeLessThan(0.3);
  });

  test('players start inside islands, not on the gates, and not together', () => {
    for (let seed = 330; seed < 340; seed++) {
      const state = island(seed);
      const starts = [0, 1].map((player) => state.nodes.find((n) => n.owner === player)!);

      for (const start of starts) {
        expect(start.kind, `seed ${seed}`).toBe('base');
      }
      expect(state.islands[starts[0]!.id], `seed ${seed}`).not.toBe(
        state.islands[starts[1]!.id],
      );
    }
  });
});

describe('what the generator deals and what the player builds', () => {
  test('no buildable kind is ever dealt: the map lays out terrain only', () => {
    const buildable = Object.keys(CONVERSIONS);
    expect(buildable.length).toBeGreaterThan(0);

    for (let seed = 500; seed < 510; seed++) {
      for (const node of map(seed).nodes) {
        expect(buildable, `seed ${seed}`).not.toContain(node.kind);
      }
    }
  });

  test('nothing on a fresh board is wired to anything', () => {
    for (const wires of map(501).wires) {
      expect(wires).toEqual([]);
    }
  });
});
