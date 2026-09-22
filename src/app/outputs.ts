/**
 * What the rows in a balancer's settings are called.
 *
 * Nodes have no names and their ids mean nothing to a player, so an output is
 * named by the direction it lies in: that is the one label that can be matched
 * against the board without being told. It is not always enough on its own —
 * two neighbours in the same octant both come out "запад", and then the list
 * says nothing at all — so those are told apart by how far away they are,
 * which is the other thing the player can see.
 *
 * Pure geometry and wording, kept out of the panel that shows it so that it
 * can be read back by a test rather than by clicking.
 */
export interface Placed {
  id: number;
  x: number;
  y: number;
}

export function outputNames(hub: Placed, outputs: readonly Placed[]): Map<number, string> {
  const byBearing = new Map<string, Placed[]>();

  for (const target of outputs) {
    const bearing = bearingName(hub, target);
    byBearing.set(bearing, [...(byBearing.get(bearing) ?? []), target]);
  }

  const names = new Map<number, string>();

  for (const [bearing, sharing] of byBearing) {
    if (sharing.length === 1) {
      names.set(sharing[0]!.id, `На ${bearing}`);
      continue;
    }

    const ordered = [...sharing].sort((left, right) => away(hub, left) - away(hub, right));
    const ranks = RANKS[ordered.length] ?? [];
    ordered.forEach((target, index) => {
      names.set(target.id, `На ${bearing}, ${ranks[index] ?? `${index + 1}-й по близости`}`);
    });
  }

  return names;
}

/**
 * How two or three neighbours in one direction are told apart, nearest first.
 *
 * Past three the words run out and they are numbered, which reads worse and
 * hardly happens: a planar board does not often put four neighbours of one
 * node inside a single octant.
 */
const RANKS: Record<number, readonly string[]> = {
  2: ['ближний', 'дальний'],
  3: ['ближний', 'средний', 'дальний'],
};

const BEARINGS = [
  'восток',
  'юго-восток',
  'юг',
  'юго-запад',
  'запад',
  'северо-запад',
  'север',
  'северо-восток',
] as const;

/** Which way one node lies from another, in words. */
export function bearingName(from: Placed, to: Placed): string {
  // Screen coordinates, so a positive y is south rather than north.
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const eighth = Math.round((angle / (Math.PI * 2)) * 8 + 8) % 8;
  return BEARINGS[eighth]!;
}

function away(from: Placed, to: Placed): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}
