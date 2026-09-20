import { NEUTRAL, type GameNode } from './state';

/** Points per second added to every owned node below its capacity. */
export const GROWTH_PER_SECOND = 1;

/**
 * Grows owned nodes toward their capacity.
 *
 * Nodes already at or above capacity hold steady, so reinforcing past the cap
 * is a deliberate choice rather than a leak.
 */
export function applyGrowth(nodes: readonly GameNode[], dt: number): void {
  for (const node of nodes) {
    if (node.owner === NEUTRAL) continue;
    if (node.points >= node.capacity) continue;
    node.points = Math.min(node.capacity, node.points + GROWTH_PER_SECOND * dt);
  }
}
