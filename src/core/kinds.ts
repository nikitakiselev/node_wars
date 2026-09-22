import { clampLevel } from './levels';
import type { GameNode, NodeKind } from './state';

/**
 * What each kind is worth at each level.
 *
 * A plain node gets nothing from a level but room to hold more. The other
 * kinds get better at what they do, and the steps grow towards the top so
 * finishing a node is an event rather than the next notch — a new fortress is
 * a nuisance, a finished one is a wall.
 *
 * Kinds are data: a new one is a row here plus the rule that reads its column,
 * never a new path through the code that already exists.
 */
interface KindTable {
  /** How much of an attack the walls turn away. */
  defence: readonly number[];
  /** How fast this node itself earns. */
  growth: readonly number[];
  /** How fast every node its holder owns earns, this one included. */
  aura: readonly number[];
}

const NONE = [1, 1, 1, 1, 1] as const;

/** A balancer earns nothing at any level: it shares out, it does not produce. */
const ZERO = [0, 0, 0, 0, 0] as const;

const BY_LEVEL: Record<NodeKind, KindTable> = {
  base: {
    defence: NONE,
    growth: NONE,
    aura: NONE,
  },
  fortress: {
    defence: [1.2, 1.3, 1.45, 1.65, 2],
    growth: NONE,
    aura: NONE,
  },
  farm: {
    defence: NONE,
    growth: [1.4, 1.6, 1.8, 2.1, 2.5],
    aura: NONE,
  },
  core: {
    defence: NONE,
    growth: NONE,
    aura: [1.12, 1.15, 1.18, 1.22, 1.28],
  },
  balancer: {
    defence: NONE,
    growth: ZERO,
    aura: NONE,
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

/**
 * How fast everything its holder owns earns while this node is theirs.
 *
 * A farm earns for itself; a core earns for the network. That is the whole
 * difference between them, and it is why one is worth taking early and the
 * other is worth taking at any point in the match.
 */
export function auraMultiplier(node: Pick<GameNode, 'kind' | 'level'>): number {
  return BY_LEVEL[node.kind].aura[clampLevel(node.level) - 1]!;
}
