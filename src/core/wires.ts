import { sendSquad } from './orders';
import { NEUTRAL, type GameState, type OwnerId } from './state';

/** Share of a filled node that goes down its wire; the rest stays to defend. */
export const WIRE_SEND_FRACTION = 0.5;

/**
 * Supply wires.
 *
 * A bot issues a dozen orders a second and a player cannot, and the gap is
 * almost entirely logistics — hauling reserves from a quiet rear to the
 * fighting. A wire does that hauling: once a node fills up and stops earning,
 * half of it goes to the neighbour the wire points at.
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
    if (source.points < source.capacity) return;

    const toId = live[0];
    if (toId === undefined) return;

    // Half of whatever it holds, not everything above some fixed garrison: a
    // node sitting on a stockpile must stay worth attacking rather than
    // becoming a free capture the moment it forwards.
    sendSquad(state, source.owner, fromId, toId, WIRE_SEND_FRACTION);
  });
}
