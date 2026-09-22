import { effectiveAttack } from '../core/combat';
import { CONVERSIONS, conversionsFor, convertNode } from '../core/convert';
import { growthRateOf } from '../core/growth';
import { auraMultiplier, defenceMultiplier, growthMultiplier } from '../core/kinds';
import { upgradeCost } from '../core/levels';
import { SQUAD_SPEED, sendSquad } from '../core/orders';
import { upgradeNode } from '../core/upgrade';
import { cutWire, setWire, wiresFrom } from '../core/wires';
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

/**
 * How far a siege is marked down against an attack that takes the node.
 *
 * Low enough that any real capture anywhere on the board is preferred, high
 * enough that standing still is not.
 */
const SIEGE_PENALTY = 0.5;

/** A fortress is cheap to hold once taken, which is worth a premium of its own. */
const FORTRESS_PREMIUM = 0.4;

/** How much more a fortress on the border is worth reinforcing than a plain node. */
const FORTRESS_HOLD = 1.6;

/** Garrison a border fortress keeps back before spending on walls, as a share
 * of its ceiling. It builds from surplus, never from the troops holding it. */
const FORTIFY_RESERVE = 0.5;

/**
 * What a node is worth beyond its capacity.
 *
 * A farm that earns half as much again is worth half as much again, so its
 * worth follows its actual rate rather than a flat constant. A fortress earns
 * nothing extra, but the thicker its walls the less it will cost to keep.
 *
 * A core earns for the whole network, so what it is worth depends on how big
 * that network is: a bot holding three nodes should not cross the board for
 * it, and a bot holding thirty should drop everything. Taken from the same
 * table the rule plays by, so tuning the aura tunes the bot with it.
 *
 * @param held how many nodes the attacker owns right now.
 */
function kindWorth(target: GameNode, held: number): number {
  if (target.kind === 'farm') return growthMultiplier(target);
  if (target.kind === 'fortress') {
    return 1 + (defenceMultiplier(target) - 1) * FORTRESS_PREMIUM;
  }
  if (target.kind === 'core') return 1 + (auraMultiplier(target) - 1) * held;
  return 1;
}

/** How many nodes a player is holding, for the worth of what earns across them. */
function nodesHeld(state: GameState, player: OwnerId): number {
  let held = 0;
  for (const node of state.nodes) if (node.owner === player) held++;
  return held;
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
      // Hubs are built and then kept pointing the right way, both before the
      // shipping they exist to save: a hub laid this decision starts carrying
      // on the next one rather than a decision later.
      buildHubs(state, player);
      aimHubs(state, player);
      issue(state, player, supportOrders(config, state, player), () =>
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
      if (node.points < node.capacity) return false;

      const cost = upgradeCost(node.level);
      if (cost === null || node.points < cost) return false;

      // The rear builds from anything spare. A fortress on the border builds
      // too — walls are what it is for — but only out of surplus, so paying
      // for them never leaves the crossing thin.
      if ((toFront[node.id] ?? 0) >= 1) return true;
      if (node.kind !== 'fortress') return false;
      return node.points - cost >= node.capacity * FORTIFY_RESERVE;
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

/**
 * Nodes a bot holds per balancer it is willing to build.
 *
 * A hub is logistics that costs no orders at all, which is exactly the pipe
 * `NODES_PER_SUPPORT_ORDER` was measured to size. Left unlimited, two bots
 * reinforcing through hubs hold every front for ever and the match never
 * ends — the same failure, arrived at from the other direction. This is the
 * knob that keeps it in hand, and it is measured by `app/match.test.ts`.
 */
const NODES_PER_HUB = 12;

/** How far from the fighting a node has to be before it is worth hollowing out. */
const HUB_DEPTH = 2;

/**
 * Builds rear crossroads into balancers, up to what the empire can carry.
 *
 * Only in the depth of the empire, and never on the border. A balancer holds
 * nothing, so it is taken by a single point: a hub on the front line is a
 * hole in it.
 */
function buildHubs(state: GameState, player: OwnerId): void {
  const conversion = CONVERSIONS['balancer'];
  if (!conversion) return;

  let held = 0;
  let hubs = 0;
  for (const node of state.nodes) {
    if (node.owner !== player) continue;
    held++;
    if (node.kind === 'balancer') hubs++;
  }

  if (hubs >= Math.floor(held / NODES_PER_HUB)) return;

  const toFront = distanceToFront(state, player);
  let best: GameNode | undefined;

  for (const node of state.nodes) {
    if (node.owner !== player || node.points < conversion.cost) continue;
    if ((toFront[node.id] ?? 0) < HUB_DEPTH) continue;
    if (!conversionsFor(state, node.id).includes('balancer')) continue;

    // The busiest crossroads it has: a hub is worth more the more ways out of
    // it there are, which is the same thing that made it eligible.
    const ways = (state.adjacency[node.id] ?? []).length;
    if (!best || ways > (state.adjacency[best.id] ?? []).length) best = node;
  }

  if (best) convertNode(state, player, best.id, 'balancer');
}

/**
 * Points every hub the bot holds down the hop gradient, and only down it.
 *
 * A hub wired to all its neighbours would hand points back to whatever just
 * fed it — round the same two nodes for the rest of the match. Wiring only to
 * neighbours nearer the fighting makes it a pump rather than a valve, and it
 * is the gradient the bot's own logistics already runs on.
 *
 * Redone every decision, because the front moves: a wire that pointed forward
 * last minute can be pointing into the rear now.
 */
function aimHubs(state: GameState, player: OwnerId): void {
  const toFront = distanceToFront(state, player);

  for (const node of state.nodes) {
    if (node.owner !== player || node.kind !== 'balancer') continue;

    // Nothing it holds is its own, so an even split is not what it wants: it
    // sends where the need is, and lets the front catch up with the rear.
    node.share = 'adaptive';

    const depth = toFront[node.id] ?? 0;
    const forward = (state.adjacency[node.id] ?? []).filter((id) => {
      if (state.nodes[id]?.owner !== player) return false;
      return (toFront[id] ?? 0) < depth;
    });

    for (const toId of wiresFrom(state, node.id)) {
      if (!forward.includes(toId)) cutWire(state, player, node.id, toId);
    }
    for (const toId of forward) setWire(state, player, node.id, toId);
  }
}

/**
 * Orders a bot may spend on logistics per decision, beyond its attacks.
 *
 * One order moves one node one hop, so a flat budget is a flat pipe: it was
 * enough for a chain of eight and hopeless for an empire. Measured on
 * thirty-six full nodes with fighting in front of them, a flat one-a-decision
 * left half of them standing at capacity for a whole minute — the whole depth
 * of the empire was dead weight, which is the exact failure the hop gradient
 * exists to prevent.
 *
 * So the budget grows with what there is to move. It is deliberately **not**
 * solved by giving the bot wires: that made it lay one on nearly every node on
 * the board — 58 of 60 in a measured match — and `drawWires` re-tessellates
 * every dash of every wire on every frame.
 */
function supportOrders(config: AiConfig, state: GameState, player: OwnerId): number {
  let held = 0;
  for (const node of state.nodes) if (node.owner === player) held++;

  const forTheEmpire = held / NODES_PER_SUPPORT_ORDER;
  // The same third of its order budget it always spent, now applied to a pipe
  // sized for what has to go through it.
  const forTheDifficulty = config.ordersPerDecision / 3;

  return Math.max(1, Math.round(forTheEmpire * forTheDifficulty));
}

/**
 * How many nodes one logistics order a decision can keep flowing.
 *
 * Measured against both things that can go wrong. At 8 the rear flows
 * beautifully and matches stop ending — two bots reinforcing that hard hold
 * every front for ever, and only 2 of 10 were settled. At 16 the matches come
 * back and five nodes in thirty-six go back to standing at capacity. Twelve is
 * where both hold: 1 of 36 idle, and every match test green.
 */
const NODES_PER_SUPPORT_ORDER = 12;

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
  // Counted once for the whole decision: what a core is worth depends on it,
  // and it cannot change while the bot is making up its mind.
  const held = nodesHeld(state, player);

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
        held,
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

      const move = support(state, source, target, config, player);
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
  player: OwnerId,
): Move | null {
  const edge = edgeBetween(state, source.id, target.id);
  if (!edge) return null;

  const amount = Math.floor(source.points * config.commitment);
  if (amount < 1) return null;

  // Send from wherever is fullest and closest to the fighting — and towards
  // whichever border needs it. Scoring on the source alone made the logistics
  // blind: reserves went to the nearest front whether or not anything was
  // happening there, and a crossing about to fall got no more than a quiet
  // node behind it.
  const flightSeconds = edge.length / SQUAD_SPEED;
  const outgunned = Math.max(0, pressureOn(state, target, player) - target.points);
  const urgency = 1 + outgunned / (target.capacity + 1);
  const worth = target.kind === 'fortress' ? FORTRESS_HOLD : 1;

  return {
    from: source.id,
    to: target.id,
    fraction: config.commitment,
    score: ((amount * urgency * worth) / (flightSeconds + 1)),
  };
}

/** Points sitting next to a node that do not belong to its owner. */
function pressureOn(state: GameState, node: GameNode, player: OwnerId): number {
  let total = 0;
  for (const id of state.adjacency[node.id] ?? []) {
    const neighbour = state.nodes[id];
    if (!neighbour || neighbour.owner === player) continue;
    total += neighbour.points;
  }
  return total;
}

function evaluate(
  state: GameState,
  source: GameNode,
  target: GameNode,
  config: AiConfig,
  inbound: number,
  held: number,
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
  if (needed > source.points) return siege(source, target, config, flightSeconds);

  const fraction = Math.min(1, needed / source.points);

  // Worth is what the node will eventually produce; cost is what the attack
  // spends and how long it is in the air. Taking ground from the human is
  // worth more than the same node sitting neutral.
  const worth =
    target.capacity *
    kindWorth(target, held) *
    (target.owner === NEUTRAL ? 1 : config.aggression);
  const score = (worth / (needed + flightSeconds * 10)) * (allIn ? ALL_IN_PENALTY : 1);

  return { from: source.id, to: target.id, fraction, score };
}

/**
 * An attack that cannot take the node and is worth making anyway.
 *
 * A node holding more than its own ceiling earns nothing back: what is taken
 * off it stays off, while the attacker's own nodes grow their points again. A
 * wave that bounces off a stack like that is a trade the attacker wins, and
 * refusing it is how a bot ends up standing at full strength for the rest of
 * the match — which is exactly what it used to do against a player who piled
 * ten thousand points onto the one node between them.
 *
 * Below the ceiling the damage grows back, so the wave is thrown away. That
 * half of the rule, and the demand that the attacking node be full, are what
 * keep this from being "attack regardless".
 */
function siege(
  source: GameNode,
  target: GameNode,
  config: AiConfig,
  flightSeconds: number,
): Move | null {
  // Only a node that has stopped earning may be spent this way. Its points are
  // dead weight until they are used, which is precisely what a siege is for;
  // a node still filling up is growing into something, and emptying it costs
  // real economy for a dent.
  if (source.points < source.capacity) return null;

  const amount = Math.floor(source.points * config.commitment);
  if (amount < 1) return null;

  const damage = effectiveAttack(target, amount);
  // Still over its ceiling once the wave lands, so none of this grows back.
  if (target.points - damage < target.capacity) return null;

  return {
    from: source.id,
    to: target.id,
    fraction: config.commitment,
    score: (damage / (amount + flightSeconds * 10)) * SIEGE_PENALTY,
  };
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
