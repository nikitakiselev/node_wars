/**
 * How much of a node's garrison a drag sends.
 *
 * Committing everything is the common move, so it is what a plain drag does.
 * The modifiers are for holding something back: half to keep the node
 * defended, a quarter to poke at a neighbour and see what answers.
 */
export const SEND_FRACTIONS = { everything: 1, half: 0.5, probe: 0.25 } as const;

/** Only the parts of a pointer event this decision depends on. */
export interface SendModifiers {
  shiftKey: boolean;
  altKey: boolean;
}

export function fractionFor(modifiers: SendModifiers): number {
  if (modifiers.shiftKey) return SEND_FRACTIONS.half;
  if (modifiers.altKey) return SEND_FRACTIONS.probe;
  return SEND_FRACTIONS.everything;
}
