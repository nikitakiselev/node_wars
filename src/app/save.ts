import type { GameState } from '../core/state';
import { HUMAN, type Match, type MatchSettings } from './match';

/**
 * Format of a saved match.
 *
 * Bump this whenever the shape of a match changes — a new field on a node, a
 * rule that reads state written by an older build. A save from another version
 * is refused rather than loaded into a game that will misread it.
 */
export const SAVE_VERSION = 2;

const KEY = 'node-wars/save';

export interface SavedMatch {
  settings: MatchSettings;
  state: GameState;
}

/**
 * Writes the match to storage, and keeps quiet if it cannot.
 *
 * Storage fails for ordinary reasons — a full quota, private browsing — and
 * none of them are worth interrupting a game over.
 */
export function writeSave(storage: Storage, match: Match): void {
  try {
    storage.setItem(
      KEY,
      JSON.stringify({
        version: SAVE_VERSION,
        settings: match.settings,
        state: match.state,
      }),
    );
  } catch {
    // Nothing to do about it, and nothing worth saying.
  }
}

/** The saved match, or null if there is none this build can use. */
export function loadSave(storage: Storage): SavedMatch | null {
  let raw: unknown;
  try {
    const text = storage.getItem(KEY);
    if (!text) return null;
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(raw) || raw['version'] !== SAVE_VERSION) return null;
  if (!isRecord(raw['settings']) || !isRecord(raw['state'])) return null;

  const state = raw['state'];
  if (!looksLikeState(state)) return null;

  return {
    settings: raw['settings'] as unknown as MatchSettings,
    state: reviveState(state),
  };
}

/**
 * One line telling the player which match this is.
 *
 * A save is offered before anything is on screen, so "continue" has to mean
 * something on its own: the map it was played on, and how far along it was.
 */
export function describeSave(saved: SavedMatch): string {
  const mine = saved.state.nodes.filter((node) => node.owner === HUMAN).length;
  return `Карта ${saved.settings.seed} · ваших узлов ${mine} из ${saved.state.nodes.length}`;
}

export function clearSave(storage: Storage): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // As above.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A shallow check that this is a board and not something else entirely.
 *
 * Enough to catch a truncated or hand-edited save; the version already guards
 * against a save written by a build with different rules.
 */
function looksLikeState(state: Record<string, unknown>): boolean {
  for (const field of ['nodes', 'edges', 'adjacency', 'islands', 'wires', 'squads']) {
    if (!Array.isArray(state[field])) return false;
  }
  return Array.isArray(state['nodes']) && state['nodes'].length > 0;
}

function reviveState(state: Record<string, unknown>): GameState {
  const revived = state as unknown as GameState;

  // A node's wires are a list, and a node with none has an empty one. JSON
  // round-trips that faithfully; what it does not promise is that a
  // hand-edited or truncated file has a list there at all, so anything that
  // is not one becomes an empty one rather than a crash on the first step.
  revived.wires = (state['wires'] as unknown[]).map((wires) =>
    Array.isArray(wires) ? (wires as number[]) : [],
  );

  // A hub saved before the balancer learned to split a parcel was set to the
  // one mode that has since been renamed. Its successor is the nearest thing
  // to what the player asked for, so the setting is carried across rather
  // than the whole match being refused over one word.
  for (const node of revived.nodes) {
    if ((node.share as string) === 'balance') node.share = 'adaptive';
  }

  return revived;
}
