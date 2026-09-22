import { devMode } from './dev';
import type { GameNode } from './state';

/**
 * What a node's level buys.
 *
 * Capacity is the ceiling the node produces up to; above it the node keeps
 * whatever reinforcements it is given but stops earning. Radius is how big it
 * is drawn, and it grows far more slowly than capacity. The top levels are
 * deliberately close in size: what a node can hold has to keep climbing, but
 * what it takes up on the board must not, or islands cannot be packed tightly
 * enough to look like islands.
 */
const LEVELS = [
  { capacity: 25, radius: 15 },
  { capacity: 50, radius: 19 },
  { capacity: 90, radius: 23 },
  { capacity: 150, radius: 27 },
  { capacity: 240, radius: 30 },
] as const;

export const MAX_LEVEL = LEVELS.length;

function tierFor(level: number) {
  return LEVELS[clampLevel(level) - 1]!;
}

export function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(1, Math.round(level)));
}

export function capacityForLevel(level: number): number {
  return tierFor(level).capacity;
}

export function radiusForLevel(level: number): number {
  return tierFor(level).radius;
}

/**
 * Points to reach the next level, or null at the top.
 *
 * You pay for the room you are adding, which keeps the rule sayable in one
 * breath and the price honest at every level.
 */
export function upgradeCost(level: number): number | null {
  if (clampLevel(level) >= MAX_LEVEL) return null;
  // Free while the developer switch is on, so that a board can be built up to
  // look at something rather than played up to it. The ceiling still holds:
  // free is a price, not a way past the top level.
  if (devMode()) return 0;
  return capacityForLevel(level + 1) - capacityForLevel(level);
}

/**
 * Sets a node's level and everything derived from it.
 *
 * Level, capacity and radius always move together, and this is the only place
 * that moves them, so the three cannot drift apart. The garrison is left
 * alone: points above the cap are allowed, they simply stop growing.
 */
export function applyLevel(node: GameNode, level: number): void {
  const wanted = clampLevel(level);
  node.level = wanted;
  node.capacity = capacityForLevel(wanted);
  node.radius = radiusForLevel(wanted);
}
