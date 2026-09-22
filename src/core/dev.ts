/**
 * The developer switch.
 *
 * One boolean the whole game can ask about, so that trying something out does
 * not mean playing a match first. It is switched on from the address bar —
 * `?dev` — and read wherever a rule wants to know.
 *
 * It lives in `core` as a value that is *set*, never as one that is read from
 * the URL here: core must not know that an address bar exists, or the rules
 * and the bots stop running under a test runner in Node. `app/options.ts`
 * reads the address and `app/main.ts` hands the answer over, which is the
 * same road every other switch in the game takes.
 *
 * It is deliberately not part of `GameState`. It is not something a match is
 * played with and it must never travel in a save: a board built up for free
 * is not a board anybody should be able to hand to somebody else.
 */
let on = false;

export function setDevMode(next: boolean): void {
  on = next;
}

export function devMode(): boolean {
  return on;
}
