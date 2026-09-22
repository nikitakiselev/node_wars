import { sendAmount } from './orders';
import { NEUTRAL, type GameNode, type GameState, type ShareMode } from './state';

/**
 * The balancer: a node that produces nothing and stores nothing.
 *
 * Everything that reaches it leaves again on the next step, to the
 * neighbours it is wired to. That is the trade it offers — logistics that
 * costs no orders and no garrison, on a node that is empty and so can be
 * taken for a single point. A hub belongs in the rear.
 *
 * It is built, not dealt: `convert.ts` is what turns a node into one.
 */

/**
 * The ways a balancer can share out, in the order they are offered.
 *
 * Data rather than a switch in the dialog, for the same reason the send modes
 * and the difficulties are: the panel that offers them reads this, so a
 * fourth way to share is a row here and a branch in `sharesOf`.
 *
 * The names are the load balancer's own, because that is exactly what this
 * node is and a player who has met one will know them on sight.
 */
export const SHARE_MODES = {
  round: {
    label: 'Round Robin',
    hint: 'Вся посылка целиком — следующему выходу по списку.',
  },
  adaptive: {
    label: 'Adaptive',
    hint: 'Посылка делится сразу на всех: отстающие подтягиваются к самому полному, остаток — поровну.',
  },
  broadcast: {
    label: 'Broadcast',
    hint: 'Посылка делится поровну между всеми выходами, сколько бы у кого ни было.',
  },
} as const satisfies Record<ShareMode, { label: string; hint: string }>;

/** The mode a node is set to, or the plain one if it is set to nothing known. */
export function shareModeOf(node: Pick<GameNode, 'share'>): ShareMode {
  const mode = node.share;
  return mode !== undefined && mode in SHARE_MODES ? mode : 'round';
}

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

    const parcel = Math.floor(node.points);
    if (parcel < 1) continue;

    const outputs = liveOutputs(state, node);
    if (outputs.length === 0) continue;

    for (const [toId, amount] of sharesOf(state, node, outputs, parcel)) {
      sendAmount(state, node.owner, node.id, toId, amount);
    }
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

/**
 * How one parcel is split, as pairs of output and points.
 *
 * Every share is rounded down, so the shares can only ever add up to less
 * than the parcel. Whatever is left over — never more than one point per
 * output — stays on the hub and goes out with the next parcel. A balancer
 * that rounded the other way would be printing points.
 */
function sharesOf(
  state: GameState,
  node: GameNode,
  outputs: number[],
  parcel: number,
): [number, number][] {
  if (shareModeOf(node) === 'round') {
    const at = (node.cursor ?? 0) % outputs.length;
    node.cursor = at + 1;
    return [[outputs[at]!, parcel]];
  }

  const weights =
    shareModeOf(node) === 'adaptive' ? topUps(state, outputs, parcel) : outputs.map(() => 0);

  const spoken = weights.reduce((sum, share) => sum + share, 0);
  // Whatever the weights did not claim is split evenly. For Broadcast that is
  // the whole parcel; for Adaptive it is what is left once everybody has been
  // brought level, which is what keeps them level afterwards.
  const each = Math.floor((parcel - spoken) / outputs.length);

  return outputs.map((toId, index) => [toId, weights[index]! + each]);
}

/**
 * What each output needs to stand as tall as the fullest of them.
 *
 * Topping up to the leader rather than sharing the parcel out in proportion
 * to how far behind each one is: proportion overshoots. Two outputs holding
 * 10 and 40 would send the whole parcel to the first, which then passes the
 * second, and the two of them slosh back and forth for the rest of the match.
 * Filling up to the leader and splitting the rest evenly settles instead —
 * they draw level and then rise together.
 *
 * Scaled down when the parcel cannot cover every top-up, so a small parcel is
 * still shared in proportion to how far behind each output is.
 */
function topUps(state: GameState, outputs: number[], parcel: number): number[] {
  let leader = 0;
  for (const toId of outputs) leader = Math.max(leader, state.nodes[toId]!.points);

  const behind = outputs.map((toId) => leader - state.nodes[toId]!.points);
  const total = behind.reduce((sum, gap) => sum + gap, 0);
  if (total <= 0) return outputs.map(() => 0);

  const share = Math.min(1, parcel / total);
  return behind.map((gap) => Math.floor(gap * share));
}
