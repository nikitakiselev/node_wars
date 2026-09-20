import { buildGraph, type GraphEdge } from './graph';
import { poissonDiskSample, type Point } from './poisson';
import { createRng, type Rng } from './rng';
import { NEUTRAL, type Edge, type GameNode, type GameState, type NodeKind } from './state';

/** Points both players open with, identical so neither starts ahead. */
export const START_POINTS = 25;

/** Size tiers. Radius is what the player sees; capacity is what it means. */
const SIZE_TIERS = [
  { radius: 16, capacity: 25, weight: 5 },
  { radius: 23, capacity: 50, weight: 3 },
  { radius: 31, capacity: 90, weight: 2 },
] as const;

/** Widest node on the map; the layout keeps this much clear of the edges. */
const LARGEST_RADIUS = Math.max(...SIZE_TIERS.map((tier) => tier.radius));

/**
 * How often each kind turns up. Rolled independently of size, so a small
 * fortress and a sprawling farm are both ordinary sights.
 */
const KIND_WEIGHTS: { kind: NodeKind; weight: number }[] = [
  { kind: 'base', weight: 70 },
  { kind: 'fortress', weight: 15 },
  { kind: 'farm', weight: 15 },
];

/** Tier both starting nodes are forced to, so the opening is symmetric. */
const START_TIER = SIZE_TIERS[1];

/** Default share of its capacity an unclaimed node defends with. */
export const DEFAULT_NEUTRAL_GARRISON = 0.35;

/** Rejection sampling: how many maps to try before taking the fairest one. */
const BALANCE_ATTEMPTS = 40;
/** Weaker side must hold at least this share of the stronger side's opening. */
const MIN_BALANCE = 0.75;
/** Two starts must be at least this share of the map diagonal apart. More
 * players share the same board, so the requirement eases as seats fill. */
const MIN_START_SEPARATION = 0.55;

export interface MapConfig {
  width: number;
  height: number;
  seed: number;
  /** Closest two nodes may sit; this is what sets the size of the board. */
  minDistance: number;
  keepRatio: number;
  /** Seats at the table, the human included. Defaults to two. */
  playerCount?: number;
  /** Share of its capacity an unclaimed node defends with. */
  neutralGarrison?: number;
}

/**
 * Generates a match: a planar graph of nodes with one starting node per player.
 *
 * Random maps are often lopsided, so this draws several and keeps the first
 * that passes the fairness checks — the players start far apart and with
 * comparable room to expand. If none pass, the fairest draw wins rather than
 * failing outright.
 */
export function generateMap(config: MapConfig): GameState {
  let best: { state: GameState; balance: number } | null = null;

  for (let attempt = 0; attempt < BALANCE_ATTEMPTS; attempt++) {
    // Later attempts accept starts that sit closer together: six players on a
    // small board simply cannot all be a half-diagonal apart, and no map at
    // all is worse than a snug one.
    const crowding = 1 - Math.min(0.55, (attempt / BALANCE_ATTEMPTS) * 0.8);
    const state = drawMap(config, createRng(config.seed + attempt * 7919), crowding);
    if (!state) continue;

    const balance = startingBalance(state, config.playerCount ?? 2);
    if (balance >= MIN_BALANCE) return state;
    if (!best || balance > best.balance) best = { state, balance };
  }

  if (!best) throw new Error('map generation produced no usable layout');
  return best.state;
}

function drawMap(config: MapConfig, rng: Rng, crowding = 1): GameState | null {
  const playerCount = config.playerCount ?? 2;
  const margin = LARGEST_RADIUS + 4;
  const points = poissonDiskSample(
    config.width - margin * 2,
    config.height - margin * 2,
    config.minDistance,
    rng,
  ).map((p) => ({ x: p.x + margin, y: p.y + margin }));

  if (points.length < 12) return null;

  const graphEdges = buildGraph(points, rng, config.keepRatio);
  const garrison = config.neutralGarrison ?? DEFAULT_NEUTRAL_GARRISON;
  const nodes = points.map((point, id) => makeNode(id, point, rng, garrison));
  const state = assemble(nodes, points, graphEdges);

  const starts = pickStarts(state, config, playerCount, crowding);
  if (!starts) return null;

  for (const [player, nodeId] of starts.entries()) {
    const node = state.nodes[nodeId]!;
    node.owner = player;
    // Openings are identical by construction: same size, same points, no
    // terrain bonus for whoever happened to be seated on a farm.
    node.radius = START_TIER.radius;
    node.capacity = START_TIER.capacity;
    node.kind = 'base';
    node.points = START_POINTS;
  }

  return state;
}

function makeNode(id: number, point: Point, rng: Rng, garrison: number): GameNode {
  const tier = weightedTier(rng);
  return {
    id,
    x: point.x,
    y: point.y,
    radius: tier.radius,
    capacity: tier.capacity,
    kind: weightedKind(rng),
    owner: NEUTRAL,
    points: Math.min(tier.capacity, Math.max(1, Math.round(tier.capacity * garrison))),
  };
}

function weightedTier(rng: Rng) {
  const total = SIZE_TIERS.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = rng.float(0, total);
  for (const tier of SIZE_TIERS) {
    roll -= tier.weight;
    if (roll <= 0) return tier;
  }
  return SIZE_TIERS[0];
}

function weightedKind(rng: Rng): NodeKind {
  const total = KIND_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.float(0, total);
  for (const entry of KIND_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.kind;
  }
  return 'base';
}

function assemble(nodes: GameNode[], points: Point[], graphEdges: GraphEdge[]): GameState {
  const adjacency: number[][] = nodes.map(() => []);
  const edges: Edge[] = graphEdges.map(({ a, b }) => {
    adjacency[a]!.push(b);
    adjacency[b]!.push(a);
    const pa = points[a]!;
    const pb = points[b]!;
    return { a, b, length: Math.hypot(pb.x - pa.x, pb.y - pa.y) };
  });

  return { nodes, edges, adjacency, squads: [], time: 0, winner: null, nextSquadId: 1 };
}

/**
 * Places one start per player, as far from each other as the board allows.
 *
 * The furthest pair on a Delaunay mesh is almost always a pair of corner
 * dead ends, which makes for a slow, lopsided opening and can wall a player in
 * behind a garrison they cannot afford. So a start has to earn it: more than
 * one way out, and at least one neighbour it can take on turn one. Beyond two
 * players the seats are filled greedily, each one taken as far as possible
 * from those already placed.
 */
function pickStarts(
  state: GameState,
  config: MapConfig,
  playerCount: number,
  crowding: number,
): number[] | null {
  const diagonal = Math.hypot(config.width, config.height);
  const viable = state.nodes.filter((node) => isViableStart(state, node.id)).map((n) => n.id);
  if (viable.length < playerCount) return null;

  const chosen = furthestPair(state, viable);
  if (!chosen) return null;

  while (chosen.length < playerCount) {
    let bestId: number | null = null;
    let bestDistance = -1;

    for (const id of viable) {
      if (chosen.includes(id)) continue;
      const nearest = Math.min(...chosen.map((other) => distanceBetween(state, id, other)));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        bestId = id;
      }
    }

    if (bestId === null) return null;
    chosen.push(bestId);
  }

  // A crowded board cannot give four players the room it gives two.
  const required = diagonal * MIN_START_SEPARATION * Math.sqrt(2 / playerCount) * crowding;
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      if (distanceBetween(state, chosen[i]!, chosen[j]!) < required) return null;
    }
  }

  return chosen;
}

function furthestPair(state: GameState, candidates: readonly number[]): number[] | null {
  let bestPair: number[] | null = null;
  let bestDistance = -1;

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const distance = distanceBetween(state, candidates[i]!, candidates[j]!);
      if (distance > bestDistance) {
        bestDistance = distance;
        bestPair = [candidates[i]!, candidates[j]!];
      }
    }
  }

  return bestPair;
}

function distanceBetween(state: GameState, a: number, b: number): number {
  const first = state.nodes[a]!;
  const second = state.nodes[b]!;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function isViableStart(state: GameState, nodeId: number): boolean {
  const neighbours = state.adjacency[nodeId] ?? [];
  if (neighbours.length < 2) return false;
  return neighbours.some((id) => (state.nodes[id]?.points ?? Infinity) < START_POINTS);
}

/** The worst-off player's opening measured against the best-off one's. */
function startingBalance(state: GameState, playerCount: number): number {
  const room: number[] = [];
  for (let player = 0; player < playerCount; player++) {
    const start = state.nodes.find((n) => n.owner === player);
    if (!start) return 0;
    room.push(neighbourhoodCapacity(state, start.id, 2));
  }

  return Math.min(...room) / Math.max(...room);
}

/**
 * Total capacity a player can reach within `hops` edges — a cheap proxy for
 * how much a starting position is worth.
 */
export function neighbourhoodCapacity(state: GameState, startId: number, hops: number): number {
  const seen = new Set<number>([startId]);
  let frontier = [startId];

  for (let hop = 0; hop < hops; hop++) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const neighbour of state.adjacency[id] ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }

  let total = 0;
  for (const id of seen) total += state.nodes[id]?.capacity ?? 0;
  return total;
}
