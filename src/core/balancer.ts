import { sendSquad } from './orders';
import { NEUTRAL, type GameNode, type GameState, type ShareMode } from './state';

/**
 * The balancer: a node that produces nothing and stores nothing.
 *
 * Everything that reaches it leaves again on the next step, whole, to one of
 * the neighbours it is wired to. That is the trade it offers — logistics that
 * costs no orders and no garrison, on a node that is empty and so can be
 * taken for a single point. A hub belongs in the rear.
 *
 * It is built, not dealt: `convert.ts` is what turns a node into one.
 */

/**
 * The ways a balancer can share out, in the order they are offered.
 *
 * Data rather than a switch in the dialog, for the same reason the send modes
 * and the difficulties are: the panel that offers them reads this, so a third
 * way to share is a row here and nothing else.
 */
export const SHARE_MODES = {
  round: {
    label: 'По кругу',
    hint: 'Каждая следующая посылка — следующему выходу по списку.',
  },
  balance: {
    label: 'Поровну',
    hint: 'Посылка уходит тому, кто сильнее всех просел против своего потолка.',
  },
} as const satisfies Record<ShareMode, { label: string; hint: string }>;

/**
 * Empties every balancer on the board into its outputs.
 *
 * Runs after `flushWires`, which has already dropped the wires whose far end
 * changed hands, and before squads advance, so a parcel that arrives on one
 * step leaves on the next.
 */
export function flushBalancers(state: GameState): void {
  for (const node of state.nodes) {
    if (node.kind !== 'balancer' || node.owner === NEUTRAL) continue;
    if (Math.floor(node.points) < 1) continue;

    const outputs = liveOutputs(state, node);
    if (outputs.length === 0) continue;

    const toId = chooseOutput(state, node, outputs);
    // Everything it holds. A balancer that kept a share would be a store, and
    // a store is what the node was before it became one of these.
    sendSquad(state, node.owner, node.id, toId, 1);
  }
}

/**
 * The outputs worth considering: still there, still the owner's.
 *
 * `flushWires` prunes the dead ones already, but a rule that only works
 * because something else ran first is a rule that will one day be called on
 * its own and quietly turn a supply run into an attack.
 */
function liveOutputs(state: GameState, node: GameNode): number[] {
  return (state.wires[node.id] ?? []).filter(
    (toId) => state.nodes[toId]?.owner === node.owner,
  );
}

/** Which output gets this parcel, and the bookkeeping that goes with it. */
function chooseOutput(state: GameState, node: GameNode, outputs: number[]): number {
  if (node.share === 'balance') return emptiest(state, outputs);

  const at = (node.cursor ?? 0) % outputs.length;
  node.cursor = at + 1;
  return outputs[at]!;
}

/**
 * The output furthest from its own ceiling.
 *
 * Fullness, not the raw number: a small node holding 20 of its 25 needs less
 * than a big one holding 25 of its 240. Parcel after parcel this pulls the
 * outputs level, the way a battery balancer pulls cells to one voltage — it
 * does not split anything, it keeps topping up whichever has sagged.
 *
 * Ties go to the lower id, so a board with two equal outputs plays out the
 * same way every time it is replayed from its seed.
 */
function emptiest(state: GameState, outputs: number[]): number {
  let best = outputs[0]!;
  let bestFill = Infinity;

  for (const toId of outputs) {
    const target = state.nodes[toId]!;
    const fill = target.points / Math.max(1, target.capacity);
    if (fill < bestFill) {
      bestFill = fill;
      best = toId;
    }
  }

  return best;
}
