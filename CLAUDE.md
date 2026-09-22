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

`NodeKind` is `base | fortress | farm | core | balancer`. The first four are
rolled independently of size and never given to a starting node; a balancer is
**built**, never dealt, which is what `CONVERSIONS` in `core/convert.ts` is
for. A fortress turns away part of an incoming *hostile* force
(`effectiveAttack` in `combat.ts`); reinforcing your own is never reduced. A
farm earns faster (`growthRateOf` in `growth.ts`) but holds no more, which
keeps node size an honest read of the cap.

A **core** earns for the network rather than for itself: while you hold it,
every node you own grows faster. There is exactly one per board, placed nearest
the centre after the openings are dealt — so it can never sit under a first
node — and it defends itself with twice a plain node's garrison. It is the one
node worth crossing the board for, and the reason two players meet before
minute ten rather than after it. The bot prices it as `1 + (aura - 1) × nodes
held`, so a bot with three nodes ignores it and a bot with thirty drops
everything: the same table tunes the rule and the bot together.

All of these scale with level and live in one table, `BY_LEVEL` in
`core/kinds.ts`: defence 1.2× to 2×, growth 1.4× to 2.5×, aura 1.12× to 1.28×,
and 1× at every level for a plain node. Only a finished fortress costs double to take. Read
them through `defenceMultiplier` / `growthMultiplier` rather than hardcoding a
constant anywhere.

A **balancer** earns nothing (growth 0× at every level) and keeps nothing:
whatever reaches it leaves on the next step, whole, to one of the neighbours it
is wired to — `flushBalancers` in `core/balancer.ts`, run from `step` right
after `flushWires`. `flushWires` deliberately does not ship from one: two rules
emptying the same node would argue about who sent what.

It is the one node that is **free to take**, because an empty node is taken by
a single point. That is the price of logistics that costs no orders, and it is
why a hub belongs in the rear — the bot's own rule refuses to build one within
two hops of the fighting.

Three ways to share, `SHARE_MODES` in `core/balancer.ts`, under the load
balancer's own names because that is what the node is. A new hub arrives on
**Adaptive** (`DEFAULT_SHARE`) — levelling is what a hub is built for, and
round robin is the choice a player makes after watching the default work. **Round Robin** sends
the whole parcel to the next output in turn. **Adaptive** and **Broadcast**
both cut the parcel up and send to every output at once; they differ only in
the weights — Broadcast splits evenly, Adaptive first brings whoever is behind
level with the fullest output and splits what is left over evenly, so it
degenerates into Broadcast once everything is level.

**Adaptive tops up to the leader rather than sharing out in proportion to how
far behind each one is.** Proportion overshoots: two outputs holding 10 and 40
would get the whole parcel sent to the first, which then passes the second,
and the two slosh back and forth for the rest of the match. Topping up settles
— they draw level and then rise together.

**A split parcel adds up to the parcel exactly, and `apportion` is what makes
that true.** Every share is rounded down first — rounding the other way would
print points — and the points rounding shaved off then go, one each, to
whichever shares lost the most to it. That is the largest-remainder rule.

Leaving the leftover on the hub instead was the first attempt and it is worth
knowing why it failed: the hub shipped it on the very next step as a second,
tiny squad chasing the first, and from the board it looked like the
balancer finding points from somewhere. Ties in the remainder are broken from
a moving start, so an even three-way split does not quietly favour the same
output for a whole match. `balancer.test.ts` checks every mode against every
awkward parcel size that the total sent equals the parcel.

A split parcel is one squad per output rather than one squad, so a hub with
five wires is five particle streams where a wire is one. Hubs are few — one
per twelve nodes for a bot — which is the only reason this is affordable; see
the wire measurements below before making them common.

**Building a node into a kind is a table too** — `CONVERSIONS` in
`core/convert.ts`, holding the price, the label and what a node must be. A
balancer wants `base`, `MAX_LEVEL`, three neighbours of your own, and 90
points; that last rule is what reads "some nodes on the board already are
hubs" back into the game, since a dead end has nothing to share out. Going
back to `base` is free, and only kinds somebody built can go back: a fortress
is terrain, and demoting it would be rewriting the map.

Adding a kind touches four places: placement in `mapgen.ts` — or a row in
`CONVERSIONS` if it is built rather than dealt — a row in `BY_LEVEL`
(`core/kinds.ts`), `drawKindMark` (renderer) and the kinds table in
`app/help.ts`, whose test refuses a kind whose numbers are not read from the
table the game plays by. A buildable kind also needs a mark on its button
(`CONVERSION_MARKS` in `main.ts`): a kind is a row, but a picture of one is a
picture. `mapgen.test.ts` asserts the generator deals no kind that appears in
`CONVERSIONS`. The bot values a node from those multipliers, so it needs no
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
- **That budget scales with the empire, and its size is a balance knob, not a
  detail.** One order moves one node one hop, so a flat budget is a flat pipe:
  it kept a chain of eight flowing and left half of a thirty-six node empire
  standing at capacity for a whole minute. `NODES_PER_SUPPORT_ORDER` is the
  measured middle of two failures — at 8 the rear flows and matches stop
  ending, only 2 of 10 settled, because two bots reinforcing that hard hold
  every front for ever; at 16 the matches come back and five nodes in
  thirty-six go idle again. Twelve is where both hold. `match.test.ts` is what
  catches the first failure and `src/ai/logistics.test.ts` the second; neither
  catches both, and a chain of eight nodes catches neither.
- **Support is scored on where it is going**, not only on where it comes from:
  how badly the destination is outgunned, and whether it is a fortress worth
  holding. Scoring the source alone made logistics blind — reserves went to the
  nearest border whether or not anything was happening there.
- **A fortress on the border may build itself up**, out of surplus only
  (`FORTIFY_RESERVE`). The rear-only rule was exactly backwards for the one
  kind of node that exists to be defended from; bots now finish matches with
  their crossings at level three to five.

- **A node it cannot take is besieged, not ignored** (`siege` in `ai.ts`). A
  node holding more than its own ceiling earns nothing back, so points taken
  off it stay off while the attacker's own nodes grow theirs again — a wave
  that bounces is a trade the attacker wins. Without this the bot stood at full
  strength for the rest of the match against a human who had piled ten thousand
  points onto the one node between them, shuffling reserves behind its own line
  and never firing. Two guards keep it from becoming "attack regardless": the
  target must still be over its ceiling after the hit, and the attacking node
  must be full, because a node still filling up is growing into something and a
  full one's points are dead weight until spent.

- **Bots build hubs, but under a limit** (`NODES_PER_HUB`, `buildHubs`). A
  balancer is logistics that costs no orders at all — exactly the pipe
  `NODES_PER_SUPPORT_ORDER` was measured to size — so it is capped at one per
  twelve nodes held, and only two hops back from the fighting. Measured over
  ten bot-vs-bot matches: all ten settle either way, average 5.0 minutes either
  way, nodes left standing at capacity 44 without hubs and 40 with. The limit
  turns out not to be what binds — eligibility is, since a node needs level
  five, three neighbours of its own and 240 points — but it is the knob that
  stops the failure the support budget already documents.
- **A bot's hub is wired down the hop gradient and nowhere else** (`aimHubs`).
  Wired to every neighbour it would hand points back to whatever just fed it,
  round the same two nodes for the rest of the match. Redone every decision,
  because the front moves and a wire that pointed forward last minute may not
  now.

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

The standings are a coloured dot and one number apiece, on every screen: the
names and the word «узлов» cost a line and say nothing the tide bar directly
above has not already said. There is one wording, not two — an earlier version
built both and let the stylesheet choose, which was a second thing to keep in
step for no gain.

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

**`renderer.zoom` is the level the player has dialled in, not the scale from
world units to pixels.** Zoom 1 means the whole board fitted, so the real
scale is the fit times the zoom (`Camera.transform`). Anything that needs the
screen size of a world thing measures it with `toScreen` — `ringFor` and
`anchorFor` both do. Rebuilding the scale by hand looked right on a desktop,
where the fit is near 1, and threw every button on the action ring twice as
far from its node on a phone, where the board is squeezed to fit.

**An action's price is written beside its own button, on the same spoke**
(`.actions__price`), and everything else it has to say — which level it is
going to, what the next one is worth — lives on the button's label instead of
on the board. A line under the ring spelling out "Уровень 2 → 3, за 40" cost a
whole row of the board to say what a number says.

**Nothing but the ring comes up while a node is selected.** The × on a supply
wire is held back (`paintWireControl`): it would appear beside the ring, on a
wire the player never asked about, and the two would be offering different
meanings for the same click at the same moment.

The ring of actions around a selected node is laid out **evenly round the
circle from the top**, and the board behind it is **dimmed rather than
blurred**, with a soft hole around the node (`paintDim` in `main.ts`). Three
things there are load-bearing. The hole exists because this is a real-time
game: a board that cannot be read is a board the other player is moving on
unseen, so the node, its ring and its neighbours stay lit. The layer never
takes a pointer event and is **never taken out of the document** — hiding it as
well as fading it gave the fade two switches, and after the first time it was
put away the class went on a layer that was still `display:none`. And the hole
is written through custom properties, only when it has actually moved, because
this runs on every frame of a sixty-hertz loop.

Its state (`lastHole`) is declared at the top of the file with the rest, not
beside `paintDim`: `fitBoard` paints the overlays before the first frame, and
a `let` further down is in its dead zone when it does — a black screen, not a
subtle bug. This is the same rule as the zoom rail's.

**Verifying any of this in an automated browser tab is misleading.** The tab
runs in the background, where `requestAnimationFrame` and CSS transitions do
not advance: the ring stays where it was and the dimming reads as opacity 0
however correct the stylesheet is. Read the computed style with the transition
removed, or look at it by hand.

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
wire. `state.wires[nodeId]` is a **list**, always present and often empty: an
ordinary node is allowed one, so laying a second replaces the first, and a
balancer is allowed one per neighbour. A wire is therefore identified by the
pair of nodes it joins rather than by its source, which is what lets the × land
on the right one. `flushWires` runs inside `step`, after growth, and drops any wire whose
ends are no longer both held by one player.

Wires carry but never conquer — the target must already be yours. That is the
guardrail that keeps the game a game: with auto-attack the whole match would
play itself from the first minute.

**Bots use wires only for their hubs, and the history is instructive.** Giving
them the player's own mechanism outright worked on every gameplay measure — the rear flowed, the
damage doubled — and cost a third of the frame rate: the bots wired nearly
every node they held, 58 of 60 in a measured match, and `drawWires` clears one
shared `Graphics` and issues a separate `stroke()` for every dash of every
wire, every frame. Two wires cost nothing; sixty are most of a frame. Fixing
the bot's own logistics instead beat wires on all three numbers at once — see
the budget note in the bot section.

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

**Changing what the game does is not finished until the rules panel says so.**
A new action, a new kind, a rule that works differently from how it used to —
the player learns all of it here and nowhere else, and a panel that describes
last week's game is worse than no panel, because it is believed. Treat it the
way the numbers are already treated: not a document kept alongside the code,
but part of the change itself.

Its budget is real and the tests hold it: a section may carry at most four
lines and a line at most a hundred characters. When something new has to go
in, the question is what it replaces or which section it belongs to — not
whether to write a fifth line. Saying less about more is the job.

And it has two wordings. A sentence about giving an order has to exist for a
mouse and for a finger, and the touch one may not name a key or a button that
is not there; that is checked.

## The developer switch

`?dev` turns it on; `core/dev.ts` holds it as a value that is **set**, never
one that is read from the URL there — core must not know an address bar
exists, or the rules and the bots stop running under Vitest in Node.
`app/options.ts` reads the address and `main.ts` hands the answer over, the
same road `?autopause` and `?controls` take.

It makes building free: `upgradeCost` and `costOf` both return 0, so the
button, the bots, the rules panel and the rule that charges cannot quote
different numbers at each other. **Free is a price, not a way past a
condition** — the level ceiling and the crossroads rule still hold.

It is deliberately not part of `GameState` and never travels in a save: a
board built up for nothing is not one anybody should be able to hand on. And
it is worn on the edge of the window in amber, because a switch that changes
the rules has to be visible while it is on.

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
- **Every dash of every supply wire is a particle, not a stroke.** The dashes
  run, so whatever draws them is rebuilt every frame, and a `Graphics` whose
  path changed is re-tessellated on the CPU. Measured with 53 wires on screen,
  against a 16.7ms frame:

  | how | cost |
  |---|---|
  | a `stroke()` per dash | 1.83 ms |
  | one `stroke()` per player | 0.94 ms |
  | a `TilingSprite` per wire | 1.31 ms |
  | **a particle per dash** | **0.15 ms** |

  The tiling sprite is the instructive one: it looks like the cheap answer —
  the geometry never changes and the dashes move by texture offset — but each
  one is its own draw call with its own uniforms, and fifty of those cost more
  than one tessellated batch. Particles win because they share a texture and a
  container, which is one draw call for the whole board. It is the same thing
  the squad streams already do.
- **`?autopause=off` keeps a match running in an unfocused window**, which is
  what automated runs want; `readOptions` in `app/options.ts` parses it.
  Escape still pauses by hand. `?controls=touch` lays the phone controls out on
  a machine with a mouse, which is the only way to look at them without a phone.
- **One function owns the clock.** `updateRunning` in `main.ts` decides whether
  the ticker runs, because two separate things stop it — the setup dialog and
  the pause — and letting each call start/stop directly meant whoever spoke
  last won. **A dialog over a live match does not stop it**: `covered()` names
  only setup and resume, behind which sits a board nobody is playing yet. The
  balancer's panel is a setting on a node in a match that is going on, so the
  match goes on — and because it does, the panel rebuilds its rows only when
  the outputs change and moves only their numbers on the frame, or the × would
  be taken out from under the cursor between press and release.
- **Escape puts away one thing at a time**: a dialog, then the selected node,
  then the pause. A ring of buttons over the board is the nearest thing to a
  dialog, and letting go of a node should not also cost you the board.
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

**Islands differ in size, and that is deliberate.** Every cell used to build the
same island, so every board was the same six clumps of seven to eleven nodes and
a seed only moved the edges. Now each island draws its own size, and two
neighbouring cells sometimes hold one island between them — a medium board comes
out as a landmass of seventeen to twenty-two with four or five islands of six to
ten around it. Two guards keep it sane: a shrunk island is never taken below the
radius that yields `MIN_ISLAND_POINTS + 2`, or it is thrown away and the board
loses a third of itself, and cells only merge when there is room to spare
(`MERGE_HEADROOM`) — judged by the room in a cell rather than the number of
them, because a small board and a medium one get the same grid and differ only
in how big its cells are.

**The grid is counted along each side, not split from the total area.** Working
from area and then dividing by aspect ratio gave a tall board cells that were
tight in the narrow direction; an island's radius is cut from the tighter side,
so the long side of every cell was wasted. Measured: standing a board on its end
cost it **thirty per cent of its nodes**, every seed, which is exactly the board
a phone plays. Counting `floor(width / cell)` and `floor(height / cell)` gives a
board and the same board turned a quarter the same grid, transposed — 468
against 470 nodes over eight seeds. `CELL_TOLERANCE` is for near misses: a small
board once came out twenty-four pixels short of a third column.

Map size changes the size of the world, not the spacing of nodes; packing nodes
closer on a fixed board buys extra nodes by taking away the water. A bridge is
placed only where it clears every other node by a full step, or it draws over
what it joins.

Within an island: Poisson-disk points, Delaunay triangulation, then random
thinning that removes
the longest edges first and never breaks connectivity. Delaunay is what keeps
the graph planar — **edges must never cross**, or players cannot read who is
connected to whom.

**`DEFAULT_KEEP_RATIO` decides whether a board is a network or a chain, and it
is the most load-bearing number in map generation.** At 0.5, where it started,
a medium board gave the average island node 2.3 neighbours — the one it came
from and the one it was going to — with eleven dead ends in sixty-nine nodes
and ten loops on the whole board. Every front was one node wide; nothing could
be flanked, gone round or cut off, and that is most of why matches felt the
same. At 0.7 the same boards have 2.9 neighbours a node, three or four dead
ends and twenty-seven loops, and bot-against-bot matches settle in 4.3 minutes
instead of 6.4. Raising it further flattens out: 0.8 buys edges and gives the
time back. `mapgen.test.ts` guards the shape — average degree, share of dead
ends, and loops beyond a spanning tree — rather than the number itself.

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
Kinds are data: `BY_LEVEL` says what one is worth, `CONVERSIONS` says what it
costs to build, and adding one should be rows in those tables rather than new
paths through the code.
