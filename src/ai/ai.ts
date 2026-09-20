import { GROWTH_PER_SECOND } from '../core/growth';
import { SQUAD_SPEED, sendSquad } from '../core/orders';
import type { Rng } from '../core/rng';
import { NEUTRAL, type GameNode, type GameState, type OwnerId } from '../core/state';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AiConfig {
  /** Seconds between decisions. The main lever on how hard the bot feels. */
  reactionTime: number;
  /** Cushion sent on top of what the target needs, in points. */
  safetyPoints: number;
  /** Share of a node's garrison the bot is willing to commit to one attack. */
  commitment: number;
  /** How much it values taking ground from the human over taking neutrals. */
  aggression: number;
  /** Chance of picking a merely good move instead of the best one. */
  sloppiness: number;
  /** Orders the bot can give in one decision, the way a player clicks several
   * nodes in a row rather than one per second. */
  ordersPerDecision: number;
}

export const DIFFICULTIES: Record<Difficulty, AiConfig> = {
  easy: {
    reactionTime: 2.2,
    safetyPoints: 6,
    commitment: 0.6,
    aggression: 1,
    sloppiness: 0.5,
    ordersPerDecision: 1,
  },
  normal: {
    reactionTime: 1.1,
    safetyPoints: 4,
    commitment: 0.75,
    aggression: 1.4,
    sloppiness: 0.2,
    ordersPerDecision: 3,
  },
  hard: {
    reactionTime: 0.45,
    safetyPoints: 2,
    commitment: 0.85,
    aggression: 1.8,
    sloppiness: 0,
    ordersPerDecision: 6,
  },
};

/**
 * How much an all-in attack is discounted against an ordinary one.
 *
 * Emptying a node to take another is how a stalled front gets broken, but it
 * is never the first choice while something cheaper is on offer.
 */
const ALL_IN_PENALTY = 0.35;

export interface Ai {
  /** Advances the bot's own clock and issues an order when it is due. */
  update(state: GameState, dt: number): void;
}

interface Move {
  from: number;
  to: number;
  fraction: number;
  score: number;
}

export function createAi(player: OwnerId, difficulty: Difficulty, rng: Rng): Ai {
  const config = DIFFICULTIES[difficulty];
  let sinceLastDecision = 0;

  return {
    update(state, dt) {
      if (state.winner !== null) return;

      sinceLastDecision += dt;
      if (sinceLastDecision < config.reactionTime) return;
      sinceLastDecision = 0;

      // Each order changes the board, so the next one is chosen against the
      // state it leaves behind rather than a stale snapshot.
      for (let issued = 0; issued < config.ordersPerDecision; issued++) {
        const move = chooseMove(state, player, config, rng);
        if (!move) break;
        if (!sendSquad(state, player, move.from, move.to, move.fraction)) break;
      }
    },
  };
}

function chooseMove(
  state: GameState,
  player: OwnerId,
  config: AiConfig,
  rng: Rng,
): Move | null {
  const attacks: Move[] = [];
  const supports: Move[] = [];
  const toFront = distanceToFront(state, player);

  for (const source of state.nodes) {
    if (source.owner !== player) continue;

    for (const targetId of state.adjacency[source.id] ?? []) {
      const target = state.nodes[targetId];
      if (!target) continue;

      // Anything already on its way counts. Without this the bot spends a
      // second wave on a node the first wave has already taken.
      const inbound = inboundFriendly(state, targetId, player);

      if (target.owner !== player) {
        const move = evaluate(state, source, target, config, inbound);
        if (move) attacks.push(move);
        continue;
      }

      // Measured: letting reserves stack on a node that already has a squad
      // inbound made matches finish less often, not more. One wave at a time
      // keeps the rear from dumping its whole garrison into a single node.
      if (inbound > 0) continue;

      // Reserves flow down the gradient towards the fighting. Without this the
      // whole depth of an empire is dead weight: only the ring of nodes
      // touching the border ever contributes, and a large empire grinds
      // against a small one on even terms.
      const here = toFront[source.id] ?? Infinity;
      const there = toFront[targetId] ?? Infinity;
      if (!(there < here)) continue;

      const move = support(state, source, target, config);
      if (move) supports.push(move);
    }
  }

  // Taking ground always beats shuffling it about; reserves move only when
  // there is nothing worth attacking.
  const moves = attacks.length > 0 ? attacks : supports;
  if (moves.length === 0) return null;
  moves.sort((left, right) => right.score - left.score);

  // A sloppy bot sometimes settles for the second-best option, which makes it
  // beatable without making it play obviously stupid moves.
  const takeSecond = moves.length > 1 && rng.next() < config.sloppiness;
  return takeSecond ? moves[1]! : moves[0]!;
}

/**
 * Hops from each of the player's nodes to their nearest contested border.
 *
 * Border nodes are 0, the ring behind them 1, and so on; nodes with no route
 * to a border are left undefined. Support moves follow this downhill.
 */
function distanceToFront(state: GameState, player: OwnerId): (number | undefined)[] {
  const distance: (number | undefined)[] = new Array(state.nodes.length);
  const queue: number[] = [];

  for (const node of state.nodes) {
    if (node.owner !== player) continue;
    const onBorder = (state.adjacency[node.id] ?? []).some(
      (id) => state.nodes[id]?.owner !== player,
    );
    if (!onBorder) continue;
    distance[node.id] = 0;
    queue.push(node.id);
  }

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    const next = (distance[current] ?? 0) + 1;
    for (const neighbour of state.adjacency[current] ?? []) {
      if (state.nodes[neighbour]?.owner !== player) continue;
      if (distance[neighbour] !== undefined) continue;
      distance[neighbour] = next;
      queue.push(neighbour);
    }
  }

  return distance;
}

function support(
  state: GameState,
  source: GameNode,
  target: GameNode,
  config: AiConfig,
): Move | null {
  const edge = edgeBetween(state, source.id, target.id);
  if (!edge) return null;

  const amount = Math.floor(source.points * config.commitment);
  if (amount < 1) return null;

  // Send from wherever is fullest and closest to the fighting.
  const flightSeconds = edge.length / SQUAD_SPEED;
  return {
    from: source.id,
    to: target.id,
    fraction: config.commitment,
    score: amount / (flightSeconds + 1),
  };
}

function evaluate(
  state: GameState,
  source: GameNode,
  target: GameNode,
  config: AiConfig,
  inbound: number,
): Move | null {
  const edge = edgeBetween(state, source.id, target.id);
  if (!edge) return null;

  const flightSeconds = edge.length / SQUAD_SPEED;
  const reinforcements = target.owner === NEUTRAL ? 0 : GROWTH_PER_SECOND * flightSeconds;
  // The cushion is a fixed number of points, not a percentage. A percentage
  // looks prudent early and becomes unreachable late: once two fronts stack up
  // in parity, neither can ever get a fifth ahead of the other, and the match
  // deadlocks with both sides hoarding.
  const needed =
    Math.ceil(target.points + reinforcements + 1 + config.safetyPoints) - inbound;
  if (needed < 1) return null;

  const affordable = Math.floor(source.points * config.commitment);
  const allIn = needed > affordable;
  if (allIn && needed > source.points) return null;

  const fraction = Math.min(1, needed / source.points);

  // Worth is what the node will eventually produce; cost is what the attack
  // spends and how long it is in the air. Taking ground from the human is
  // worth more than the same node sitting neutral.
  const worth = target.capacity * (target.owner === NEUTRAL ? 1 : config.aggression);
  const score = (worth / (needed + flightSeconds * 10)) * (allIn ? ALL_IN_PENALTY : 1);

  return { from: source.id, to: target.id, fraction, score };
}

/** Points this player already has flying towards a node. */
function inboundFriendly(state: GameState, nodeId: number, player: OwnerId): number {
  let total = 0;
  for (const squad of state.squads) {
    if (squad.to === nodeId && squad.owner === player) total += squad.amount;
  }
  return total;
}

function edgeBetween(state: GameState, a: number, b: number) {
  return state.edges.find(
    (edge) => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a),
  );
}
