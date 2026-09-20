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
 * The node whose supply wire runs under a point, or null.
 *
 * Returns the source node, since that is what identifies a wire — a node has
 * at most one.
 */
export function wireAtPoint(state: GameState, x: number, y: number): number | null {
  let best: number | null = null;
  let bestDistance = WIRE_GRAB;

  state.nodes.forEach((source, fromId) => {
    const toId = state.wires[fromId];
    if (toId === undefined) return;
    const target = state.nodes[toId];
    if (!target) return;

    const distance = distanceToSegment(x, y, source.x, source.y, target.x, target.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = fromId;
    }
  });

  return best;
}

/** Halfway along a node's wire, where its controls sit. */
export function wireMidpoint(
  state: GameState,
  fromId: number,
): { x: number; y: number } | null {
  const toId = state.wires[fromId];
  if (toId === undefined) return null;

  const source = state.nodes[fromId];
  const target = state.nodes[toId];
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
