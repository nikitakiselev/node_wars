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
