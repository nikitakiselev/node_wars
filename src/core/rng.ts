/**
 * Seeded pseudo-random generator (mulberry32).
 *
 * The whole simulation draws from one of these, so a seed reproduces a match
 * exactly: same map, same AI decisions. That makes bugs reportable as a number.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], both inclusive. */
  range(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  /** Uniformly chosen element. */
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const float = (min: number, max: number): number => min + next() * (max - min);

  const range = (min: number, max: number): number =>
    min + Math.floor(next() * (max - min + 1));

  const pick = <T,>(items: readonly T[]): T => {
    const item = items[Math.floor(next() * items.length)];
    if (item === undefined) throw new Error('pick() called on an empty array');
    return item;
  };

  return { next, range, float, pick };
}
