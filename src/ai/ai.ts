import { growthRateOf } from '../core/growth';
import { defenceMultiplier, growthMultiplier } from '../core/kinds';
import { upgradeCost } from '../core/levels';
import { SQUAD_SPEED, sendSquad } from '../core/orders';
import { upgradeNode } from '../core/upgrade';
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

/** A fortress is cheap to hold once taken, which is worth a premium of its own. */
const FORTRESS_PREMIUM = 0.4;

/**
 * What a node is worth beyond its capacity.
 *
 * A farm that earns half as much again is worth half as much again, so its
 * worth follows its actual rate rather than a flat constant. A fortress earns
 * nothing extra, but the thicker its walls the less it will cost to keep.
 */
function kindWorth(target: GameNode): number {
  if (target.kind === 'farm') return growthMultiplier(target);
  if (target.kind === 'fortress') {
    return 1 + (defenceMultiplier(target) - 1) * FORTRESS_PREMIUM;
  }
  return 1;
}

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
      issue(state, player, config.ordersPerDecision, () =>
        chooseAttack(state, player, config, rng),
      );
      // Logistics gets its own budget. Sharing one with attacks meant a busy
      // front ate every order and a quiet outpost was never reinforced — a
      // pocket of neutral nodes could then sit untaken for the whole match.
      // Building comes before shipping: logistics would otherwise empty a full
      // rear node every decision and it would never save up for anything.
      // Building up is its own kind of order for the same reason logistics is —
      // a bot that only spends on attacks never grows its income, and a human
      // who builds will out-earn it inside one match.
      build(state, player, config, rng);
      issue(state, player, supportOrders(config), () =>
        chooseSupport(state, player, config, rng),
      );
    },
  };
}

/**
 * Builds up rear nodes that have stopped earning.
 *
 * Only nodes that are full — their income is going nowhere — and that are not
 * holding a border, where the garrison is needed as a garrison.
 */
function build(state: GameState, player: OwnerId, config: AiConfig, rng: Rng): void {
  const toFront = distanceToFront(state, player);

  const candidates = state.nodes
    .filter((node) => {
      if (node.owner !== player) return false;
      if ((toFront[node.id] ?? 0) < 1) return false;
      if (node.points < node.capacity) return false;
      const cost = upgradeCost(node.level);
      return cost !== null && node.points >= cost;
    })
    // A farm earns double, so building one pays back twice as fast.
    .map((node) => ({ node, score: growthRateOf(node) / upgradeCost(node.level)! }))
    .sort((left, right) => right.score - left.score);

  const wanted = Math.max(1, Math.round(config.ordersPerDecision / 3));
  for (let built = 0; built < wanted; built++) {
    const next = candidates[built];
    if (!next) return;
    if (rng.next() < config.sloppiness) continue;
    upgradeNode(state, player, next.node.id);
  }
}

/** Orders a bot may spend on logistics per decision, beyond its attacks. */
function supportOrders(config: AiConfig): number {
  return Math.max(1, Math.round(config.ordersPerDecision / 3));
}

/** Issues up to `budget` orders, stopping as soon as there is nothing to do. */
function issue(
  state: GameState,
  player: OwnerId,
  budget: number,
  next: () => Move | null,
): void {
  for (let issued = 0; issued < budget; issued++) {
    const move = next();
    if (!move) return;
    if (!sendSquad(state, player, move.from, move.to, move.fraction)) return;
  }
}

function chooseAttack(
  state: GameState,
  player: OwnerId,
  config: AiConfig,
  rng: Rng,
): Move | null {
  const attacks: Move[] = [];

  for (const source of state.nodes) {
    if (source.owner !== player) continue;

    for (const targetId of state.adjacency[source.id] ?? []) {
      const target = state.nodes[targetId];
      if (!target || target.owner === player) continue;

      // Anything already on its way counts. Without this the bot spends a
      // second wave on a node the first wave has already taken.
      const move = evaluate(
        state,
        source,
        target,
        config,
        inboundFriendly(state, targetId, player),
      );
      if (move) attacks.push(move);
    }
  }

  return pick(attacks, config, rng);
}

/**
 * Picks a node to ship reserves to.
 *
 * Reserves flow down the hop gradient towards the fighting. Without this the
 * whole depth of an empire is dead weight: only the ring of nodes touching the
 * border ever contributes, and a large empire grinds against a small one on
 * even terms.
 */
function chooseSupport(
  state: GameState,
  player: OwnerId,
  config: AiConfig,
  rng: Rng,
): Move | null {
  const supports: Move[] = [];
  const toFront = distanceToFront(state, player);

  for (const source of state.nodes) {
    if (source.owner !== player) continue;

    for (const targetId of state.adjacency[source.id] ?? []) {
      const target = state.nodes[targetId];
      if (!target || target.owner !== player) continue;

      // Measured: letting reserves stack on a node that already has a squad
      // inbound made matches finish less often, not more. One wave at a time
      // keeps the rear from dumping its whole garrison into a single node.
      if (inboundFriendly(state, targetId, player) > 0) continue;

      const here = toFront[source.id] ?? Infinity;
      const there = toFront[targetId] ?? Infinity;
      if (!(there < here)) continue;

      const move = support(state, source, target, config);
      if (move) supports.push(move);
    }
  }

  return pick(supports, config, rng);
}

function pick(moves: Move[], config: AiConfig, rng: Rng): Move | null {
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
  const reinforcements = target.owner === NEUTRAL ? 0 : growthRateOf(target) * flightSeconds;
  // The cushion is a fixed number of points, not a percentage. A percentage
  // looks prudent early and becomes unreachable late: once two fronts stack up
  // in parity, neither can ever get a fifth ahead of the other, and the match
  // deadlocks with both sides hoarding.
  const defence = target.points + reinforcements + 1 + config.safetyPoints;
  // Walls are paid for in points sent, so the whole requirement scales with
  // however thick they have been built.
  const needed = Math.ceil(defence * defenceMultiplier(target)) - inbound;
  if (needed < 1) return null;

  const affordable = Math.floor(source.points * config.commitment);
  const allIn = needed > affordable;
  if (allIn && needed > source.points) return null;

  const fraction = Math.min(1, needed / source.points);

  // Worth is what the node will eventually produce; cost is what the attack
  // spends and how long it is in the air. Taking ground from the human is
  // worth more than the same node sitting neutral.
  const worth =
    target.capacity * kindWorth(target) * (target.owner === NEUTRAL ? 1 : config.aggression);
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
