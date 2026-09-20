/** Owner of a node: a player index, or NEUTRAL for unclaimed nodes. */
export type OwnerId = number;

/** Nobody owns this node; it never grows and defends with its starting points. */
export const NEUTRAL: OwnerId = -1;

/**
 * What a node is, beyond its size.
 *
 * - `base` — an ordinary node.
 * - `fortress` — halves incoming hostile force, so taking it costs double.
 * - `farm` — grows twice as fast, but holds no more.
 *
 * Terrain, not allegiance: a kind works the same for whoever holds the node.
 */
export type NodeKind = 'base' | 'fortress' | 'farm';

export interface GameNode {
  id: number;
  /** Position in world units; the map is laid out once at generation time. */
  x: number;
  y: number;
  /** Drawn radius. Capacity is derived from it, so size is honest to the eye. */
  radius: number;
  /** Points the node grows to on its own. Reinforcements may exceed it. */
  capacity: number;
  kind: NodeKind;
  owner: OwnerId;
  points: number;
}

export interface Edge {
  a: number;
  b: number;
  length: number;
}

/** Points in flight along an edge. Rendered as a particle stream. */
export interface Squad {
  id: number;
  owner: OwnerId;
  from: number;
  to: number;
  amount: number;
  /** 0 at the source node, 1 on arrival. */
  progress: number;
  /** Progress gained per second, derived from edge length. */
  speed: number;
}

export interface GameState {
  nodes: GameNode[];
  edges: Edge[];
  /** adjacency[nodeId] lists the ids reachable in one hop. */
  adjacency: number[][];
  squads: Squad[];
  /** Seconds of simulated time since the match began. */
  time: number;
  winner: OwnerId | null;
  nextSquadId: number;
}
