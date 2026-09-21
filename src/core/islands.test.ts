import { describe, expect, test } from 'vitest';
import { isConnected } from './graph';
import { BRIDGE, buildIslandLayout, scatterIslands } from './islands';
import { createRng } from './rng';

/** The spacing the game actually plays at. */
function scattered(seed = 1, minDistance = 70) {
  return scatterIslands(1600, 1000, minDistance, createRng(seed));
}

describe('scatterIslands', () => {
  test('lays the board out as separate clumps', () => {
    const { points, islands } = scattered();

    expect(points.length).toBe(islands.length);
    expect(new Set(islands).size).toBeGreaterThanOrEqual(3);
  });

  test('leaves a gap between islands', () => {
    const { points, islands } = scattered(2);

    let nearestAcross = Infinity;
    let furthestWithin = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const distance = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
        if (islands[i] === islands[j]) furthestWithin = Math.max(furthestWithin, distance);
        else nearestAcross = Math.min(nearestAcross, distance);
      }
    }

    // Neighbours within an island sit closer than anything across the water.
    expect(nearestAcross).toBeGreaterThan(70);
    expect(furthestWithin).toBeGreaterThan(0);
  });

  test('every island is worth the name', () => {
    const { islands } = scattered(3);

    for (const island of new Set(islands)) {
      expect(islands.filter((value) => value === island).length).toBeGreaterThanOrEqual(4);
    }
  });

  test('island numbers run from zero without gaps', () => {
    const { islands } = scattered(4);
    const seen = [...new Set(islands)].sort((a, b) => a - b);

    expect(seen).toEqual(seen.map((_, index) => index));
  });

  test('keeps every point on the board', () => {
    const { points } = scattered(5);

    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1600);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1000);
    }
  });

  test('tighter spacing fits more of everything', () => {
    expect(scattered(6, 60).points.length).toBeGreaterThan(scattered(6, 100).points.length);
  });

  test('the same seed lays out the same board', () => {
    expect(scattered(7)).toEqual(scattered(7));
  });
});

describe('buildIslandLayout', () => {
  function layoutOf(seed = 1) {
    const { points, islands } = scattered(seed);
    return buildIslandLayout(points, islands, createRng(seed), 0.55, 70);
  }

  test('the whole board is one connected network', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { points, edges } = layoutOf(seed);
      expect(isConnected(points.length, edges), `seed ${seed}`).toBe(true);
    }
  });

  test('every island is connected inside itself', () => {
    const { islands, edges } = layoutOf(2);

    for (const island of new Set(islands)) {
      if (island === BRIDGE) continue;
      const members = islands.flatMap((value, index) => (value === island ? [index] : []));
      const index = new Map(members.map((id, at) => [id, at]));
      const inside = edges
        .filter((e) => index.has(e.a) && index.has(e.b))
        .map((e) => ({ a: index.get(e.a)!, b: index.get(e.b)! }));

      expect(isConnected(members.length, inside), `island ${island}`).toBe(true);
    }
  });

  test('two islands never touch: everything between them goes over a bridge', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { islands, edges } = layoutOf(seed);

      for (const edge of edges) {
        const from = islands[edge.a]!;
        const to = islands[edge.b]!;
        if (from === to) continue;
        expect(from === BRIDGE || to === BRIDGE, `seed ${seed}, edge ${edge.a}-${edge.b}`).toBe(
          true,
        );
      }
    }
  });

  test('a bridge joins exactly two islands and nothing else', () => {
    const { islands, edges, bridges } = layoutOf(3);

    for (const bridge of bridges) {
      const ends = edges
        .filter((edge) => edge.a === bridge || edge.b === bridge)
        .map((edge) => (edge.a === bridge ? edge.b : edge.a));

      expect(ends, `bridge ${bridge}`).toHaveLength(2);
      expect(islands[ends[0]!]).not.toBe(islands[ends[1]!]);
      expect(islands[ends[0]!]).not.toBe(BRIDGE);
      expect(islands[ends[1]!]).not.toBe(BRIDGE);
    }
  });

  test('a bridge stands in the water, not on top of an island', () => {
    const { points, islands, edges, bridges } = layoutOf(4);

    for (const bridge of bridges) {
      const neighbours = edges
        .filter((edge) => edge.a === bridge || edge.b === bridge)
        .map((edge) => (edge.a === bridge ? edge.b : edge.a));

      // It sits halfway along the crossing it replaced.
      const [left, right] = neighbours.map((id) => points[id]!);
      expect(points[bridge]!.x).toBeCloseTo((left!.x + right!.x) / 2);
      expect(points[bridge]!.y).toBeCloseTo((left!.y + right!.y) / 2);
      expect(islands[bridge]).toBe(BRIDGE);
    }
  });

  test('no island is a dead end', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { islands, edges } = layoutOf(seed);
      const ways = new Map<number, number>();

      for (const edge of edges) {
        for (const [node, other] of [
          [edge.a, edge.b],
          [edge.b, edge.a],
        ]) {
          if (islands[other!] !== BRIDGE || islands[node!] === BRIDGE) continue;
          ways.set(islands[node!]!, (ways.get(islands[node!]!) ?? 0) + 1);
        }
      }

      for (const island of new Set(islands)) {
        if (island === BRIDGE) continue;
        expect(ways.get(island) ?? 0, `seed ${seed}, island ${island}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test('bridges are far fewer than the nodes they join', () => {
    const { points, bridges } = layoutOf(5);

    expect(bridges.length / points.length).toBeLessThan(0.3);
  });

  test('the same seed gives the same map', () => {
    expect(layoutOf(9).edges).toEqual(layoutOf(9).edges);
  });
});
