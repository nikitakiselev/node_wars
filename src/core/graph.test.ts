import { describe, expect, test } from 'vitest';
import { createRng } from './rng';
import { poissonDiskSample, type Point } from './poisson';
import { buildGraph, isConnected, type GraphEdge } from './graph';

function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const orient = (a: Point, b: Point, c: Point) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return d1 !== d2 && d3 !== d4;
}

function points(seed = 1): Point[] {
  return poissonDiskSample(800, 600, 70, createRng(seed));
}

describe('isConnected', () => {
  test('a chain of nodes is connected', () => {
    expect(isConnected(3, [{ a: 0, b: 1 }, { a: 1, b: 2 }])).toBe(true);
  });

  test('an isolated node makes the graph disconnected', () => {
    expect(isConnected(3, [{ a: 0, b: 1 }])).toBe(false);
  });

  test('two separate components are not connected', () => {
    expect(isConnected(4, [{ a: 0, b: 1 }, { a: 2, b: 3 }])).toBe(false);
  });
});

describe('buildGraph', () => {
  test('every edge joins two distinct existing points', () => {
    const pts = points();

    for (const edge of buildGraph(pts, createRng(1), 0.6)) {
      expect(edge.a).not.toBe(edge.b);
      expect(pts[edge.a]).toBeDefined();
      expect(pts[edge.b]).toBeDefined();
    }
  });

  test('contains no duplicate edges', () => {
    const edges = buildGraph(points(), createRng(1), 0.6);
    const keys = edges.map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`);

    expect(new Set(keys).size).toBe(edges.length);
  });

  test('leaves the graph connected', () => {
    const pts = points();

    expect(isConnected(pts.length, buildGraph(pts, createRng(1), 0.5))).toBe(true);
  });

  test('stays connected across many seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const pts = points(seed);
      expect(isConnected(pts.length, buildGraph(pts, createRng(seed), 0.5))).toBe(true);
    }
  });

  test('no two edges cross, so the map stays readable', () => {
    const pts = points(4);
    const edges = buildGraph(pts, createRng(4), 0.6);

    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const e1 = edges[i]!;
        const e2 = edges[j]!;
        if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) continue;
        expect(
          segmentsCross(pts[e1.a]!, pts[e1.b]!, pts[e2.a]!, pts[e2.b]!),
        ).toBe(false);
      }
    }
  });

  test('a lower keep ratio produces fewer edges', () => {
    const pts = points(5);
    const sparse = buildGraph(pts, createRng(5), 0.4);
    const dense = buildGraph(pts, createRng(5), 1);

    expect(sparse.length).toBeLessThan(dense.length);
  });

  test('leaves no node stranded without an edge', () => {
    const pts = points(6);
    const edges: GraphEdge[] = buildGraph(pts, createRng(6), 0.4);
    const degree = new Array(pts.length).fill(0);
    for (const e of edges) {
      degree[e.a]++;
      degree[e.b]++;
    }

    expect(Math.min(...degree)).toBeGreaterThan(0);
  });

  test('the same seed produces the same edges', () => {
    const pts = points(8);

    expect(buildGraph(pts, createRng(8), 0.5)).toEqual(buildGraph(pts, createRng(8), 0.5));
  });
});
