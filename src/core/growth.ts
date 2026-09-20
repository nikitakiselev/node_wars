import { growthMultiplier } from './kinds';
import { NEUTRAL, type GameNode } from './state';

/** Points per second added to every owned node below its capacity. */
export const GROWTH_PER_SECOND = 1;

/**
 * Points per second a node earns.
 *
 * A farm earns more, and more again as it is built up; every other kind earns
 * the flat rate at every level.
 */
export function growthRateOf(node: GameNode): number {
  return GROWTH_PER_SECOND * growthMultiplier(node);
}

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
    node.points = Math.min(node.capacity, node.points + growthRateOf(node) * dt);
  }
}
