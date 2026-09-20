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
 * A player has won once every node flies their colour and nothing hostile is
 * still in the air — a squad launched before the last node fell can take it
 * straight back.
 */
function findWinner(state: GameState): OwnerId | null {
  const first = state.nodes[0];
  if (!first || first.owner === NEUTRAL) return null;

  const candidate = first.owner;
  for (const node of state.nodes) {
    if (node.owner !== candidate) return null;
  }
  for (const squad of state.squads) {
    if (squad.owner !== candidate) return null;
  }
  return candidate;
}
