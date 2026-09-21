import { delaunayEdges, isConnected, type GraphEdge } from './graph';
import { poissonDiskSample, type Point } from './poisson';
import type { Rng } from './rng';

/** Island of a node that is a bridge rather than part of any island. */
export const BRIDGE = -1;

export interface IslandLayout {
  /** Island nodes first, then one node per bridge. */
  points: Point[];
  /** islands[i] is the island of point i, or BRIDGE. */
  islands: number[];
  edges: GraphEdge[];
  /** Node ids of the bridges. */
  bridges: number[];
}

export interface Scatter {
  points: Point[];
  /** islands[i] is the island point i belongs to, numbered from zero. */
  islands: number[];
}

/**
 * Crossings an island wants.
 *
 * Two is enough to stop it being a dead end, but measured over ten
 * bot-versus-bot matches two left both sides grinding on a single chokepoint.
 * Three took matches settled from 3 in 10 up to 7 in 10, because a defender
 * can no longer put everything in one doorway.
 *
 * A small island cannot carry three without becoming all coast and no
 * interior, so it settles for two.
 */
const WAYS_OUT = 3;
const MIN_WAYS_OUT = 2;
/** Nodes an island needs per crossing before it can afford another. */
const NODES_PER_WAY_OUT = 3;

/** Nodes an island aims for: a territory, not a stepping stone. */
const ISLAND_TARGET = 8;
/**
 * Water between two islands, in multiples of the gap between nodes.
 *
 * Wide enough that a bridge standing halfway across still sits a full step
 * from either shore: at 1.3 the bridges were half a step out and their walls
 * overlapped the nodes they joined. The water also has to be wider than a step
 * in the tight direction, or the islands read as one long band.
 */
const WATER = 2.4;
/** Fewer nodes than this and a clump is not an island worth crossing to. */
const MIN_ISLAND_POINTS = 4;

/**
 * Lays the board out as separate clumps of nodes with open water between them.
 *
 * Scattering points evenly and then partitioning them afterwards gives islands
 * you can only find in the edge list. Growing each one around its own centre
 * gives islands you can see, which is the point: a player should be able to
 * look at the board and know where the borders are.
 *
 * Centres sit on a jittered grid rather than being scattered at a distance,
 * because a board this size only has room for a couple of islands if their
 * spacing is left to chance.
 */
export function scatterIslands(
  width: number,
  height: number,
  minDistance: number,
  rng: Rng,
): Scatter {
  const { columns, rows } = gridFor(width, height, minDistance);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  // Cut from the tighter direction so there is open water on every side, not
  // just the roomy one.
  const water = minDistance * WATER;
  const radius = Math.max(minDistance, (Math.min(cellWidth, cellHeight) - water) / 2);
  // Jitter, but never enough for two islands to drift into contact: the water
  // between them is the whole point of laying the board out this way.
  const wobble = Math.max(0, Math.min(cellWidth, cellHeight) * 0.5 - radius - water * 0.5);

  const points: Point[] = [];
  const islands: number[] = [];
  let island = 0;

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const centre = {
        x: (column + 0.5) * cellWidth + rng.float(-wobble, wobble),
        y: (row + 0.5) * cellHeight + rng.float(-wobble, wobble),
      };

      const local = poissonDiskSample(radius * 2, radius * 2, minDistance, rng)
        .map((point) => ({ x: point.x - radius, y: point.y - radius }))
        .filter((point) => Math.hypot(point.x, point.y) <= radius);

      if (local.length < MIN_ISLAND_POINTS) continue;

      for (const point of local) {
        points.push({ x: centre.x + point.x, y: centre.y + point.y });
        islands.push(island);
      }
      island++;
    }
  }

  return { points, islands };
}

/**
 * How many islands the board has room for, laid out to suit its shape.
 *
 * Worked from the space one island needs rather than by cutting the board into
 * arbitrary cells: sizing islands to fit a cell left the narrow direction
 * cramped and the wide one empty, and the board read as two long bands.
 */
function gridFor(width: number, height: number, minDistance: number) {
  // Area an island of the target size occupies once its nodes are spread at
  // the usual spacing, plus the water around it.
  const nodeArea = minDistance * minDistance * 0.87;
  const islandArea = (ISLAND_TARGET * nodeArea) / PACKING;
  const cell = 2 * Math.sqrt(islandArea / Math.PI) + minDistance * WATER;

  const room = Math.max(3, Math.floor((width * height) / (cell * cell)));
  const columns = Math.max(2, Math.round(Math.sqrt((room * width) / height)));
  const rows = Math.max(2, Math.round(room / columns));
  return { columns, rows };
}

/** Share of a disc that Poisson-disk sampling actually fills. */
const PACKING = 0.55;

/**
 * Wires the islands up, with a bridge standing in the water between each pair.
 *
 * The alternative — fortifying the node at each end of a crossing — makes a
 * wall facing a wall, and neither side can ever attack into one profitably.
 * Measured, that is a stalemate machine: two hard bots settled one match in
 * ten on such boards. A single node in between is attacked from both sides on
 * equal terms, changes hands, and the front moves.
 *
 * All island edges come from one Delaunay triangulation and each bridge sits
 * on the straight line of the crossing it replaces, so nothing crosses
 * anything.
 */
export function buildIslandLayout(
  points: readonly Point[],
  islands: readonly number[],
  rng: Rng,
  keepRatio: number,
  minDistance: number,
): IslandLayout {
  const all = delaunayEdges(points);
  const inside = all.filter((edge) => islands[edge.a] === islands[edge.b]);

  const edges = thinInsideIslands(points, islands, inside, rng, keepRatio);
  const laid = [...points];
  const where = [...islands];
  const bridges: number[] = [];

  const place = (crossing: GraphEdge) => {
    const from = points[crossing.a]!;
    const to = points[crossing.b]!;
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };

    const bridge = laid.length;
    laid.push(middle);
    where.push(BRIDGE);
    bridges.push(bridge);
    edges.push({ a: crossing.a, b: bridge }, { a: bridge, b: crossing.b });
  };

  // A bridge is a node like any other and needs the same elbow room. The
  // midpoint of a long crossing can otherwise land on top of a third island,
  // or on another bridge, and the two draw over each other.
  const hasRoom = (crossing: GraphEdge) => {
    const from = points[crossing.a]!;
    const to = points[crossing.b]!;
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };

    return laid.every((other, id) => {
      if (id === crossing.a || id === crossing.b) return true;
      return Math.hypot(other.x - middle.x, other.y - middle.y) >= minDistance;
    });
  };

  chooseCrossings(points, islands, all, hasRoom, place);

  return { points: laid, islands: where, edges, bridges };
}

/** Thins each island's own mesh, never breaking that island apart. */
function thinInsideIslands(
  points: readonly Point[],
  islands: readonly number[],
  inside: readonly GraphEdge[],
  rng: Rng,
  keepRatio: number,
): GraphEdge[] {
  const kept = new Set(inside);
  const order = [...inside]
    .map((edge) => ({ edge, weight: edgeLength(points, edge) * rng.float(0.5, 1.5) }))
    .sort((left, right) => right.weight - left.weight);

  const target = Math.round(inside.length * keepRatio);
  for (const { edge } of order) {
    if (kept.size <= target) break;
    kept.delete(edge);
    if (!islandStaysWhole(points.length, islands, [...kept], islands[edge.a]!)) kept.add(edge);
  }

  return [...kept];
}

function islandStaysWhole(
  nodeCount: number,
  islands: readonly number[],
  edges: readonly GraphEdge[],
  island: number,
): boolean {
  const members: number[] = [];
  for (let id = 0; id < nodeCount; id++) if (islands[id] === island) members.push(id);

  const index = new Map(members.map((id, at) => [id, at]));
  const inside = edges
    .filter((edge) => index.has(edge.a) && index.has(edge.b))
    .map((edge) => ({ a: index.get(edge.a)!, b: index.get(edge.b)! }));

  return isConnected(members.length, inside);
}

/**
 * Picks the crossings: the shortest link between each pair of islands until
 * they are all joined, then more until nobody is a dead end.
 */
function chooseCrossings(
  points: readonly Point[],
  islands: readonly number[],
  all: readonly GraphEdge[],
  hasRoom: (edge: GraphEdge) => boolean,
  onTake: (edge: GraphEdge) => void,
): GraphEdge[] {
  const crossings = all.filter((edge) => islands[edge.a] !== islands[edge.b]);
  const byLength = [...crossings].sort(
    (left, right) => edgeLength(points, left) - edgeLength(points, right),
  );

  const islandCount = Math.max(...islands) + 1;
  const groups = new UnionFind(islandCount);
  const waysOut = new Array(islandCount).fill(0);
  const wanted = Array.from({ length: islandCount }, (_, island) => {
    const size = islands.filter((value) => value === island).length;
    return Math.max(MIN_WAYS_OUT, Math.min(WAYS_OUT, Math.floor(size / NODES_PER_WAY_OUT)));
  });
  const chosen: GraphEdge[] = [];

  const take = (edge: GraphEdge) => {
    chosen.push(edge);
    onTake(edge);
    groups.join(islands[edge.a]!, islands[edge.b]!);
    waysOut[islands[edge.a]!]++;
    waysOut[islands[edge.b]!]++;
  };

  // First join everything up, shortest links first and only where a bridge
  // will fit.
  for (const edge of byLength) {
    if (groups.same(islands[edge.a]!, islands[edge.b]!)) continue;
    if (!hasRoom(edge)) continue;
    take(edge);
  }

  // Connectivity outranks tidiness: if some island could not be reached by a
  // crossing with room to spare, join it anyway.
  for (const edge of byLength) {
    if (groups.same(islands[edge.a]!, islands[edge.b]!)) continue;
    take(edge);
  }

  const needsDoor = (edge: GraphEdge) =>
    waysOut[islands[edge.a]!]! < wanted[islands[edge.a]!]! ||
    waysOut[islands[edge.b]!]! < wanted[islands[edge.b]!]!;

  // Then open more doors wherever an island has too few.
  for (const edge of byLength) {
    if (chosen.includes(edge)) continue;
    if (!needsDoor(edge)) continue;
    if (!hasRoom(edge)) continue;
    take(edge);
  }

  return chosen;
}

function edgeLength(points: readonly Point[], edge: GraphEdge): number {
  const a = points[edge.a]!;
  const b = points[edge.b]!;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(value: number): number {
    while (this.parent[value] !== value) {
      this.parent[value] = this.parent[this.parent[value]!]!;
      value = this.parent[value]!;
    }
    return value;
  }

  same(left: number, right: number): boolean {
    return this.find(left) === this.find(right);
  }

  join(left: number, right: number): void {
    this.parent[this.find(left)] = this.find(right);
  }
}
