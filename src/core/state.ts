/** Owner of a node: a player index, or NEUTRAL for unclaimed nodes. */
export type OwnerId = number;

/** Nobody owns this node; it never grows and defends with its starting points. */
export const NEUTRAL: OwnerId = -1;

/** The person playing. Always the first seat, in every match. */
export const HUMAN: OwnerId = 0;

/**
 * What a node is, beyond its size.
 *
 * - `base` — an ordinary node.
 * - `fortress` — halves incoming hostile force, so taking it costs double.
 * - `farm` — grows twice as fast, but holds no more.
 * - `core` — earns for every node its holder owns.
 * - `balancer` — earns nothing and keeps nothing; shares out what reaches it.
 *
 * Terrain, not allegiance: a kind works the same for whoever holds the node.
 * The first four are dealt by the map generator; a balancer is built, which
 * is what `CONVERSIONS` in `convert.ts` is for.
 */
export type NodeKind = 'base' | 'fortress' | 'farm' | 'core' | 'balancer';

/**
 * How a balancer splits what reaches it.
 *
 * - `round` — the whole parcel to the next output in the list, in turn.
 * - `adaptive` — split between all of them at once, weighted so the ones
 *   behind catch up with the fullest, and what is left over shared evenly.
 * - `broadcast` — split evenly between all of them, whatever they hold.
 *
 * The names are the load balancer's own: that is what the node is.
 */
export type ShareMode = 'round' | 'adaptive' | 'broadcast';

export interface GameNode {
  id: number;
  /** Position in world units; the map is laid out once at generation time. */
  x: number;
  y: number;
  /** Drawn radius. Capacity is derived from it, so size is honest to the eye. */
  radius: number;
  /**
   * How far the node has been built up, 1..MAX_LEVEL. Capacity and radius are
   * derived from it; use applyLevel to change any of the three.
   */
  level: number;
  /** Points the node grows to on its own. Reinforcements may exceed it. */
  capacity: number;
  kind: NodeKind;
  owner: OwnerId;
  points: number;
  /** Balancers only: how this one picks the next output. */
  share?: ShareMode;
  /** Balancers only: where round-robin left off. */
  cursor?: number;
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
  /**
   * islands[nodeId] is the region of the board a node belongs to. Islands meet
   * only through gateway nodes, which is where the fortresses are.
   */
  islands: number[];
  /**
   * wires[nodeId] lists the neighbours that node automatically feeds, and is
   * empty for most of the board.
   *
   * An ordinary node is allowed one, so laying a second replaces the first;
   * a balancer is allowed one per neighbour, which is the whole point of it.
   * Always an array, never a hole: JSON has no holes, and a list that is
   * sometimes missing is a second case to revive and to test.
   */
  wires: number[][];
  /**
   * How full a node must be before its wire fires, and how much of what it
   * holds then goes. Chosen when the match is started; absent in a match
   * saved before they were choices at all, which reads as the old rule.
   */
  wireFill?: number;
  wireShare?: number;
  /**
   * How fast every node earns, against the ordinary rate. 1 in any real
   * match; the tutorial winds it up so its lesson can be watched rather than
   * waited out.
   */
  growth?: number;
  squads: Squad[];
  /** Seconds of simulated time since the match began. */
  time: number;
  winner: OwnerId | null;
  nextSquadId: number;
}
