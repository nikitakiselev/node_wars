import { resolveArrival } from './combat';
import { applyGrowth } from './growth';
import { NEUTRAL, type GameState, type OwnerId } from './state';

/**
 * Advances the match by dt seconds.
 *
 * Called on a fixed timestep so a match plays out identically whatever the
 * frame rate; the renderer interpolates between steps for smooth motion.
 */
export function step(state: GameState, dt: number): void {
  if (state.winner !== null) return;

  state.time += dt;
  applyGrowth(state.nodes, dt);
  advanceSquads(state, dt);
  state.winner = findWinner(state);
}

function advanceSquads(state: GameState, dt: number): void {
  const stillFlying = [];
  for (const squad of state.squads) {
    squad.progress += squad.speed * dt;
    if (squad.progress < 1) {
      stillFlying.push(squad);
      continue;
    }
    const target = state.nodes[squad.to];
    if (target) resolveArrival(target, squad);
  }
  state.squads = stillFlying;
}

/**
 * A player is out once they hold no nodes and have nothing in the air. A squad
 * launched before their last node fell can still take one back, so it is not
 * over while one is flying.
 */
export function isEliminated(state: GameState, player: OwnerId): boolean {
  if (player === NEUTRAL) return false;

  for (const node of state.nodes) {
    if (node.owner === player) return false;
  }
  for (const squad of state.squads) {
    if (squad.owner === player) return false;
  }
  return true;
}

/**
 * The match is won when only one player is left standing.
 *
 * Holding literally every node used to be the requirement, which meant a
 * player could be wiped out and the game would say nothing at all while
 * neutral ground remained on the board. Unclaimed nodes nobody can contest
 * are not a reason to keep playing.
 */
function findWinner(state: GameState): OwnerId | null {
  const alive = new Set<OwnerId>();
  for (const node of state.nodes) {
    if (node.owner !== NEUTRAL) alive.add(node.owner);
  }
  for (const squad of state.squads) {
    if (squad.owner !== NEUTRAL) alive.add(squad.owner);
  }

  if (alive.size !== 1) return null;
  return [...alive][0]!;
}
