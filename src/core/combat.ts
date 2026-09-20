import type { GameNode, Squad } from './state';

/**
 * Applies an arriving squad to its target node.
 *
 * Friendly squads add their points. Hostile ones subtract; only a strictly
 * larger force flips ownership, and it keeps the surplus as the new garrison.
 * An exact tie leaves the defender in place with an empty node — still theirs,
 * and one point takes it.
 */
export function resolveArrival(target: GameNode, squad: Squad): void {
  if (target.owner === squad.owner) {
    target.points += squad.amount;
    return;
  }

  const remaining = target.points - squad.amount;
  if (remaining < 0) {
    target.owner = squad.owner;
    target.points = -remaining;
  } else {
    target.points = remaining;
  }
}
