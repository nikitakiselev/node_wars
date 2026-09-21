/**
 * How much of a node's garrison a drag sends.
 *
 * Committing everything is the common move, so it is what a plain drag does.
 * The modifiers are for holding something back: half to keep the node
 * defended, a quarter to poke at a neighbour and see what answers.
 */
export const SEND_FRACTIONS = { everything: 1, half: 0.5, probe: 0.25 } as const;

/**
 * What a drag means, for a player who has no keyboard to hold down.
 *
 * On a touch screen the choice is sticky and shown on a bar rather than held
 * in a modifier, so the player can always read what the next drag will do.
 * Laying a wire belongs on that bar too: it is the other thing a drag between
 * two nodes can mean, and it carries no fraction because it ships nothing —
 * the wire does that later, on its own.
 */
export const SEND_MODES = {
  all: { label: 'Всё', fraction: SEND_FRACTIONS.everything },
  half: { label: '½', fraction: SEND_FRACTIONS.half },
  probe: { label: '¼', fraction: SEND_FRACTIONS.probe },
  wire: { label: 'Провод', fraction: null },
} as const satisfies Record<string, { label: string; fraction: number | null }>;

export type SendMode = keyof typeof SEND_MODES;

/** Only the parts of a pointer event this decision depends on. */
export interface SendModifiers {
  shiftKey: boolean;
  altKey: boolean;
}

export function fractionFor(modifiers: SendModifiers, mode: SendMode = 'all'): number {
  // A modifier is a deliberate override of whatever the bar says, and a mouse
  // that used to play this way should go on playing this way.
  if (modifiers.shiftKey) return SEND_FRACTIONS.half;
  if (modifiers.altKey) return SEND_FRACTIONS.probe;
  return SEND_MODES[mode].fraction ?? SEND_FRACTIONS.everything;
}
