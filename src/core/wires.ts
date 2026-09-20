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
 */

/** The node this one feeds, or null. */
export function wireFrom(state: GameState, nodeId: number): number | null {
  return state.wires[nodeId] ?? null;
}

/**
 * Points a node at a neighbour. One outgoing wire per node, so laying a new
 * one replaces the old: the network stays a readable set of flows rather than
 * a tangle.
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

  state.wires[fromId] = toId;
  return true;
}

export function clearWire(state: GameState, actor: OwnerId, fromId: number): void {
  if (state.nodes[fromId]?.owner !== actor) return;
  state.wires[fromId] = undefined;
}

/**
 * Runs every wire on the board: drops the ones that no longer make sense, and
 * sends from the ones whose node has filled up.
 */
export function flushWires(state: GameState): void {
  state.nodes.forEach((source, fromId) => {
    const toId = state.wires[fromId];
    if (toId === undefined) return;

    const target = state.nodes[toId];
    // A wire is only meaningful between two nodes one player holds; losing
    // either end takes it down rather than leaving it dangling.
    if (!target || source.owner === NEUTRAL || source.owner !== target.owner) {
      state.wires[fromId] = undefined;
      return;
    }

    if (source.points < source.capacity) return;

    // Half of whatever it holds, not everything above some fixed garrison: a
    // node sitting on a stockpile must stay worth attacking rather than
    // becoming a free capture the moment it forwards.
    sendSquad(state, source.owner, fromId, toId, WIRE_SEND_FRACTION);
  });
}
