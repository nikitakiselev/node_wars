import { DEFAULT_SHARE } from './balancer';
import { devMode } from './dev';
import { MAX_LEVEL } from './levels';
import { wireLimitOf } from './wires';
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
  /** What this kind is called, for a sentence about it. */
  label: string;
  /**
   * What the button offering it says when asked.
   *
   * Written out rather than built from the label, because Russian declines:
   * "в балансировщик" and "в батарею" cannot both be had by pasting a word
   * onto "Преобразовать". A row in this table carries its own grammar.
   */
  action: string;
  /**
   * What a node still lacks, in a few words.
   *
   * Next to the rule rather than in the panel that shows it: a condition and
   * the sentence explaining it are one thing, and the sentence going stale is
   * exactly what happens when they live apart.
   */
  needs: string;
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
    action: 'Преобразовать в балансировщик',
    needs: `перекрёсток из ${MIN_BALANCER_NEIGHBOURS} своих узлов`,
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
 * What building this kind costs right now.
 *
 * The one place the price is read, so the developer switch has one place to
 * change it — and so the button, the bots, the rules panel and the rule that
 * charges can never quote different numbers at each other.
 */
export function costOf(kind: NodeKind): number {
  if (devMode()) return 0;
  return CONVERSIONS[kind]?.cost ?? 0;
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

  const cost = costOf(kind);
  if (node.points < cost) return false;

  node.points -= cost;
  node.kind = kind;
  // Levelling from the start: a hub is built to even things out, and the one
  // mode that does that without being asked is the one it should arrive on.
  // Round robin is the choice you make after seeing what the default does.
  if (kind === 'balancer') node.share = DEFAULT_SHARE;
  return true;
}

/**
 * Strips a node back to a plain one, for nothing.
 *
 * Any kind, not only the ones somebody built. Terrain was the earlier rule —
 * a fortress was there before the player was, and demoting it read as
 * rewriting the map — but it made a crossroads that happened to be dealt as a
 * fortress the one crossroads on the board that could never be built into
 * anything. Clearing ground you already hold is a decision the player is
 * allowed to make.
 */
export function revertNode(state: GameState, actor: OwnerId, nodeId: number): boolean {
  if (actor === NEUTRAL) return false;

  const node = state.nodes[nodeId];
  if (!node || node.owner !== actor || node.kind === 'base') return false;

  node.kind = 'base';
  delete node.share;
  delete node.cursor;
  // A hub may have had five wires where a plain node is allowed one. Trimmed
  // from the oldest, the rule laying one past the limit already follows,
  // rather than dropping the lot: a farm with a wire should not lose it
  // because its rays came down.
  const wires = state.wires[nodeId] ?? [];
  state.wires[nodeId] = wires.slice(-wireLimitOf(state, nodeId));
  return true;
}

/**
 * Why this node is offered nothing, or null when it is offered something.
 *
 * A node at the top of its levels with no crossroads under it has no action
 * at all, and a ring with nothing in it is a selection that appears to do
 * nothing. It says what the node would have to be instead.
 */
export function missingFor(state: GameState, nodeId: number): string | null {
  const node = state.nodes[nodeId];
  if (!node || conversionsFor(state, nodeId).length > 0) return null;

  for (const kind of Object.keys(CONVERSIONS) as NodeKind[]) {
    const conversion = CONVERSIONS[kind]!;
    // Only worth explaining where the node is otherwise ready: a first-level
    // node is not being refused a balancer, it simply has building to do.
    if (node.kind !== 'base' || node.level < MAX_LEVEL) continue;
    return `${conversion.label}: нужен ${conversion.needs}`;
  }

  return null;
}

/** The kinds this node could be built into right now, for the ring of actions. */
export function conversionsFor(state: GameState, nodeId: number): NodeKind[] {
  const node = state.nodes[nodeId];
  if (!node) return [];

  return (Object.keys(CONVERSIONS) as NodeKind[]).filter((kind) =>
    CONVERSIONS[kind]!.allowed(node, state),
  );
}
