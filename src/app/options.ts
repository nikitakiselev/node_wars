/**
 * Switches read from the address bar.
 *
 * These are for testing and for watching a match run, not for players, so
 * they live in the URL rather than in the setup dialog.
 */
export interface PlayOptions {
  /** Whether losing window focus pauses the match. */
  autoPause: boolean;
}

const OFF = new Set(['off', '0', 'false', 'no', '']);

/** @param search a location.search string, with or without the leading "?". */
export function readOptions(search: string): PlayOptions {
  const params = new URLSearchParams(search);
  if (!params.has('autopause')) return { autoPause: true };

  // A bare ?autopause counts as switching it off, the way a flag reads.
  const value = (params.get('autopause') ?? '').trim().toLowerCase();
  return { autoPause: !OFF.has(value) };
}
