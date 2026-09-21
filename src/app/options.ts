/**
 * Switches read from the address bar.
 *
 * These are for testing and for watching a match run, not for players, so
 * they live in the URL rather than in the setup dialog.
 */
export interface PlayOptions {
  /** Whether losing window focus pauses the match. */
  autoPause: boolean;
  /**
   * Which controls to lay out for.
   *
   * "auto" asks the device, which is what a player gets. The other two are for
   * looking at the other layout without the other device: a desktop browser
   * never reports a coarse pointer, so the touch bar could otherwise only be
   * seen on a phone.
   */
  controls: ControlsOption;
}

export type ControlsOption = 'auto' | 'touch' | 'mouse';

const OFF = new Set(['off', '0', 'false', 'no', '']);
const CONTROLS = new Set<ControlsOption>(['auto', 'touch', 'mouse']);

/** @param search a location.search string, with or without the leading "?". */
export function readOptions(search: string): PlayOptions {
  const params = new URLSearchParams(search);

  return { autoPause: autoPause(params), controls: controls(params) };
}

function autoPause(params: URLSearchParams): boolean {
  if (!params.has('autopause')) return true;

  // A bare ?autopause counts as switching it off, the way a flag reads.
  const value = (params.get('autopause') ?? '').trim().toLowerCase();
  return !OFF.has(value);
}

function controls(params: URLSearchParams): ControlsOption {
  const value = (params.get('controls') ?? '').trim().toLowerCase() as ControlsOption;
  return CONTROLS.has(value) ? value : 'auto';
}
