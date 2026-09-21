import Delaunator from 'delaunator';
import type { Point } from './poisson';
import type { Rng } from './rng';

export interface GraphEdge {
  a: number;
  b: number;
}

/** Breadth-first reachability from node 0. */
export function isConnected(nodeCount: number, edges: readonly GraphEdge[]): boolean {
  if (nodeCount === 0) return true;

  const neighbours: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) {
    neighbours[edge.a]?.push(edge.b);
    neighbours[edge.b]?.push(edge.a);
  }

  const seen = new Uint8Array(nodeCount);
  const queue = [0];
  seen[0] = 1;
  let reached = 1;

  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const next of neighbours[current] ?? []) {
      if (seen[next]) continue;
      seen[next] = 1;
      reached++;
      queue.push(next);
    }
  }

  return reached === nodeCount;
}

/**
 * Builds the map's edges: a Delaunay triangulation thinned out at random.
 *
 * Delaunay gives a planar graph — no edge ever crosses another — which is what
 * makes the map readable at a glance. Thinning turns the uniform mesh into
 * something with corridors and chokepoints, and it removes the longest edges
 * first, since those are the stretched slivers along the hull.
 *
 * @param keepRatio fraction of Delaunay edges to keep, 0..1.
 */
export function buildGraph(points: readonly Point[], rng: Rng, keepRatio: number): GraphEdge[] {
  const edges = delaunayEdges(points);
  const target = Math.max(points.length - 1, Math.round(edges.length * keepRatio));

  const removalOrder = [...edges]
    .map((edge) => ({ edge, weight: edgeLength(points, edge) * rng.float(0.5, 1.5) }))
    .sort((left, right) => right.weight - left.weight)
    .map((entry) => entry.edge);

  const kept = new Set(edges);
  for (const candidate of removalOrder) {
    if (kept.size <= target) break;
    kept.delete(candidate);
    if (!isConnected(points.length, [...kept])) kept.add(candidate);
  }

  return [...kept];
}

/** Every edge of the Delaunay triangulation, each one once. */
export function delaunayEdges(points: readonly Point[]): GraphEdge[] {
  const coords = points.flatMap((p) => [p.x, p.y]);
  const { triangles } = new Delaunator(Float64Array.from(coords));

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const corners = [triangles[i]!, triangles[i + 1]!, triangles[i + 2]!];
    for (let c = 0; c < 3; c++) {
      const a = corners[c]!;
      const b = corners[(c + 1) % 3]!;
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
  }
  return edges;
}

function edgeLength(points: readonly Point[], edge: GraphEdge): number {
  const a = points[edge.a]!;
  const b = points[edge.b]!;
  return Math.hypot(a.x - b.x, a.y - b.y);
}
