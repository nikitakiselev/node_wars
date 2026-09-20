import { NEUTRAL, type GameNode } from './state';

/** Points per second added to every owned node below its capacity. */
export const GROWTH_PER_SECOND = 1;

/** How much faster a farm fills. Its capacity is untouched. */
export const FARM_GROWTH_MULTIPLIER = 2;

/** Points per second a node earns, given what kind of node it is. */
export function growthRateOf(node: GameNode): number {
  return node.kind === 'farm'
    ? GROWTH_PER_SECOND * FARM_GROWTH_MULTIPLIER
    : GROWTH_PER_SECOND;
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
