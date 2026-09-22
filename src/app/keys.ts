/**
 * What the modifier keys are called on the machine in front of you.
 *
 * Shift is Shift everywhere. The other one is Alt on a PC and Option on a
 * Mac, where the key is not marked "Alt" at all — and a tutorial that names a
 * key the keyboard does not have is the same kind of lie as telling somebody
 * with no mouse to right-click.
 *
 * Read once, because it cannot change while the page is open.
 */
function onMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  // `platform` is deprecated and still the only thing that answers this
  // plainly; the user agent is checked as well for the browsers that dropped it.
  const said = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/i.test(said);
}

export const HALF_KEY = 'Shift';
export const QUARTER_KEY = onMac() ? '⌥ Option' : 'Alt';
