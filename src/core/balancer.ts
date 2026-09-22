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

/**
 * What a hub shares by until it is told otherwise.
 *
 * The one that does the plainest thing: everything that arrives is cut into
 * equal pieces and sent on. A hub arriving on a mode that quietly favours one
 * output over another is a hub whose behaviour has to be worked out before it
 * can be trusted; this one can be read off the board. The modes that decide
 * something are choices to make afterwards.
 */
export const DEFAULT_SHARE: ShareMode = 'broadcast';

/** The mode a node is set to, or the default if it is set to nothing known. */
export function shareModeOf(node: Pick<GameNode, 'share'>): ShareMode {
  const mode = node.share;
  return mode !== undefined && mode in SHARE_MODES ? mode : DEFAULT_SHARE;
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
 * The shares add up to the parcel exactly. Rounding each one down on its own
 * left a point or two behind every time, and the hub shipped that leftover on
 * the very next step as a second, tiny squad chasing the first — which looked
 * like the balancer inventing points from somewhere. Nothing is invented and
 * nothing is stranded: the whole parcel goes out at once.
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

  const wanted =
    shareModeOf(node) === 'adaptive'
      ? levelling(state, outputs, parcel)
      : outputs.map(() => parcel / outputs.length);

  const from = (node.cursor ?? 0) % outputs.length;
  node.cursor = from + 1;

  const shares = apportion(wanted, parcel, from);
  return outputs.map((toId, index) => [toId, shares[index]!]);
}

/**
 * What each output would get if points came in fractions.
 *
 * Bring whoever is behind up to the fullest output, then share whatever is
 * left over evenly — that is what makes the outputs draw level and then rise
 * together. A parcel too small to level them is split in proportion to how
 * far behind each one is, so a trickle still goes where it is needed most.
 *
 * Topping up rather than sharing out in proportion to the gap: proportion
 * overshoots. Two outputs holding 10 and 40 would get the whole parcel sent
 * to the first, which then passes the second, and the two slosh back and
 * forth for the rest of the match.
 */
function levelling(state: GameState, outputs: number[], parcel: number): number[] {
  let leader = 0;
  for (const toId of outputs) leader = Math.max(leader, state.nodes[toId]!.points);

  const behind = outputs.map((toId) => leader - state.nodes[toId]!.points);
  const total = behind.reduce((sum, gap) => sum + gap, 0);

  if (total >= parcel) {
    // Not enough to level them; share it out by how far behind each one is.
    return total <= 0 ? outputs.map(() => 0) : behind.map((gap) => (parcel * gap) / total);
  }

  const spare = (parcel - total) / outputs.length;
  return behind.map((gap) => gap + spare);
}

/**
 * Turns fractional shares into whole points that still add up to the parcel.
 *
 * Every share is rounded down first, so nothing can be handed out that did
 * not arrive; the points that rounding shaved off then go, one each, to
 * whichever shares lost the most to it. That is the largest-remainder rule,
 * and it is the reason no point is ever left on the hub.
 *
 * Ties are broken by walking the list from a moving start rather than always
 * from the top, so an even split between three outputs does not quietly
 * favour the first of them for the whole match. `from` is the same cursor
 * round robin keeps, which is why a node only ever uses one of the two.
 */
function apportion(wanted: number[], parcel: number, from: number): number[] {
  const whole = wanted.map((share) => Math.floor(share));
  let left = parcel - whole.reduce((sum, share) => sum + share, 0);

  const order = wanted
    .map((share, index) => ({ index, part: share - Math.floor(share) }))
    .sort((a, b) => b.part - a.part || turn(a.index, from, wanted.length) - turn(b.index, from, wanted.length));

  for (const next of order) {
    if (left <= 0) break;
    whole[next.index]!++;
    left--;
  }

  return whole;
}

/** How far round the list an output sits from where this parcel starts. */
function turn(index: number, from: number, count: number): number {
  return (index - from + count) % count;
}
