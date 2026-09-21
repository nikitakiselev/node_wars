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

## Levels

A node's size **is** its level, one to five, and `capacity`/`radius` are
derived from it. `applyLevel` in `levels.ts` is the only thing that writes any
of the three, so they cannot drift apart. Upgrading costs the capacity it adds
and is paid from the node's own garrison (`upgradeNode`); capturing a node
**from another player** knocks it down a level, inside `resolveArrival`;
neutral ground keeps its level, since nobody built it up.

Two consequences worth knowing before changing things here. Map margins are cut
for `radiusForLevel(MAX_LEVEL)`, not for the level a node starts at, or a node
built up near the edge hangs off the board. And the renderer sizes its sprites
at build time, so `drawNodes` resizes them when `lastLevel` no longer matches —
an upgrade physically changes how big a node is.

In the bot, building comes **before** shipping reserves: with logistics first, a
full rear node was emptied every decision and never saved up for anything.
Upgrades measurably made matches more decisive, not less — 8/10 settled versus
4/10 before.

## Node kinds

`NodeKind` is `base | fortress | farm`, rolled independently of size and never
given to a starting node. A fortress turns away part of an incoming *hostile* force
(`effectiveAttack` in `combat.ts`); reinforcing your own is never reduced. A
farm earns faster (`growthRateOf` in `growth.ts`) but holds no more, which
keeps node size an honest read of the cap.

Both bonuses scale with level and live in one table, `BY_LEVEL` in
`core/kinds.ts`: defence 1.2× to 2×, growth 1.4× to 2.5×, and 1× at every
level for a plain node. Only a finished fortress costs double to take. Read
them through `defenceMultiplier` / `growthMultiplier` rather than hardcoding a
constant anywhere.

Adding a kind touches four places: `KIND_WEIGHTS` (mapgen), a row in
`BY_LEVEL` (`core/kinds.ts`), `drawKindMark` (renderer) and the legend in
`index.html`. The bot values a node from those multipliers, so it needs no
separate table. Kinds are shown by silhouette, never by colour — colour
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
- **Support is scored on where it is going**, not only on where it comes from:
  how badly the destination is outgunned, and whether it is a fortress worth
  holding. Scoring the source alone made logistics blind — reserves went to the
  nearest border whether or not anything was happening there.
- **A fortress on the border may build itself up**, out of surplus only
  (`FORTIFY_RESERVE`). The rear-only rule was exactly backwards for the one
  kind of node that exists to be defended from; bots now finish matches with
  their crossings at level three to five.

Letting reinforcements stack on a node that already has one inbound was tried
and measurably made things worse; it is deliberately refused.

`src/app/match.test.ts` plays whole matches and is the only thing that catches
game-level stalls — unit tests happily pass while the game deadlocks. Known
limitation encoded there: two identical bots often cannot finish each other
inside 20 minutes, because both reinforce continuously. The tests assert what
is measured — the board is always fully claimed, and an unfinished match is
lopsided rather than frozen — rather than an ideal.

## Touch, and the phone

`src/input/gestures.ts` turns touches into four intentions — `drag`, `tap`,
`pan`, `pinch` — and nothing else; `PointerControls` is still the only thing
that knows what an intention means. The mouse keeps its own branch, because
buttons and modifiers have no equivalent on glass, but both branches meet in
one `beginDrag`/`finishDrag`, so there is one set of rules about what a drag
does rather than two.

Four decisions in there are load-bearing:

- **A finger that lands on your own node drags; anything else pans.** That is
  what lets one finger mean both things without a mode, and it is the rule the
  mouse already used.
- **Thresholds are measured in canvas pixels, never world units.** `CLICK_SLOP`
  on the mouse path is in world units, so at zoom 4 it is two screen pixels —
  fine for a cursor, useless for a fingertip.
- **A second finger cancels the drag it interrupts.** A pinch that threw a
  garrison at a neighbour would be unforgivable, and a stray second finger is
  common.
- **A finger left over from a pinch may pan and nothing else.** Otherwise
  lifting one finger drops you back into a drag you never started.

What a modifier used to say is read off a sticky bar instead: `SEND_MODES` in
`fractions.ts` — everything, a half, a quarter, or a wire. A modifier still
wins over the bar, so a mouse plays exactly as it always did. The bar, the
pause button and the bigger hit targets are switched on by a `touch` class on
`<html>`, not by `@media (pointer: coarse)`, because `?controls=touch` has to
be able to overrule the device — a desktop browser never reports a coarse
pointer, and the phone layout would otherwise need a phone to look at.

The bottom safe-area band is deliberately **not** reserved: iOS keeps about
34pt for the home indicator, which draws over whatever is under it and stays
legible on a dark board, so giving it a band of its own only throws the room
away. The HUD keeps none of it — the bar sits flush on the edge of the glass,
and the indicator crosses it, which is what the indicator is designed to do.
The top is the opposite case: the status bar is drawn over the
board, so the strip behind the clock and the scoreboard is painted solid down
to `--hud-top` — the same measurement the board's insets are taken from — and
then faded, since a zoomed-in board pans nodes up underneath both. The strip is
positioned, so the scoreboard is given `position: relative` as well; otherwise
it paints under the very thing meant to sit behind it.

The standings shrink to a coloured dot and one number apiece: the names and
the word «узлов» cost a line of a screen with none to spare, and the tide bar
directly above already says who holds how much. Both wordings are built into
the row and kept up to date; the stylesheet decides which one shows, so
`paintHud` stays one path.

On a phone the bottom is **one row**: the mode pills and a ☰ button, and
everything else — rules, a new match, saving, the seed — lives behind that
button on the pause screen, which already existed. Four words plus a fifth do
not fit across a phone, so the menu is a mark rather than a label. The bottom
strip is the most expensive place on the screen, and none of those controls is
wanted during a move.

Every control has a **pressed** state, and hover lives inside
`@media (hover: hover)`. A finger has no hover: the only feedback a tap can
give is what happens while it is held down, and an unguarded `:hover` leaves a
button on iOS looking hovered long after the finger has gone. Filled pills are
pressed by darkening, outlined ones by filling faintly; both shrink, which is
the part that reads as a press rather than as a state.

Zoom has a rail down the right edge as well as the pinch (`.zoom` in
`main.ts`). A pinch takes two fingers, which takes both hands; the rail is the
same zoom under the thumb of the hand already holding the phone. It reads
`renderer.zoom` rather than keeping a number of its own, so pinching moves its
thumb too — one zoom, shown twice. Anything that paints it belongs in
`paintOverlays`, and **anything the first frame touches has to be declared
before `openStart()` runs**: the consts are not hoisted, and a rail declared
below it throws on the opening frame.

`help.ts` takes the same argument. Telling a player to right-click on a screen
with no mouse is the same kind of lie as a stale number, so the rules panel
has a touch wording for every sentence about giving an order — and its tests
check that the touch version never mentions a key or a button.

The board is stood on its end when the screen is (`boardFor` in `match.ts`):
the same water and the same spacing, turned a quarter, because a 1.6:1 board
fitted into a phone held upright draws nodes four pixels wide. The setting
travels in the save, and a save written before it existed has no `portrait`
field at all — which reads as landscape, which is what every one of those
matches was. That is the one kind of change that does **not** need
`SAVE_VERSION` bumped: a field added whose absence means what it used to.

Camera insets are measured from the HUD rather than assumed
(`renderer.setInsets`, `fitBoard` in `main.ts`), because the top block grows
with the number of players, the bottom one with the mode bar, and on a phone
both sit inside safe-area padding whose size only the browser knows.

## On the home screen

**The status bar is opaque (`apple-mobile-web-app-status-bar-style: black`),
and that is a layout decision, not a colour one.** `black-translucent` lifts
the page up under the status bar without making it any taller: measured on an
iPhone, a 956pt screen against an 894pt window — the 62pt of status bar came
straight off the *bottom*, where the board was left cut off above a band
nothing could draw into. Opaque puts the page below the status bar and its
bottom reaches the bottom of the glass. Those numbers came from a temporary
readout in the pause menu — when a layout is wrong on a device you cannot
inspect, printing `innerHeight`, `screen.height` and the insets on screen
settles in one screenshot what guessing does not settle at all.

`public/manifest.webmanifest` and `public/sw.js` make it installable and
openable with no network, which is the whole point of a game you pick up in a
queue. The worker precaches nothing generated: hashed file names could never be
kept in step with a list, so it caches what the game asks for, with two rules —
a hashed asset can never change behind its name and is served from the cache
for ever, and the page itself is fetched from the network when there is one, so
that a new build can get in at all.

**Two things about an installed app that are not obvious.** iOS reads
`apple-mobile-web-app-capable` and the status-bar style **when the icon is
added to the home screen** and keeps them in the bookmark; an installed app
never picks up a change to either, however many times the HTML is replaced.
Changing those means asking the player to re-add the icon — there is no code
fix. And a home-screen app can sit suspended for days and come back without
navigating, so nothing asks whether a new build exists: `registerWorker` calls
`registration.update()` on every wake and reloads the page when a new worker
takes charge, saving the match first.

**Bump `CACHE` in `sw.js` whenever a file with no hash in its name changes** —
the page shell, the manifest, an icon — or an installed phone keeps serving the
old one for ever. A hashed asset never needs it; its name already changed.

Two things follow. Manrope is carried in the build (`src/fonts`), not fetched
from Google, since a game that opens in a tunnel cannot wait on a font server.
And `scripts/icons.mjs` draws the icons and is run by hand — the PNGs are
committed, because a build must not depend on a drawing step. The mark is the
game's verb, a node throwing its garrison at a neighbour, rather than a picture
of the board: a whole network turns to mush at the sixty pixels an icon is
actually looked at.

## Supply wires

`core/wires.ts`. A player can point one of their nodes at an adjacent node
they also own; once the source fills up it ships half its garrison down the
wire. `flushWires` runs inside `step`, after growth, and drops any wire whose
ends are no longer both held by one player.

Wires carry but never conquer — the target must already be yours. That is the
guardrail that keeps the game a game: with auto-attack the whole match would
play itself from the first minute. Bots do not use wires; they have the same
logistics built in, so wires only close the clicking gap.

Growth clamps at capacity, so there is never a literal overflow to forward —
"send on overflow" is realised as "at capacity, send half of what it holds".
Half of what it *holds*, not everything above a fixed garrison: a node sitting
on a stockpile has to stay worth attacking rather than becoming a free capture
the moment it forwards.

## Winning and losing

A match ends when one player is left alive; alive means holding a node **or**
having a squad in the air. Requiring someone to hold every node was a bug — a
player could be wiped out while neutral nodes remained and the game would say
nothing at all. `isEliminated` in `simulation.ts` is also what the HUD uses to
tell a human they are out while bots fight on among themselves.

## The rules panel

`app/help.ts` is the single source of the in-game rules, opened from the
footer, the setup dialog and the pause screen. Every number in it —
capacities, upgrade costs, the fortress and farm multipliers — is read from
the tables the game plays by, so tuning balance cannot leave the help saying
something else. Its tests assert exactly that, plus that it stays short.

## Saving

`app/save.ts` writes the match to `localStorage` under one key, stamped with
`SAVE_VERSION`. **Bump that version whenever the shape of a match changes** — a
new field on a node, a rule that reads state an older build never wrote. A save
from another version is refused outright rather than loaded into a game that
would misread it, and so is anything truncated or unparseable.

A save is what the player is asked about first: with one in storage the game
opens the resume prompt, and the setup dialog is reached only by turning that
offer down. With nothing saved there is nothing to ask, so setup opens
straight away.

Three things worth knowing. JSON has no holes, so `wires` comes back full of
nulls and has to be revived — a wire of null is not the same as no wire.
A resumed match gets fresh bots: a save keeps the board, not the
opponents' train of thought. And the board behind the setup dialog is a
preview of a match nobody started, so `saveNow` refuses to write while a
dialog is open — leaving the page there used to overwrite the real save with
a board the player had never played.

Saving runs off the render loop, which stops when the game is paused or the tab
is hidden — exactly when a tab tends to get closed — so `pagehide` and
`visibilitychange` write it down as well. Those hooks, not the interval, are
what actually protect a match.

Measured before worrying about the cost: a save is 11.6 KB and takes 0.084 ms
all in, against a 16.7 ms frame. Half a percent of one frame every two seconds. Those hooks, not the interval, are
what actually protect a match.

Measured before worrying about it: a save is 11.6 KB and costs 0.084 ms all in,
against a 16.7 ms frame. Half a percent of one frame every two seconds.

## The camera

`render/camera.ts` owns where the board sits on screen and is deliberately free
of Pixi, because the arithmetic is the part that goes wrong. Zoom 1 is the
whole board fitted inside the HUD insets and is also the floor — there is
nothing outside the board to look at — and panning is clamped so it can never
be dragged into empty space.

**The insets bound the fit, not the pan.** They exist so the whole board is
visible beside the HUD at rest; the HUD is see-through and the board is drawn
under it, so once the board is bigger than the screen it may be dragged until
its edge reaches the *screen's* edge. Clamping the pan to the HUD-free room
instead leaves a band of empty water under the buttons that no amount of
dragging removes — it looks like the board is cut off. The renderer applies `camera.transform` to its
world container, so `toWorld` and `toScreen` keep working without knowing
anything about zoom.

## When it does not start

`main.ts` registers `error` and `unhandledrejection` handlers **before** it
touches Pixi, and anything they catch is written on screen. The board is a
canvas: code that never runs leaves a black rectangle and an empty HUD, which
looks exactly like a game that does not work, and says nothing to the player or
to whoever has to fix it. A failure inside the very first `await` has to land
there too, which is why the handlers come first in the file.

## Rendering pitfalls

- **Point totals are written with `formatPoints`** (`core/format.ts`), which
  truncates to `1.2K` / `12K` / `2.5M`. Garrisons reach the thousands once
  nodes are built up, and four digits do not fit inside a circle. It truncates
  rather than rounds so a node never claims points it does not have.

- **Pixi keeps one current point across path calls.** Batching `moveTo`/`lineTo`
  pairs and stroking once chains every node to the last, and an `arc` without a
  preceding `moveTo` draws a leader line into it. Stroke each segment
  separately; `moveTo` the arc's start first.
- **Node rings are one `Graphics` per node**, redrawn only when a signature of
  owner and quantised fill changes. A single shared `Graphics` re-tessellates
  the whole board every frame and is most of what the game costs.
- **`?autopause=off` keeps a match running in an unfocused window**, which is
  what automated runs want; `readOptions` in `app/options.ts` parses it.
  Escape still pauses by hand. `?controls=touch` lays the phone controls out on
  a machine with a mouse, which is the only way to look at them without a phone.
- **One function owns the clock.** `updateRunning` in `main.ts` decides whether
  the ticker runs, because two separate things stop it — the setup dialog and
  the pause — and letting each call start/stop directly meant whoever spoke
  last won.
- **`renderer.draw()` does not put anything on the canvas.** The ticker normally
  renders; it is stopped while the setup dialog is open, so a frame drawn then
  needs an explicit `app.render()`.
- The frame rate is capped at 60 (`app.ticker.maxFPS`); the simulation is 30 Hz
  and uncapped drawing only heats the machine.

## Map generation

Boards are islands joined by bridges (`core/islands.ts`). Each island is grown
around its own centre — partitioning an even scatter afterwards gives islands
only the edge list can see. A crossing is a separate fortress node standing in
the water: fortifying both shores instead makes a wall facing a wall that
neither side can attack into, measured at 1 settled match in 10 against 7 with
bridges. Every edge joins two nodes of one island or an island to a bridge.

Map size changes the size of the world, not the spacing of nodes; packing nodes
closer on a fixed board buys extra nodes by taking away the water. A bridge is
placed only where it clears every other node by a full step, or it draws over
what it joins.

Within an island: Poisson-disk points, Delaunay triangulation, then random
thinning that removes
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
