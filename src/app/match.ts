import { createAi, type Ai, type Difficulty } from '../ai/ai';
import { generateMap } from '../core/mapgen';
import { createRng } from '../core/rng';
import { step } from '../core/simulation';
import type { GameState, OwnerId } from '../core/state';
import { MAX_PLAYERS } from '../render/theme';
import { FixedTimestep } from './loop';

/** The middle board. Kept as the reference the renderer and tests work from. */
export const WORLD = { width: 1600, height: 1000 } as const;

/**
 * Spacing between neighbouring nodes, the same on every board.
 *
 * Bounded from below by the widest node plus a fortress wall: a bridge sitting
 * a step from its shore must not draw over it.
 */
export const NODE_SPACING = 70;

/** Simulation rate. Fixed, so a match is reproducible from its seed. */
export const STEP_SECONDS = 1 / 30;

export const HUMAN: OwnerId = 0;

/** Bots that can sit at one table; every seat needs a colour of its own. */
export const MAX_OPPONENTS = MAX_PLAYERS - 1;

/** Board sizes, set by how closely nodes may be packed. */
/**
 * Board sizes, set by how much world there is.
 *
 * Node spacing stays the same and the world grows instead, because islands
 * need water around them: packing nodes closer on a fixed board buys extra
 * nodes by taking away the water, and the islands stop being islands. A larger
 * world simply holds more of them, drawn smaller since the view scales to fit.
 */
export const MAP_SIZES = {
  small: { label: 'Малая', width: 1320, height: 860 },
  medium: { label: 'Средняя', width: 1600, height: 1000 },
  large: { label: 'Большая', width: 2150, height: 1340 },
} as const;

/** How stubbornly the unclaimed ground defends itself. */
export const MAP_DIFFICULTIES = {
  gentle: { label: 'Пусто', neutralGarrison: 0.2 },
  even: { label: 'Обжито', neutralGarrison: 0.35 },
  harsh: { label: 'Укреплено', neutralGarrison: 0.55 },
} as const;

export type MapSize = keyof typeof MAP_SIZES;
export type MapDifficulty = keyof typeof MAP_DIFFICULTIES;

export interface MatchSettings {
  seed: number;
  mapSize: MapSize;
  mapDifficulty: MapDifficulty;
  /** Bots at the table. The human is always seated first. */
  aiCount: number;
  /** How well those bots play. */
  difficulty: Difficulty;
}

export function defaultSettings(): MatchSettings {
  return { seed: 1, mapSize: 'medium', mapDifficulty: 'even', aiCount: 1, difficulty: 'normal' };
}

/**
 * One match: a map, a simulation clock and a bot for every seat but the
 * human's.
 *
 * The bots are updated inside the fixed step alongside the simulation, so they
 * think on simulated time rather than frame time — a slow machine gets the
 * same opponents as a fast one.
 */
export class Match {
  readonly state: GameState;
  readonly settings: MatchSettings;
  /** Size of the board this match is played on, in world units. */
  readonly world: { width: number; height: number };
  private readonly bots: Ai[];
  private readonly clock = new FixedTimestep(STEP_SECONDS);

  /**
   * @param resumed a board from a saved match, in place of a fresh one. The
   * bots are always new: a save keeps the board, not the opponents' train of
   * thought.
   */
  constructor(settings: MatchSettings, resumed?: GameState) {
    const aiCount = clamp(settings.aiCount, 1, MAX_OPPONENTS);
    this.settings = { ...settings, aiCount };

    const board = MAP_SIZES[settings.mapSize];
    this.world = { width: board.width, height: board.height };
    this.state = resumed ?? generateMap({
      width: board.width,
      height: board.height,
      seed: settings.seed,
      minDistance: NODE_SPACING,
      keepRatio: 0.5,
      playerCount: aiCount + 1,
      neutralGarrison: MAP_DIFFICULTIES[settings.mapDifficulty].neutralGarrison,
    });

    this.bots = [];
    for (let player = 1; player <= aiCount; player++) {
      this.bots.push(
        createAi(player, settings.difficulty, createRng(settings.seed * 31 + player * 7919)),
      );
    }
  }

  /** How far the clock sits into the next step, for render interpolation. */
  get alpha(): number {
    return this.clock.alpha;
  }

  advance(deltaSeconds: number): void {
    this.clock.advance(deltaSeconds, (dt) => {
      step(this.state, dt);
      for (const bot of this.bots) bot.update(this.state, dt);
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
