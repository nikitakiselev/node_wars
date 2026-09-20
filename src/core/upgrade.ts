import { applyLevel, upgradeCost } from './levels';
import type { GameState, OwnerId } from './state';
import { NEUTRAL } from './state';

/**
 * Builds a node up one level, charging its own garrison for the work.
 *
 * Returns false when the order is illegal — not yours, not affordable, or
 * already at the top. Both the player's button and the bots go through here,
 * so the rules cannot diverge.
 */
export function upgradeNode(state: GameState, actor: OwnerId, nodeId: number): boolean {
  if (actor === NEUTRAL) return false;

  const node = state.nodes[nodeId];
  if (!node || node.owner !== actor) return false;

  const cost = upgradeCost(node.level);
  if (cost === null || node.points < cost) return false;

  node.points -= cost;
  applyLevel(node, node.level + 1);
  return true;
}
