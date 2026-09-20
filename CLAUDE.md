# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Node Wars is a browser strategy game: a randomly generated planar graph of
nodes, players sending points along edges to capture neighbours, and up to five
heuristic bots. TypeScript, PixiJS 8 (WebGL), Vite, Vitest.

## Commands

```bash
make dev                              # dev server on http://localhost:5173
make test                             # all tests
make check                            # tests + tsc --noEmit + production build
make deploy M="what changed"          # verify, commit, push, wait for Pages
npx vitest run src/ai/ai.test.ts      # one file
npx vitest run -t "goes all in"       # one test by name
npx vitest                            # watch mode
```

`make deploy` runs `make check` first, so a failing test or type error never
reaches the live site at https://nikitakiselev.github.io/node_wars/.

## The layering rule

`src/core` and `src/ai` must not import Pixi or touch the DOM. That is what
lets the whole rule set and the bots run under Vitest in Node in milliseconds.
Only `src/render`, `src/input` and `src/app/main.ts` know about the browser.

The renderer reads a `GameState` and paints it; it owns no rules. A squad is
one record (`from`, `to`, `amount`, `progress`) that the renderer expands into
a particle stream, so visual work can change freely without touching combat.

`src/core/fixtures.ts` is test-only. Nothing in the running game imports it.

## Time

The simulation advances on a fixed 30 Hz step (`FixedTimestep` in
`src/app/loop.ts`); the renderer runs at display rate and interpolates using
the `alpha` the clock exposes. Bots are updated inside that same fixed step, so
a slow machine faces the same opponents as a fast one.

Everything random comes from `createRng(seed)`. A seed reproduces a match
exactly — same map, same bot decisions — which is how map bugs get reported and
how `Match` replay tests work. Do not reach for `Math.random()` in core or ai.

## Node kinds

`NodeKind` is `base | fortress | farm`, rolled independently of size and never
given to a starting node. A fortress halves incoming *hostile* force
(`effectiveAttack` in `combat.ts`), so taking it costs double; reinforcing your
own is not halved. A farm doubles growth rate (`growthRateOf` in `growth.ts`)
but not capacity, which keeps node size an honest read of the cap.

Adding a kind touches five places: `KIND_WEIGHTS` (mapgen), `growthRateOf`
and/or `effectiveAttack`, `KIND_WORTH` (ai), `drawKindMark` (renderer) and the
legend in `index.html`. Kinds are shown by silhouette, never by colour — colour
already means ownership.

## Bot tuning that is load-bearing

Four properties in `src/ai/ai.ts` were arrived at by measuring bot-vs-bot
matches, and undoing any of them brings back matches that never end:

- **The safety cushion is a fixed number of points, not a percentage.** A
  percentage is unreachable at scale: two fronts growing in parity means
  neither ever gets a fifth ahead, and the match deadlocks with both hoarding.
- **Reserves flow down a hop-distance gradient to the nearest border**
  (`distanceToFront`). One-hop reinforcement leaves an empire's depth as dead
  weight — 43 nodes once ground against 9 on even terms.
- **Attacks subtract friendly squads already inbound.** Otherwise a second wave
  is spent on a node the first wave has taken.
- **Logistics has its own order budget**, separate from attacks
  (`supportOrders`). Sharing one budget let a busy front eat every order, so a
  quiet outpost was never reinforced and a pocket of neutral nodes could stay
  untaken for a whole match — an unwinnable map.

Letting reinforcements stack on a node that already has one inbound was tried
and measurably made things worse; it is deliberately refused.

`src/app/match.test.ts` plays whole matches and is the only thing that catches
game-level stalls — unit tests happily pass while the game deadlocks. Known
limitation encoded there: two identical bots often cannot finish each other
inside 20 minutes, because both reinforce continuously. The tests assert what
is measured — the board is always fully claimed, and an unfinished match is
lopsided rather than frozen — rather than an ideal.

## Winning and losing

A match ends when one player is left alive; alive means holding a node **or**
having a squad in the air. Requiring someone to hold every node was a bug — a
player could be wiped out while neutral nodes remained and the game would say
nothing at all. `isEliminated` in `simulation.ts` is also what the HUD uses to
tell a human they are out while bots fight on among themselves.

## Rendering pitfalls

- **Pixi keeps one current point across path calls.** Batching `moveTo`/`lineTo`
  pairs and stroking once chains every node to the last, and an `arc` without a
  preceding `moveTo` draws a leader line into it. Stroke each segment
  separately; `moveTo` the arc's start first.
- **Node rings are one `Graphics` per node**, redrawn only when a signature of
  owner and quantised fill changes. A single shared `Graphics` re-tessellates
  the whole board every frame and is most of what the game costs.
- **`renderer.draw()` does not put anything on the canvas.** The ticker normally
  renders; it is stopped while the setup dialog is open, so a frame drawn then
  needs an explicit `app.render()`.
- The frame rate is capped at 60 (`app.ticker.maxFPS`); the simulation is 30 Hz
  and uncapped drawing only heats the machine.

## Map generation

Poisson-disk points, Delaunay triangulation, then random thinning that removes
the longest edges first and never breaks connectivity. Delaunay is what keeps
the graph planar — **edges must never cross**, or players cannot read who is
connected to whom.

A starting node must have at least two neighbours and one neighbour it can take
with its opening points. The furthest-apart pair on a Delaunay mesh is almost
always two corner dead ends, which produces slow, lopsided openings and can wall
a player in permanently. Maps are drawn repeatedly and rejected until the
weakest opening is within 75% of the strongest.

## Deployment

The Vite `base` is derived from `GITHUB_REPOSITORY` at build time, because a
GitHub project page serves from `/<repo>/` and a root-relative build loads
blank. Locally it stays `/`.

Release logic lives in `scripts/deploy.sh`, not in the Makefile: macOS ships GNU
Make 3.81, which ignores `.ONESHELL` and runs every recipe line in its own
shell, so anything with an `if` falls apart there.

## Design decisions

`docs/design.md` records why the rules and architecture are what they are.
Node kinds are modelled (`NodeKind`) but only `base` exists; adding a
higher-income kind should be a table change, not new code paths.
