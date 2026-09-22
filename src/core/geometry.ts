import type { GameNode, GameState, Squad } from './state';

/** Extra pixels of slack around a node so small circles stay easy to hit. */
const CLICK_SLACK = 8;

/** The node under a world-space point, or null. Ties go to the nearest centre. */
export function nodeAtPoint(state: GameState, x: number, y: number): GameNode | null {
  let best: GameNode | null = null;
  let bestDistance = Infinity;

  for (const node of state.nodes) {
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance > node.radius + CLICK_SLACK) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }

  return best;
}

/**
 * Where a squad sits along its edge.
 *
 * Progress beyond 1 is extrapolated rather than clamped: the renderer feeds in
 * progress predicted past the last simulation step to keep motion smooth.
 */
export function squadPosition(state: GameState, squad: Squad): { x: number; y: number } {
  const from = state.nodes[squad.from];
  const to = state.nodes[squad.to];
  if (!from || !to) return { x: 0, y: 0 };

  return {
    x: from.x + (to.x - from.x) * squad.progress,
    y: from.y + (to.y - from.y) * squad.progress,
  };
}

/** How near the cursor has to be to a wire to count as resting on it. */
const WIRE_GRAB = 12;

/**
 * Which wire runs under a point, as the pair of nodes it joins.
 *
 * A source node alone used to identify a wire, because a node had at most
 * one. A balancer has one per neighbour, so it takes both ends to say which
 * line the cursor is resting on — and the × has to land on the right one.
 */
export interface WireRef {
  from: number;
  to: number;
}

export function wireAtPoint(state: GameState, x: number, y: number): WireRef | null {
  // A node the cursor is actually on always wins. A wire runs centre to
  // centre, so its line passes under both of its nodes, and resting on a node
  // would otherwise bring up the × for a wire nobody was pointing at.
  if (nodeAtPoint(state, x, y)) return null;

  let best: WireRef | null = null;
  let bestDistance = WIRE_GRAB;

  state.nodes.forEach((source, fromId) => {
    for (const toId of state.wires[fromId] ?? []) {
      const target = state.nodes[toId];
      if (!target) continue;

      const drawn = between(source, target);
      if (!drawn) continue;

      const distance = distanceToSegment(x, y, drawn.ax, drawn.ay, drawn.bx, drawn.by);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { from: fromId, to: toId };
      }
    }
  });

  return best;
}

/**
 * The stretch of a wire that is actually drawn: between the two circles,
 * never across them.
 *
 * The renderer starts its dashes clear of both nodes, and what can be grabbed
 * has to be what can be seen. Measuring the whole centre-to-centre line
 * instead put a wire's hit area inside its own nodes.
 */
function between(source: GameNode, target: GameNode) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);

  const start = source.radius;
  const finish = length - target.radius;
  // Nodes closer together than their own radii have no wire to show.
  if (finish <= start) return null;

  const ux = dx / length;
  const uy = dy / length;
  return {
    ax: source.x + ux * start,
    ay: source.y + uy * start,
    bx: source.x + ux * finish,
    by: source.y + uy * finish,
  };
}

/** Halfway along a wire, where its controls sit. */
export function wireMidpoint(
  state: GameState,
  wire: WireRef,
): { x: number; y: number } | null {
  if (!state.wires[wire.from]?.includes(wire.to)) return null;

  const source = state.nodes[wire.from];
  const target = state.nodes[wire.to];
  if (!source || !target) return null;

  return { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
}

function distanceToSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - ax, y - ay);

  // Clamped, so a point beyond either end measures to that end rather than to
  // the infinite line the segment sits on.
  const along = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
  return Math.hypot(x - (ax + dx * along), y - (ay + dy * along));
}
