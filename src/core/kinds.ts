import { clampLevel } from './levels';
import type { GameNode, NodeKind } from './state';

/**
 * What each kind is worth at each level.
 *
 * A plain node gets nothing from a level but room to hold more. The other
 * kinds get better at what they do, and the steps grow towards the top so
 * finishing a node is an event rather than the next notch — a new fortress is
 * a nuisance, a finished one is a wall.
 */
const BY_LEVEL: Record<NodeKind, { defence: readonly number[]; growth: readonly number[] }> = {
  base: {
    defence: [1, 1, 1, 1, 1],
    growth: [1, 1, 1, 1, 1],
  },
  fortress: {
    defence: [1.2, 1.3, 1.45, 1.65, 2],
    growth: [1, 1, 1, 1, 1],
  },
  farm: {
    defence: [1, 1, 1, 1, 1],
    growth: [1.4, 1.6, 1.8, 2.1, 2.5],
  },
};

/** How much of an attack this node's walls turn away. 1 means none. */
export function defenceMultiplier(node: Pick<GameNode, 'kind' | 'level'>): number {
  return BY_LEVEL[node.kind].defence[clampLevel(node.level) - 1]!;
}

/** How fast this node earns, against a plain node's rate. */
export function growthMultiplier(node: Pick<GameNode, 'kind' | 'level'>): number {
  return BY_LEVEL[node.kind].growth[clampLevel(node.level) - 1]!;
}
