/**
 * Writes a point total short enough to sit inside a node.
 *
 * Garrisons reach the thousands once nodes are built up and reinforced, and
 * "1247" does not fit in a circle. Values are truncated rather than rounded,
 * so a node never claims points it does not have.
 */
export function formatPoints(value: number): string {
  const sign = value < 0 ? '-' : '';
  const size = Math.abs(value);

  if (size < 1000) return `${sign}${Math.floor(size)}`;
  if (size < 1_000_000) return `${sign}${scaled(size / 1000)}K`;
  return `${sign}${scaled(size / 1_000_000)}M`;
}

/**
 * One decimal below ten, none above: at "12.3K" the tenth is noise, and the
 * two characters it costs are the ones that make the number overflow.
 */
function scaled(value: number): string {
  if (value >= 10) return String(Math.floor(value));

  const tenths = Math.floor(value * 10) / 10;
  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
}
