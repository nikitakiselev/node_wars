import { MAX_LEVEL } from './levels';
import { NEUTRAL, type GameNode, type GameState, type NodeKind, type OwnerId } from './state';

/**
 * Building a node into something else.
 *
 * The map generator deals terrain — a fortress on a crossing, a farm in an
 * island's interior, the one core in the middle. This is the other half: what
 * a player builds out of ground they already hold, paid for out of the
 * garrison standing on it.
 *
 * Buildable kinds are data, exactly as their multipliers are. A new one is a
 * row in `CONVERSIONS`, a row in `BY_LEVEL`, a silhouette in `drawKindMark`
 * and a line in the kinds table in `app/help.ts` — never a new path through
 * code that already exists. The action ring and the bots both read this
 * table, so neither needs to learn the new kind by name.
 */
export interface Conversion {
  /** Points taken off the node's own garrison to build it. */
  cost: number;
  /** What the button offering it says. */
  label: string;
  /** Whether this particular node, right now, may be built into it. */
  allowed(node: GameNode, state: GameState): boolean;
}

/**
 * What a balancer costs: the price of the level it stands on.
 *
 * Turning a finished node into a hub has to be a decision. A free switch is
 * not a decision, and the node is giving up earning for ever either way.
 */
export const BALANCER_COST = 90;

/**
 * Neighbours of your own a node needs before it can become a balancer.
 *
 * This is the rule that reads "some nodes on the board obviously already are
 * hubs" back into the game: a dead end has nothing to share out, and only
 * something that already fans out three ways is worth the ninety points.
 */
export const MIN_BALANCER_NEIGHBOURS = 3;

export const CONVERSIONS: Partial<Record<NodeKind, Conversion>> = {
  balancer: {
    cost: BALANCER_COST,
    label: 'Балансировщик',
    allowed(node, state) {
      if (node.kind !== 'base' || node.level < MAX_LEVEL) return false;
      return ownNeighbours(state, node) >= MIN_BALANCER_NEIGHBOURS;
    },
  },
};

function ownNeighbours(state: GameState, node: GameNode): number {
  let own = 0;
  for (const id of state.adjacency[node.id] ?? []) {
    if (state.nodes[id]?.owner === node.owner) own++;
  }
  return own;
}

/**
 * Builds a node into another kind, charging its own garrison for the work.
 *
 * Returns false when the order is illegal — not yours, not buildable, not
 * affordable. The player's ring and the bots both come through here, so the
 * rules cannot diverge.
 */
export function convertNode(
  state: GameState,
  actor: OwnerId,
  nodeId: number,
  kind: NodeKind,
): boolean {
  if (actor === NEUTRAL) return false;

  const node = state.nodes[nodeId];
  if (!node || node.owner !== actor) return false;

  const conversion = CONVERSIONS[kind];
  if (!conversion || !conversion.allowed(node, state)) return false;
  if (node.points < conversion.cost) return false;

  node.points -= conversion.cost;
  node.kind = kind;
  // Round the list is the readable default; a player who wants the other one
  // is a player who has opened the settings and knows what it does.
  if (kind === 'balancer') node.share = 'round';
  return true;
}

/**
 * Takes a built node back to a plain one, for nothing.
 *
 * Only kinds somebody built can be taken back. A fortress or a farm is
 * terrain: it was there before the player was, and demoting it would be
 * rewriting the map rather than undoing a decision.
 */
export function revertNode(state: GameState, actor: OwnerId, nodeId: number): boolean {
  if (actor === NEUTRAL) return false;

  const node = state.nodes[nodeId];
  if (!node || node.owner !== actor) return false;
  if (!CONVERSIONS[node.kind]) return false;

  node.kind = 'base';
  delete node.share;
  delete node.cursor;
  // A plain node is allowed one wire and this one may have had five; rather
  // than pick a survivor, it lets go of all of them.
  state.wires[nodeId] = [];
  return true;
}

/** The kinds this node could be built into right now, for the ring of actions. */
export function conversionsFor(state: GameState, nodeId: number): NodeKind[] {
  const node = state.nodes[nodeId];
  if (!node) return [];

  return (Object.keys(CONVERSIONS) as NodeKind[]).filter((kind) =>
    CONVERSIONS[kind]!.allowed(node, state),
  );
}
