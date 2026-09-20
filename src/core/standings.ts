import type { GameState, OwnerId } from './state';

export interface Standing {
  nodes: number;
  /** Garrisoned points plus everything the player has in the air. */
  points: number;
  /** This player's slice of all points on the board, 0..1. */
  share: number;
}

/** Aggregates a player's strength for the scoreboard. */
export function standingsFor(state: GameState, owner: OwnerId): Standing {
  let nodes = 0;
  let points = 0;
  let total = 0;

  for (const node of state.nodes) {
    total += node.points;
    if (node.owner !== owner) continue;
    nodes++;
    points += node.points;
  }

  for (const squad of state.squads) {
    total += squad.amount;
    if (squad.owner === owner) points += squad.amount;
  }

  return { nodes, points, share: total > 0 ? points / total : 0 };
}
