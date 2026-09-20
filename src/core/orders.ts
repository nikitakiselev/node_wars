import { NEUTRAL, type GameState, type OwnerId, type Squad } from './state';

/** World units a squad covers per second, whatever the edge length. */
export const SQUAD_SPEED = 140;

/**
 * Orders a node to send part of its garrison along an edge.
 *
 * Returns the new squad, or null when the order is illegal — wrong owner, no
 * edge, or too few points to round up to a single unit. Both the player's
 * input and the AI go through here, so the rules cannot diverge.
 */
export function sendSquad(
  state: GameState,
  actor: OwnerId,
  fromId: number,
  toId: number,
  fraction: number,
): Squad | null {
  if (actor === NEUTRAL) return null;

  const source = state.nodes[fromId];
  const target = state.nodes[toId];
  if (!source || !target) return null;
  if (source.owner !== actor) return null;
  if (!state.adjacency[fromId]?.includes(toId)) return null;

  const amount = Math.floor(source.points * fraction);
  if (amount < 1) return null;

  const edge = findEdge(state, fromId, toId);
  if (!edge) return null;

  source.points -= amount;
  const squad: Squad = {
    id: state.nextSquadId++,
    owner: actor,
    from: fromId,
    to: toId,
    amount,
    progress: 0,
    speed: SQUAD_SPEED / edge.length,
  };
  state.squads.push(squad);
  return squad;
}

function findEdge(state: GameState, a: number, b: number) {
  return state.edges.find(
    (edge) => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a),
  );
}
