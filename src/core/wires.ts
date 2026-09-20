import { sendSquad } from './orders';
import { NEUTRAL, type GameState, type OwnerId } from './state';

/** Share of its ceiling a wired node holds back as garrison. */
export const WIRE_KEEP_SHARE = 0.5;

/**
 * Supply wires.
 *
 * A bot issues a dozen orders a second and a player cannot, and the gap is
 * almost entirely logistics — hauling reserves from a quiet rear to the
 * fighting. A wire does that hauling: once a node fills up and stops earning,
 * everything above half its ceiling goes to the neighbour the wire points at.
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

    // Everything over the garrison leaves in one shipment. Sending a fixed
    // share instead would dribble a node that has just been handed a large
    // load out over several steps, as a queue of scraps.
    const keep = source.capacity * WIRE_KEEP_SHARE;
    sendSquad(state, source.owner, fromId, toId, (source.points - keep) / source.points);
  });
}
