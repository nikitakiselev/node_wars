import { drainRate } from './kinds';
import { NEUTRAL, type GameNode, type GameState } from './state';

/**
 * Batteries firing on the neighbours they are pointed at.
 *
 * A battery is the one kind that does something to a node it does not own, and
 * it does it without being told: hold a border with one and the border grinds
 * the other side down on its own. It never takes a node — a node it has
 * emptied still belongs to whoever held it, and one point takes it back — so
 * what a battery buys is pressure, not ground.
 *
 * Unclaimed ground is left alone deliberately. What neutral nodes cost to take
 * is a match setting the player chose in the dialog; a battery that erased it
 * would quietly undo that choice.
 */
export function applyDrain(state: GameState, dt: number): void {
  for (const battery of state.nodes) {
    const rate = drainRate(battery);
    if (rate <= 0) continue;

    const target = drainTargetOf(state, battery);
    if (!target) continue;

    target.points = Math.max(0, target.points - rate * dt);
  }
}

/**
 * What this battery is firing on, or null if it is firing on nothing.
 *
 * Shared with the renderer rather than worked out twice: the beam on the board
 * has to be drawn from the same rule the points are taken by, or the picture
 * and the game disagree about what is happening.
 *
 * "Neighbour" means joined by an edge, not near on screen. A battery whose
 * neighbours are all unclaimed — which is every battery early in a match — is
 * doing nothing, and the board should be able to say so.
 */
/** How many edges a battery can shoot across. */
export const BATTERY_REACH = 1;

/** Every node within reach of this one, itself excluded. */
function withinReach(state: GameState, from: GameNode): number[] {
  const seen = new Set<number>([from.id]);
  let edge = [from.id];

  for (let hop = 0; hop < BATTERY_REACH; hop++) {
    const next: number[] = [];
    for (const id of edge) {
      for (const neighbour of state.adjacency[id] ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    edge = next;
  }

  seen.delete(from.id);
  return [...seen];
}

export function drainTargetOf(state: GameState, battery: GameNode): GameNode | null {
  if (battery.owner === NEUTRAL || drainRate(battery) <= 0) return null;

  let target: GameNode | null = null;
  for (const id of withinReach(state, battery)) {
    const node = state.nodes[id];
    if (!node || node.owner === NEUTRAL) continue;
    if (node.owner === battery.owner) continue;
    // The strongest of them: a battery is pressure on the front, and the front
    // is wherever the most points are stacked against it.
    if (!target || node.points > target.points) target = node;
  }

  return target;
}
