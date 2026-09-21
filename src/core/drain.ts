import { drainRate } from './kinds';
import { NEUTRAL, type GameState } from './state';

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
    if (battery.owner === NEUTRAL) continue;

    const rate = drainRate(battery);
    if (rate <= 0) continue;

    let target = null;
    for (const id of state.adjacency[battery.id] ?? []) {
      const neighbour = state.nodes[id];
      if (!neighbour || neighbour.owner === NEUTRAL) continue;
      if (neighbour.owner === battery.owner) continue;
      // The strongest of them: a battery is pressure on the front, and the
      // front is wherever the most points are stacked against it.
      if (!target || neighbour.points > target.points) target = neighbour;
    }

    if (!target) continue;
    target.points = Math.max(0, target.points - rate * dt);
  }
}
