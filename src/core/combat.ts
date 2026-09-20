import { applyLevel } from './levels';
import type { GameNode, Squad } from './state';

/** How much of an attack a fortress shrugs off. Half in, so double to take. */
export const FORTRESS_DEFENCE = 2;

/** How much of an arriving hostile force actually lands on a node. */
export function effectiveAttack(target: GameNode, amount: number): number {
  return target.kind === 'fortress' ? amount / FORTRESS_DEFENCE : amount;
}

/**
 * Applies an arriving squad to its target node.
 *
 * Friendly squads add their points in full — a fortress is armour against
 * attackers, not a tax on its own garrison. Hostile ones subtract whatever
 * survives the walls; only a strictly larger force flips ownership, and it
 * keeps the surplus as the new garrison. An exact tie leaves the defender in
 * place with an empty node — still theirs, and one point takes it.
 *
 * Taking a node knocks it down a level: the storm wrecks part of what was
 * built there, so a breakthrough does not hand over an intact economy.
 */
export function resolveArrival(target: GameNode, squad: Squad): void {
  if (target.owner === squad.owner) {
    target.points += squad.amount;
    return;
  }

  const remaining = target.points - effectiveAttack(target, squad.amount);
  if (remaining < 0) {
    target.owner = squad.owner;
    target.points = -remaining;
    applyLevel(target, target.level - 1);
  } else {
    target.points = remaining;
  }
}
