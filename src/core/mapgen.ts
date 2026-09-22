import type { GraphEdge } from './graph';
import { BRIDGE, buildIslandLayout, scatterIslands } from './islands';
import { MAX_LEVEL, applyLevel, capacityForLevel, radiusForLevel } from './levels';
import type { Point } from './poisson';
import { createRng, type Rng } from './rng';
import { NEUTRAL, type Edge, type GameNode, type GameState, type NodeKind } from './state';

/** Points both players open with, identical so neither starts ahead. */
export const START_POINTS = 25;

/**
 * How often each starting level turns up. A fresh board offers levels one to
 * three; four and five are only reached by building up during the match.
 */
const START_LEVEL_WEIGHTS = [
  { level: 1, weight: 5 },
  { level: 2, weight: 3 },
  { level: 3, weight: 2 },
] as const;

/** Level both players open on, so the opening is symmetric. */
const START_LEVEL = 2;

/**
 * The widest a node can ever get. Margins are cut for a fully upgraded node,
 * not for the size it starts at, or a node built up near the edge of the map
 * would hang off it.
 */
const LARGEST_RADIUS = radiusForLevel(MAX_LEVEL);

/** One farm per this many interior nodes, so every island earns something. */
/**
 * Share of an island's Delaunay edges the board keeps.
 *
 * The single number that decides whether a board is a network or a string of
 * beads, and it was 0.5. Measured on a medium board at 0.5: the average island
 * node had 2.3 neighbours, eleven nodes in sixty-nine were dead ends, and the
 * whole board held ten loops — a tree with a few edges left over, where every
 * front is one node wide and nothing can be gone round.
 *
 * At 0.7 the same boards have 2.9 neighbours a node, three or four dead ends
 * and twenty-seven loops, and bot-against-bot matches settle in 4.3 minutes
 * rather than 6.4: fronts can be broken instead of leaned on. Higher still
 * flattens out — 0.8 buys more edges and gives the time back.
 */
export const DEFAULT_KEEP_RATIO = 0.7;

const NODES_PER_FARM = 5;
const MAX_FARMS_PER_ISLAND = 3;

/** Default share of its capacity an unclaimed node defends with. */
export const DEFAULT_NEUTRAL_GARRISON = 0.35;

/** Below this the retry gives up rather than packing nodes on top of nodes. */
const MIN_WORKABLE_DISTANCE = 60;

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
  keepRatio?: number;
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

  if (best) return best.state;

  // A board can be too sparse for islands to fit with water between them —
  // a wide spacing on a small map leaves no room. Rather than fail, pack the
  // nodes closer and try again; a crowded map beats no map.
  if (config.minDistance > MIN_WORKABLE_DISTANCE) {
    return generateMap({ ...config, minDistance: config.minDistance * 0.8 });
  }

  throw new Error('map generation produced no usable layout');
}

function drawMap(config: MapConfig, rng: Rng, crowding = 1): GameState | null {
  const playerCount = config.playerCount ?? 2;
  const margin = LARGEST_RADIUS + 4;
  const { points, islands } = scatterIslands(
    config.width - margin * 2,
    config.height - margin * 2,
    config.minDistance,
    rng,
  );
  const placed = points.map((point) => ({ x: point.x + margin, y: point.y + margin }));

  if (placed.length < 12) return null;

  const layout = buildIslandLayout(
    placed,
    islands,
    rng,
    config.keepRatio ?? DEFAULT_KEEP_RATIO,
    config.minDistance,
  );

  const garrison = config.neutralGarrison ?? DEFAULT_NEUTRAL_GARRISON;
  const nodes = layout.points.map((point, id) => makeNode(id, point, rng, garrison));
  const state = assemble(nodes, layout.points, layout.edges, layout.islands);
  placeKinds(state, layout.bridges, rng);

  const starts = pickStarts(state, config, playerCount, crowding);
  if (!starts) return null;

  for (const [player, nodeId] of starts.entries()) {
    const node = state.nodes[nodeId]!;
    node.owner = player;
    // Openings are identical by construction: same size, same points, no
    // terrain bonus for whoever happened to be seated on a farm.
    applyLevel(node, START_LEVEL);
    node.kind = 'base';
    node.points = START_POINTS;
  }

  placeCore(state, config);

  return state;
}

/** How much more than plain ground the core defends itself with. */
const CORE_GARRISON = 2;

/**
 * Puts the core where everyone has to come to it.
 *
 * The middle of the board, because a prize in a corner belongs to whoever
 * started nearest it, and this one is meant to be the reason two players meet
 * before minute ten. Placed after the openings are dealt so it can never land
 * under somebody's first node — and never on a bridge, which is a crossing
 * rather than a destination.
 */
function placeCore(state: GameState, config: MapConfig): void {
  const centre = { x: config.width / 2, y: config.height / 2 };

  let chosen: GameNode | null = null;
  let best = Infinity;

  for (const node of state.nodes) {
    if (node.owner !== NEUTRAL || node.kind !== 'base') continue;
    if (state.islands[node.id] === BRIDGE) continue;

    const away = Math.hypot(node.x - centre.x, node.y - centre.y);
    if (away >= best) continue;
    best = away;
    chosen = node;
  }

  if (!chosen) return;
  chosen.kind = 'core';
  chosen.points = Math.min(chosen.capacity, Math.round(chosen.points * CORE_GARRISON));
}

function makeNode(id: number, point: Point, rng: Rng, garrison: number): GameNode {
  const level = weightedStartLevel(rng);
  const capacity = capacityForLevel(level);
  return {
    id,
    x: point.x,
    y: point.y,
    level,
    radius: radiusForLevel(level),
    capacity,
    kind: 'base',
    owner: NEUTRAL,
    points: Math.min(capacity, Math.max(1, Math.round(capacity * garrison))),
  };
}

function weightedStartLevel(rng: Rng): number {
  const total = START_LEVEL_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.float(0, total);
  for (const entry of START_LEVEL_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.level;
  }
  return 1;
}

/**
 * Puts the terrain where the shape of the board says it belongs.
 *
 * Every bridge is a fortress: the crossing between two islands should be a
 * place you have to take, not a place you walk through. Farms and batteries go
 * inside islands, so an island is worth holding and not merely worth passing —
 * a farm for what it earns you, a battery for what it costs whoever is on the
 * other side of it.
 */
function placeKinds(state: GameState, bridges: readonly number[], rng: Rng): void {
  for (const id of bridges) state.nodes[id]!.kind = 'fortress';

  for (const island of new Set(state.islands)) {
    if (island === BRIDGE) continue;

    const interior = state.nodes.filter((node) => state.islands[node.id] === island);
    if (interior.length === 0) continue;

    scatter(interior, 'farm', MAX_FARMS_PER_ISLAND, NODES_PER_FARM, rng);
  }
}

/**
 * Turns a share of an island's plain nodes into one kind.
 *
 * Shared by every kind that is sprinkled rather than placed: how many an
 * island gets follows its size, so a big island is worth more than a small one
 * for a reason beyond its node count.
 */
function scatter(
  interior: readonly GameNode[],
  kind: NodeKind,
  most: number,
  nodesEach: number,
  rng: Rng,
): void {
  const wanted = Math.min(most, Math.max(1, Math.round(interior.length / nodesEach)));

  for (let placed = 0; placed < wanted; placed++) {
    const choices = interior.filter((node) => node.kind === 'base');
    if (choices.length === 0) return;
    choices[rng.range(0, choices.length - 1)]!.kind = kind;
  }
}

function assemble(
  nodes: GameNode[],
  points: Point[],
  graphEdges: GraphEdge[],
  islands: number[],
): GameState {
  const adjacency: number[][] = nodes.map(() => []);
  const edges: Edge[] = graphEdges.map(({ a, b }) => {
    adjacency[a]!.push(b);
    adjacency[b]!.push(a);
    const pa = points[a]!;
    const pb = points[b]!;
    return { a, b, length: Math.hypot(pb.x - pa.x, pb.y - pa.y) };
  });

  return {
    nodes,
    edges,
    adjacency,
    islands,
    wires: nodes.map(() => []),
    squads: [],
    time: 0,
    winner: null,
    nextSquadId: 1,
  };
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

    const taken = new Set(chosen.map((id) => state.islands[id]));
    for (const id of viable) {
      if (chosen.includes(id)) continue;
      // One seat per island while there are islands to spare: players should
      // not open the match already sharing a neighbourhood.
      if (taken.has(state.islands[id]) && taken.size < islandCount(state)) continue;
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

/** Islands proper; bridges belong to none of them. */
function islandCount(state: GameState): number {
  const seen = new Set(state.islands);
  seen.delete(BRIDGE);
  return seen.size;
}

function furthestPair(state: GameState, candidates: readonly number[]): number[] | null {
  let bestPair: number[] | null = null;
  let bestDistance = -1;

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (state.islands[candidates[i]!] === state.islands[candidates[j]!]) continue;
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
  // Never on a gateway: an opening should be a home, not a doorway somebody
  // else is about to come through.
  if (state.nodes[nodeId]?.kind !== 'base') return false;

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
