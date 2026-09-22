import { auraMultiplier, growthMultiplier } from './kinds';
import { NEUTRAL, type GameNode, type OwnerId } from './state';

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
 * is a deliberate choice rather than a leak. `pace` multiplies the lot and is
 * 1 in every match anybody plays; the tutorial runs it faster, because a
 * lesson about where points go is no lesson while there are none to watch. A player holding a core earns
 * faster everywhere at once — that is what makes it worth crossing the board
 * for, rather than one more node to stand on.
 */
export function applyGrowth(nodes: readonly GameNode[], dt: number, pace = 1): void {
  const auras = aurasHeld(nodes);

  for (const node of nodes) {
    if (node.owner === NEUTRAL) continue;
    if (node.points >= node.capacity) continue;
    const rate = growthRateOf(node) * (auras.get(node.owner) ?? 1) * pace;
    node.points = Math.min(node.capacity, node.points + rate * dt);
  }
}

/**
 * The aura each player is currently holding.
 *
 * A board carries one core, but the best is taken rather than the product, so
 * a map that somehow held two could not double anybody's economy.
 */
function aurasHeld(nodes: readonly GameNode[]): Map<OwnerId, number> {
  const held = new Map<OwnerId, number>();

  for (const node of nodes) {
    if (node.owner === NEUTRAL) continue;
    const aura = auraMultiplier(node);
    if (aura <= 1) continue;
    held.set(node.owner, Math.max(held.get(node.owner) ?? 1, aura));
  }

  return held;
}
