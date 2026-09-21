import { NEUTRAL, type GameNode, type GameState } from './state';

/** Test-only builders. Nothing in the running game imports this module. */

export function makeNode(id: number, overrides: Partial<GameNode> = {}): GameNode {
  return {
    id,
    x: id * 100,
    y: 0,
    level: 2,
    radius: 20,
    capacity: 50,
    kind: 'base',
    owner: NEUTRAL,
    points: 10,
    ...overrides,
  };
}

/**
 * Builds a state from a node list and an edge list, deriving edge lengths and
 * adjacency so tests only state what they care about.
 */
export function makeState(nodes: GameNode[], edgePairs: [number, number][]): GameState {
  const adjacency: number[][] = nodes.map(() => []);
  const edges = edgePairs.map(([a, b]) => {
    const na = nodes[a];
    const nb = nodes[b];
    if (!na || !nb) throw new Error(`edge references a missing node: ${a}-${b}`);
    adjacency[a]!.push(b);
    adjacency[b]!.push(a);
    return { a, b, length: Math.hypot(nb.x - na.x, nb.y - na.y) };
  });

  return {
    nodes,
    edges,
    adjacency,
    islands: nodes.map(() => 0),
    wires: nodes.map(() => undefined),
    squads: [],
    time: 0,
    winner: null,
    nextSquadId: 1,
  };
}
