import type { GameState } from '../core/state';
import type { Match, MatchSettings } from './match';

/**
 * Format of a saved match.
 *
 * Bump this whenever the shape of a match changes — a new field on a node, a
 * rule that reads state written by an older build. A save from another version
 * is refused rather than loaded into a game that will misread it.
 */
export const SAVE_VERSION = 1;

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

  // JSON has no holes: an array with gaps comes back full of nulls, and a wire
  // of null is not the same as no wire at all.
  revived.wires = (state['wires'] as (number | null | undefined)[]).map((wire) =>
    wire === null ? undefined : wire,
  );

  return revived;
}
