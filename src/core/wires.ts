import { sendSquad } from './orders';
import { NEUTRAL, type GameState, type OwnerId } from './state';

/**
 * How full a node has to be before its wire fires.
 *
 * Set for the whole match when it is started. Waiting for the top is a rear
 * that saves up and sends in useful lumps; a lower mark is a rear that never
 * stops moving and never holds anything worth taking. At a tenth a node has
 * barely begun to earn before it forwards, which makes the whole rear a
 * pipe — and leaves nothing standing behind the front to fall back on.
 */
export const WIRE_FILLS = {
  full: { label: '100%', fill: 1 },
  most: { label: '75%', fill: 0.75 },
  half: { label: '50%', fill: 0.5 },
  trickle: { label: '10%', fill: 0.1 },
} as const;

/** How much of what the node holds goes down the wire when it fires. */
export const WIRE_SHARES = {
  quarter: { label: '¼', share: 0.25 },
  half: { label: '½', share: 0.5 },
  most: { label: '¾', share: 0.75 },
  all: { label: 'Всё', share: 1 },
} as const;

export type WireFill = keyof typeof WIRE_FILLS;
export type WireShare = keyof typeof WIRE_SHARES;

/** What a match plays by when it was saved before either was a setting. */
export const DEFAULT_WIRE_FILL: WireFill = 'full';
export const DEFAULT_WIRE_SHARE: WireShare = 'half';

/**
 * Supply wires.
 *
 * A bot issues a dozen orders a second and a player cannot, and the gap is
 * almost entirely logistics — hauling reserves from a quiet rear to the
 * fighting. A wire does that hauling: once a node has filled up as far as the
 * match asks, a share of what it holds goes to the neighbour it points at.
 * How full, and how much, are chosen when the match is started.
 *
 * They carry, they do not conquer. A wire only runs between two nodes you
 * already hold, so choosing what to attack stays a decision you make.
 *
 * An ordinary node is allowed one outgoing wire, so laying a second replaces
 * the first and the network stays a readable set of flows rather than a
 * tangle. A balancer is the exception it was built to be: it may point at
 * every neighbour it has, and `balancer.ts` decides which one gets what.
 */

/** How many outgoing wires this kind of node is allowed. */
export function wireLimitOf(state: GameState, nodeId: number): number {
  const node = state.nodes[nodeId];
  if (!node) return 0;
  if (node.kind !== 'balancer') return 1;
  return state.adjacency[nodeId]?.length ?? 0;
}

/** The nodes this one feeds, in the order they were laid. */
export function wiresFrom(state: GameState, nodeId: number): readonly number[] {
  return state.wires[nodeId] ?? [];
}

/**
 * Points a node at a neighbour.
 *
 * Past its limit the oldest wire gives way, so laying one is never refused
 * for being the second: an ordinary node simply swaps, which is what it has
 * always done, and a balancer only ever hits the limit if it is already
 * pointing at every neighbour it has.
 */
export function setWire(
  state: GameState,
  actor: OwnerId,
  fromId: number,
  toId: number,
): boolean {
  if (actor === NEUTRAL || fromId === toId) return false;

  const source = state.nodes[fromId];
  const target = state.nodes[toId];
  if (!source || !target) return false;
  if (source.owner !== actor || target.owner !== actor) return false;
  if (!state.adjacency[fromId]?.includes(toId)) return false;

  const wires = state.wires[fromId] ?? [];
  if (wires.includes(toId)) return true;

  wires.push(toId);
  while (wires.length > wireLimitOf(state, fromId)) wires.shift();
  state.wires[fromId] = wires;
  return true;
}

/** Takes down every wire out of a node. */
export function clearWire(state: GameState, actor: OwnerId, fromId: number): void {
  if (state.nodes[fromId]?.owner !== actor) return;
  state.wires[fromId] = [];
}

/** Takes down one wire, which is how a board with several of them is edited. */
export function cutWire(
  state: GameState,
  actor: OwnerId,
  fromId: number,
  toId: number,
): void {
  if (state.nodes[fromId]?.owner !== actor) return;
  state.wires[fromId] = (state.wires[fromId] ?? []).filter((id) => id !== toId);
}

/**
 * Runs every wire on the board: drops the ones that no longer make sense, and
 * sends from the ones whose node has filled up.
 *
 * Balancers are pruned here like everything else but never send from here —
 * they do not fill up, and `flushBalancers` is the one rule that empties them.
 * Two rules on one node would argue about who sent what.
 */
/**
 * The two numbers this match plays by.
 *
 * Read from the state rather than taken as arguments, because a wire is
 * flushed from inside `step`, which has only the state to go on — and because
 * they belong to a match the way its board does, and travel in its save.
 * A match saved before they existed has neither, and reads as what it was
 * played by.
 */
function fillOf(state: GameState): number {
  return state.wireFill ?? WIRE_FILLS[DEFAULT_WIRE_FILL].fill;
}

function shareOf(state: GameState): number {
  return state.wireShare ?? WIRE_SHARES[DEFAULT_WIRE_SHARE].share;
}

export function flushWires(state: GameState): void {
  state.nodes.forEach((source, fromId) => {
    const wires = state.wires[fromId];
    if (!wires || wires.length === 0) return;

    // A wire is only meaningful between two nodes one player holds; losing
    // either end takes it down rather than leaving it dangling.
    const live = wires.filter((toId) => {
      const target = state.nodes[toId];
      return target !== undefined && source.owner !== NEUTRAL && source.owner === target.owner;
    });
    if (live.length !== wires.length) state.wires[fromId] = live;

    if (source.kind === 'balancer') return;
    if (source.points < source.capacity * fillOf(state)) return;

    const toId = live[0];
    if (toId === undefined) return;

    // A share of whatever it holds, not everything above some fixed garrison:
    // a node sitting on a stockpile sends the same share as an empty one, so
    // a wire is a rate rather than a ceiling.
    sendSquad(state, source.owner, fromId, toId, shareOf(state));
  });
}
