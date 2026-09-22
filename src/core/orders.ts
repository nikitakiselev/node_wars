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
  const source = state.nodes[fromId];
  if (!source) return null;
  return sendAmount(state, actor, fromId, toId, source.points * fraction);
}

/**
 * The same order, given as a number of points rather than a share.
 *
 * A balancer splitting one parcel between three outputs knows the three
 * amounts, not three fractions — and fractions would not survive the
 * arithmetic anyway, since each send shrinks the garrison the next one would
 * be measured against.
 *
 * Rounded down and clamped to what the node actually holds, so no split can
 * ever hand out more than went in.
 */
export function sendAmount(
  state: GameState,
  actor: OwnerId,
  fromId: number,
  toId: number,
  points: number,
): Squad | null {
  if (actor === NEUTRAL) return null;

  const source = state.nodes[fromId];
  const target = state.nodes[toId];
  if (!source || !target) return null;
  if (source.owner !== actor) return null;
  if (!state.adjacency[fromId]?.includes(toId)) return null;

  const amount = Math.min(Math.floor(points), Math.floor(source.points));
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
