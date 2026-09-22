import {
  Application,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Sprite,
  Text,
  TilingSprite,
} from 'pixi.js';
import { formatPoints } from '../core/format';
import { MAX_LEVEL } from '../core/levels';
import { Camera, type Insets } from './camera';
import { NEUTRAL, type GameNode, type GameState, type Squad } from '../core/state';
import { COLORS, FONT_FAMILY, factionOf } from './theme';
import { DASH_TILE, createBrushes, type Brushes } from './textures';

/** What the renderer needs to know about the player's current gesture. */
export interface DragHint {
  from: number | null;
  cursor: { x: number; y: number } | null;
  targets: ReadonlySet<number>;
  /** The node the player has picked out to work on, if any. */
  selected: number | null;
  /** True while the drag in progress is laying a supply wire. */
  wiring: boolean;
}

const EMPTY_DRAG: DragHint = {
  from: null,
  cursor: null,
  targets: new Set(),
  selected: null,
  wiring: false,
};

interface NodeView {
  glow: Sprite;
  disc: Sprite;
  ring: Graphics;
  label: Text;
  lastOwner: number;
  lastLabel: string;
  /** What the ring last drew; redrawing is skipped while this holds. */
  lastRing: string;
  /** Level the sprites were sized for; an upgrade makes the node bigger. */
  lastLevel: number;
}

interface Mote {
  /** How far this mote trails the squad's head, in edge fractions. */
  lag: number;
  /** Sideways offset from the centre line, in world units. */
  lateral: number;
  /** Phase of its drift, so the stream shimmers instead of marching. */
  phase: number;
}

interface Flash {
  sprite: Sprite;
  /** Size at birth; the sprite's own width changes as it expands. */
  baseSize: number;
  age: number;
}

const FLASH_SECONDS = 0.55;

/**
 * Screen-space room reserved for the HUD, in CSS pixels.
 *
 * A starting guess only: the real HUD is measured once it is on screen, since
 * its height moves with the number of players, the mode bar and, on a phone,
 * whatever the notch and the home indicator take.
 */
const INSETS: Insets = { top: 62, bottom: 52, left: 20, right: 20 };

/**
 * Draws the match.
 *
 * The renderer owns no game rules: it reads a GameState and paints it. That
 * separation is what lets the simulation run on a fixed 30 Hz step while this
 * runs at display rate, interpolating between steps.
 */
export class GameRenderer {
  private readonly world = new Container();
  private readonly edgeLayer = new Graphics();
  private readonly wireLayer = new Container();
  private readonly liveEdgeLayer = new Graphics();
  private readonly glowLayer = new Container();
  private readonly discLayer = new Container();
  private readonly ringLayer = new Container();
  private readonly beaconLayer = new Graphics();
  private readonly motes: ParticleContainer;
  private readonly effectLayer = new Container();
  private readonly labelLayer = new Container();

  private readonly brushes: Brushes;
  private readonly camera = new Camera();
  private insets: Insets = { ...INSETS };
  private readonly views: NodeView[] = [];
  /** One sprite per wire on screen, kept and reused rather than rebuilt. */
  private readonly wires: TilingSprite[] = [];
  private readonly streams = new Map<number, Mote[]>();
  private readonly pool: Particle[] = [];
  private readonly flashes: Flash[] = [];
  private lastOwners: number[] = [];
  private homeNode: number | null = null;

  constructor(
    private readonly app: Application,
    private worldWidth: number,
    private worldHeight: number,
  ) {
    this.brushes = createBrushes();
    this.motes = new ParticleContainer({
      dynamicProperties: { position: true, color: true, scale: true },
    });
    this.motes.blendMode = 'add';
    this.beaconLayer.blendMode = 'add';

    this.world.addChild(
      this.edgeLayer,
      this.wireLayer,
      this.liveEdgeLayer,
      this.glowLayer,
      this.discLayer,
      this.ringLayer,
      this.beaconLayer,
      this.motes,
      this.effectLayer,
      this.labelLayer,
    );
    this.app.stage.addChild(this.world);
  }

  /** Boards differ in size; the view scales whichever one is in play to fit. */
  setWorld(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
    this.camera.setWorld(width, height);
    this.camera.reset();
    this.layout();
  }

  /** How much of the screen the HUD is covering, measured rather than assumed. */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.layout();
  }

  /**
   * Fits the board into the space the HUD leaves free, at whatever zoom and
   * offset the player has moved the view to.
   */
  layout(): void {
    const { width, height } = this.app.screen;
    this.camera.setViewport(width, height, this.insets);
    this.camera.setWorld(this.worldWidth, this.worldHeight);

    const { scale, x, y } = this.camera.transform;
    this.world.scale.set(scale);
    this.world.position.set(x, y);
  }

  /** How far in the view is zoomed, for a control that has to show it. */
  get zoom(): number {
    return this.camera.zoom;
  }

  /** Zooms about a point on the canvas, which stays where it is. */
  zoomAt(factor: number, screenX: number, screenY: number): void {
    this.camera.zoomAt(factor, screenX, screenY);
    this.layout();
  }

  /** Slides the board by a distance in canvas pixels. */
  panBy(dx: number, dy: number): void {
    this.camera.panBy(dx, dy);
    this.layout();
  }

  /** Converts a canvas-space point into world coordinates. */
  toWorld(x: number, y: number): { x: number; y: number } {
    const point = this.world.toLocal({ x, y });
    return { x: point.x, y: point.y };
  }

  /** Converts world coordinates into canvas space, for DOM laid over the board. */
  toScreen(x: number, y: number): { x: number; y: number } {
    const point = this.world.toGlobal({ x, y });
    return { x: point.x, y: point.y };
  }

  /** Where the controls for a node belong on screen, just clear of its edge. */
  anchorFor(node: GameNode): { x: number; y: number } {
    const edge = this.toScreen(node.x + node.radius, node.y);
    return { x: edge.x + 14, y: edge.y };
  }

  /**
   * Where a node sits on screen and how big it is there.
   *
   * The ring of actions is laid out around the node rather than beside it, so
   * it needs the drawn radius and not just a point — and the drawn radius
   * moves with both the zoom and the node's own level.
   *
   * Measured by asking where the node's edge lands, not by multiplying its
   * world radius by `camera.zoom`. Zoom is the level the player has dialled
   * in, where 1 means the whole board fitted; the scale from world units to
   * pixels is that times the fit. Rebuilding it here got the ring right on a
   * desktop, where the fit is near 1, and pushed every button twice as far
   * out as it belonged on a phone, where the board is squeezed.
   */
  ringFor(node: GameNode): { x: number; y: number; radius: number } {
    const at = this.toScreen(node.x, node.y);
    const edge = this.toScreen(node.x + node.radius, node.y);
    return { x: at.x, y: at.y, radius: edge.x - at.x };
  }

  /** Rebuilds every persistent display object for a freshly generated map. */
  build(state: GameState): void {
    this.edgeLayer.clear();
    this.glowLayer.removeChildren();
    this.discLayer.removeChildren();
    this.ringLayer.removeChildren();
    this.labelLayer.removeChildren();
    this.effectLayer.removeChildren();
    this.views.length = 0;
    this.flashes.length = 0;
    this.streams.clear();
    this.lastOwners = state.nodes.map((node) => node.owner);

    // Each filament is stroked on its own: Pixi keeps a single current point
    // across path calls, so batching them would chain every node to the last.
    for (const edge of state.edges) {
      const a = state.nodes[edge.a]!;
      const b = state.nodes[edge.b]!;
      this.edgeLayer
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: 1.5, color: COLORS.filament, alpha: 0.9 });
    }

    for (const node of state.nodes) {
      const glow = new Sprite(this.brushes.glow);
      glow.blendMode = 'add';
      glow.anchor.set(0.5);
      glow.position.set(node.x, node.y);
      this.glowLayer.addChild(glow);

      // A fortress is a different silhouette, not just a different colour:
      // shape survives at the edge of vision where a tint does not.
      const fortified = node.kind === 'fortress';
      const disc = new Sprite(fortified ? this.brushes.bastion : this.brushes.disc);
      disc.anchor.set(0.5);
      disc.position.set(node.x, node.y);
      // The bastion is drawn oversized so its corners clear the round fill
      // gauge. At the same radius the gauge traces its vertices and the whole
      // thing reads as an ordinary circle.
      const bodySize = node.radius * 2 * (fortified ? BASTION_BODY : 1);
      disc.width = bodySize;
      disc.height = bodySize;
      this.discLayer.addChild(disc);

      const ring = new Graphics();
      this.ringLayer.addChild(ring);

      const label = new Text({
        text: '0',
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: Math.round(node.radius * 0.95),
          fontWeight: '700',
          fill: COLORS.foam,
        },
      });
      label.anchor.set(0.5);
      label.position.set(node.x, node.y);
      this.labelLayer.addChild(label);

      this.views.push({
        glow,
        disc,
        ring,
        label,
        lastOwner: node.owner,
        lastLabel: '',
        lastRing: '',
        lastLevel: node.level,
      });
    }
  }

  /**
   * Marks the node the player opens on.
   *
   * On a board of fifty circles, your own is one more circle. The beacon says
   * where you are, then gets out of the way.
   */
  markHome(nodeId: number | null): void {
    this.homeNode = nodeId;
  }

  /**
   * @param alpha how far the clock sits into the next simulation step, 0..1.
   * @param stepSeconds the simulation's fixed step, used to predict motion.
   */
  draw(state: GameState, alpha: number, stepSeconds: number, drag: DragHint = EMPTY_DRAG): void {
    const time = state.time + stepSeconds * alpha;
    this.drawNodes(state, time, drag.selected);
    this.drawRings(state);
    this.drawStreams(state, alpha, stepSeconds, time);
    this.drawWires(state, time);
    this.drawLiveEdges(state, drag);
    this.drawBeacon(state, time);
    this.advanceFlashes(state, stepSeconds * alpha);
  }

  /**
   * @param selected the node the player has picked out, drawn brighter while
   * the rest of the board steps back. Nothing is added to the picture: the
   * glow each node already has is what carries the signal, so the board does
   * not collect another ring on top of the three it has.
   */
  private drawNodes(state: GameState, time: number, selected: number | null): void {
    state.nodes.forEach((node, index) => {
      const view = this.views[index];
      if (!view) return;

      const faction = factionOf(node.owner);
      const fill = Math.min(1, node.points / node.capacity);
      // Owned nodes breathe in time with their income; a full node sits bright
      // and still, which reads as "these points are going to waste".
      // A farm breathes at twice the rate, in time with the income it earns.
      const pace = node.kind === 'farm' ? 4.4 : 2.2;
      const breath = node.owner === NEUTRAL ? 0 : Math.sin(time * pace + index) * 0.06;

      const isChosen = node.id === selected;
      const dimmed = selected !== null && !isChosen;

      view.glow.tint = faction.glow;
      const base = node.owner === NEUTRAL ? 0.18 + fill * 0.2 : 0.45 + fill * 0.5;
      view.glow.alpha = isChosen ? Math.min(1, base * 1.8 + 0.2) : dimmed ? base * 0.4 : base;
      const glowSize =
        node.radius * (3.4 + fill * 0.9 + breath) * (isChosen ? 1.3 : 1);
      view.glow.width = glowSize;
      view.glow.height = glowSize;

      view.disc.tint = faction.core;
      view.disc.alpha = (node.owner === NEUTRAL ? 0.85 : 1) * (dimmed ? 0.7 : 1);

      // Building a node up makes it physically bigger, so the sprites sized
      // at build time have to be resized when its level moves.
      if (view.lastLevel !== node.level) {
        view.lastLevel = node.level;
        const bodySize = node.radius * 2 * (node.kind === 'fortress' ? BASTION_BODY : 1);
        view.disc.width = bodySize;
        view.disc.height = bodySize;
        view.label.style.fontSize = Math.round(node.radius * 0.95);
      }

      const text = formatPoints(node.points);
      if (text !== view.lastLabel) {
        view.label.text = text;
        view.lastLabel = text;
      }
      view.label.alpha = (node.owner === NEUTRAL ? 0.65 : 1) * (dimmed ? 0.55 : 1);
    });
  }

  /**
   * Redraws only the rings that changed.
   *
   * One shared Graphics meant re-tessellating every node's outline on every
   * frame, which is most of the CPU the board costs. A ring per node, keyed on
   * what it last drew, leaves the other hundred untouched.
   */
  private drawRings(state: GameState): void {
    state.nodes.forEach((node, index) => {
      const view = this.views[index];
      if (!view) return;

      const fill = Math.min(1, node.points / node.capacity);
      const full = node.points >= node.capacity;
      // A ring is ~200px around at most, so finer steps than this are invisible.
      const signature = `${node.owner}:${node.kind}:${node.level}:${Math.round(fill * 64)}:${full}`;
      if (signature === view.lastRing) return;
      view.lastRing = signature;

      const faction = factionOf(node.owner);
      view.ring
        .clear()
        .circle(node.x, node.y, node.radius)
        .stroke({ width: 2, color: faction.glow, alpha: 0.35 });

      this.drawKindMark(view.ring, node, faction.glow);
      this.drawLevelPips(view.ring, node, faction.glow);

      if (fill <= 0) return;
      const from = -Math.PI / 2;
      const to = from + Math.PI * 2 * fill;
      view.ring
        .moveTo(node.x + Math.cos(from) * node.radius, node.y + Math.sin(from) * node.radius)
        .arc(node.x, node.y, node.radius, from, to)
        .stroke({
          width: full ? 4 : 3,
          color: full ? COLORS.foam : faction.glow,
          alpha: full ? 0.95 : 0.9,
        });
    });
  }

  /** The badge that says what kind of node this is: armour, rays, a halo or a fan. */
  private drawKindMark(ring: Graphics, node: GameNode, colour: number): void {
    if (node.kind === 'fortress') {
      // An angular outline outside the round gauge: corners are the one thing
      // that cannot be mistaken for another circle.
      hexagonPath(ring, node.x, node.y, node.radius * BASTION_WALL);
      ring.stroke({ width: 2.5, color: colour, alpha: 0.85 });
      return;
    }

    if (node.kind === 'core') {
      // A halo, not spikes: the core does nothing where it stands and
      // everything everywhere else, so its mark reaches away from it.
      ring.circle(node.x, node.y, node.radius * CORE_HALO);
      ring.stroke({ width: 2, color: colour, alpha: 0.7 });
      ring.circle(node.x, node.y, node.radius * (CORE_HALO + 0.22));
      ring.stroke({ width: 1, color: colour, alpha: 0.35 });
      return;
    }

    if (node.kind === 'balancer') {
      // A fan of three, pointing away. The farm's rays go the whole way round
      // because a farm earns where it stands; a hub only ever passes things
      // on, and its mark says so.
      for (let ray = -1; ray <= 1; ray++) {
        const angle = (ray * Math.PI) / 5 - Math.PI / 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        ring
          .moveTo(node.x + cos * node.radius * 1.1, node.y + sin * node.radius * 1.1)
          .lineTo(node.x + cos * node.radius * 1.55, node.y + sin * node.radius * 1.55)
          .stroke({ width: 2.5, color: colour, alpha: 0.75 });
      }
      return;
    }

    if (node.kind !== 'farm') return;

    // Rays sit outside the node so they never crowd the number inside it.
    for (let ray = 0; ray < 6; ray++) {
      const angle = (ray * Math.PI) / 3 + Math.PI / 6;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ring
        .moveTo(node.x + cos * node.radius * 1.18, node.y + sin * node.radius * 1.18)
        .lineTo(node.x + cos * node.radius * 1.5, node.y + sin * node.radius * 1.5)
        .stroke({ width: 2.5, color: colour, alpha: 0.6 });
    }
  }

  /**
   * Five ticks under the node, filled to its level.
   *
   * Size already hints at how built-up a node is, but not precisely, and not
   * at all between two adjacent levels. The ticks sit outside the node so they
   * never crowd the garrison number inside it, and they read on enemy nodes
   * too — you can see what the other side has invested.
   */
  private drawLevelPips(ring: Graphics, node: GameNode, colour: number): void {
    const width = 5;
    const gap = 2.5;
    const span = MAX_LEVEL * width + (MAX_LEVEL - 1) * gap;
    const left = node.x - span / 2;
    const y = node.y + node.radius + (node.kind === 'fortress' ? 12 : 8);

    for (let pip = 0; pip < MAX_LEVEL; pip++) {
      const filled = pip < node.level;
      ring
        .moveTo(left + pip * (width + gap), y)
        .lineTo(left + pip * (width + gap) + width, y)
        .stroke({
          width: 2.5,
          color: filled ? colour : COLORS.filament,
          alpha: filled ? 0.95 : 0.8,
        });
    }
  }

  private drawStreams(
    state: GameState,
    alpha: number,
    stepSeconds: number,
    time: number,
  ): void {
    const live = new Set<number>();
    let used = 0;

    for (const squad of state.squads) {
      live.add(squad.id);
      const from = state.nodes[squad.from];
      const to = state.nodes[squad.to];
      if (!from || !to) continue;

      const head = squad.progress + squad.speed * stepSeconds * alpha;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length;
      const ny = dx / length;
      const tint = factionOf(squad.owner).glow;

      for (const mote of this.streamFor(squad)) {
        const t = head - mote.lag;
        if (t < 0 || t > 1) continue;

        const wobble = Math.sin(time * 3 + mote.phase) * 0.45 + 0.55;
        const spread = mote.lateral * wobble;
        const particle = this.takeParticle(used++);
        particle.x = from.x + dx * t + nx * spread;
        particle.y = from.y + dy * t + ny * spread;
        particle.tint = tint;
        // The head of the stream burns brightest and the tail fades out.
        particle.alpha = 0.35 + 0.55 * (1 - mote.lag / MOTE_TRAIL);
        const size = 5 + 4 * (1 - mote.lag / MOTE_TRAIL);
        particle.scaleX = size / 32;
        particle.scaleY = size / 32;
      }
    }

    for (const id of this.streams.keys()) {
      if (!live.has(id)) this.streams.delete(id);
    }

    // Parked particles are dropped from the container rather than hidden:
    // a transparent particle still costs the GPU a quad.
    const children = this.motes.particleChildren;
    children.length = 0;
    for (let i = 0; i < used; i++) children.push(this.pool[i]!);
    this.motes.update();
  }

  private streamFor(squad: Squad): Mote[] {
    const existing = this.streams.get(squad.id);
    if (existing) return existing;

    // Stream density tracks squad size, so a big attack visibly looks bigger.
    const count = Math.round(Math.min(64, 8 + squad.amount * 0.9));
    const motes: Mote[] = [];
    for (let i = 0; i < count; i++) {
      motes.push({
        lag: (i / count) * MOTE_TRAIL,
        lateral: (pseudoRandom(squad.id * 31 + i) - 0.5) * 16,
        phase: pseudoRandom(squad.id * 17 + i) * Math.PI * 2,
      });
    }
    this.streams.set(squad.id, motes);
    return motes;
  }

  private takeParticle(index: number): Particle {
    const existing = this.pool[index];
    if (existing) return existing;

    const particle = new Particle({ texture: this.brushes.mote, anchorX: 0.5, anchorY: 0.5 });
    this.pool.push(particle);
    return particle;
  }

  /**
   * Supply wires, as dashes crawling towards the node they feed.
   *
   * The direction has to be visible at a glance — a wire that looks the same
   * both ways is worse than no line at all — so the dashes march rather than
   * sit still.
   *
   * One sprite per wire, with the dash pattern repeating along it and sliding
   * by an offset into the texture. That is the whole reason this is not a
   * sprite per dash: drawn separately, every dash met the pixel grid at its
   * own offset and rounded to its own length, and because they move, the
   * pattern of longer and shorter dashes travelled along the wire. Drawn as
   * one strip, every dash on a wire is rasterised by the same mapping and
   * cannot disagree with its neighbours.
   *
   * The cost is a draw call per wire instead of one for the whole board. That
   * was the wrong trade when bots wired sixty nodes; it is the right one now
   * that the wires on a board are the player's own and a bot's few hubs.
   */
  private drawWires(state: GameState, time: number): void {
    const stride = DASH_LENGTH + DASH_GAP;
    const offset = (time * DASH_SPEED) % stride;
    let shown = 0;

    state.nodes.forEach((source, fromId) => {
      const colour = factionOf(source.owner).glow;

      for (const toId of state.wires[fromId] ?? []) {
        const target = state.nodes[toId];
        if (!target) continue;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const length = Math.hypot(dx, dy);
        if (length < 1) continue;

        /*
         * The strip is cut off well inside both nodes, not clear of them.
         *
         * Its ends are square, and a square end is only right where nothing
         * can see it. The node disc is opaque and covers it, so what is left
         * on screen is a line of dashes running out from under one node and
         * in under the other.
         */
        const from = source.radius * UNDER_NODE;
        const to = length - target.radius * UNDER_NODE;
        if (to <= from) continue;

        const wire = this.wireAt(shown++);
        wire.width = to - from;
        wire.height = WIRE_WIDTH;
        wire.position.set(source.x + (dx / length) * from, source.y + (dy / length) * from);
        wire.rotation = Math.atan2(dy, dx);

        // One tile to a stride, so the pattern is the same size on every wire
        // however long the wire is.
        wire.tileScale.set(stride / DASH_TILE.width, WIRE_WIDTH / DASH_TILE.height);
        wire.tilePosition.x = offset;
        wire.tint = colour;
        wire.alpha = 0.75;
        wire.visible = true;
      }
    });

    // Anything left over from a busier frame is hidden rather than removed:
    // the list is what the next frame draws from.
    for (let spare = shown; spare < this.wires.length; spare++) {
      this.wires[spare]!.visible = false;
    }
  }

  /** The sprite for the nth wire on screen, made once and reused after that. */
  private wireAt(index: number): TilingSprite {
    const existing = this.wires[index];
    if (existing) return existing;

    const wire = new TilingSprite({ texture: this.brushes.dash });
    wire.anchor.set(0, 0.5);
    this.wires.push(wire);
    this.wireLayer.addChild(wire);
    return wire;
  }


  private drawLiveEdges(state: GameState, drag: DragHint): void {
    this.liveEdgeLayer.clear();

    if (drag.from !== null) {
      const source = state.nodes[drag.from];
      if (source) {
        for (const targetId of drag.targets) {
          const target = state.nodes[targetId];
          if (!target) continue;
          this.liveEdgeLayer
            .moveTo(source.x, source.y)
            .lineTo(target.x, target.y)
            .stroke({ width: 2.5, color: COLORS.filamentLive, alpha: 1 });
        }

        if (drag.cursor) {
          const faction = factionOf(source.owner);
          this.liveEdgeLayer
            .moveTo(source.x, source.y)
            .lineTo(drag.cursor.x, drag.cursor.y)
            .stroke({
              width: drag.wiring ? 3 : 2,
              color: faction.glow,
              alpha: drag.wiring ? 0.8 : 0.55,
            });
        }
      }
    }
  }

  /**
   * Rings pushing out from the player's opening node for the first seconds of
   * a match, then gone. Driven by simulated time, so it holds still as a
   * target marker while the board is paused behind the setup dialog.
   */
  private drawBeacon(state: GameState, time: number): void {
    this.beaconLayer.clear();
    if (this.homeNode === null || time >= BEACON_SECONDS) return;

    const node = state.nodes[this.homeNode];
    if (!node) return;

    const colour = factionOf(node.owner).glow;
    const fade = 1 - time / BEACON_SECONDS;

    for (let ring = 0; ring < BEACON_RINGS; ring++) {
      const phase = ((time / BEACON_PERIOD) + ring / BEACON_RINGS) % 1;
      const alpha = (1 - phase) * 0.6 * fade;
      if (alpha <= 0.01) continue;

      this.beaconLayer
        .circle(node.x, node.y, node.radius * (1.25 + phase * 3))
        .stroke({ width: 1 + 3 * (1 - phase), color: colour, alpha });
    }
  }

  private advanceFlashes(state: GameState, dt: number): void {
    state.nodes.forEach((node, index) => {
      if (this.lastOwners[index] === node.owner) return;
      this.lastOwners[index] = node.owner;
      this.spawnFlash(node.x, node.y, node.radius, factionOf(node.owner).glow);
    });

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i]!;
      flash.age += dt;
      const t = flash.age / FLASH_SECONDS;
      if (t >= 1) {
        flash.sprite.destroy();
        this.flashes.splice(i, 1);
        continue;
      }
      flash.sprite.alpha = (1 - t) ** 2;
      flash.sprite.scale.set((flash.baseSize / 128) * (1 + t * 2.2));
    }
  }

  private spawnFlash(x: number, y: number, radius: number, tint: number): void {
    const baseSize = radius * 4;
    const sprite = new Sprite(this.brushes.glow);
    sprite.blendMode = 'add';
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    sprite.width = baseSize;
    sprite.height = baseSize;
    sprite.tint = tint;
    this.effectLayer.addChild(sprite);
    this.flashes.push({ sprite, baseSize, age: 0 });
  }
}

/** Corners of a fortress body, as a share of the node radius. */
const BASTION_BODY = 1.1;
/**
 * Where the fortress wall sits, as a share of the node radius.
 *
 * Kept tight: a bridge occasionally has to stand closer than a full step from
 * its shore, and a wide wall would then draw over the node it joins.
 */
const BASTION_WALL = 1.24;

/** How far out the core's halo sits, against the node's own radius. */
const CORE_HALO = 1.3;

/** Traces a flat-topped hexagon; the caller strokes or fills it. */
function hexagonPath(graphics: Graphics, x: number, y: number, radius: number): void {
  for (let corner = 0; corner < 6; corner++) {
    const angle = (corner * Math.PI) / 3;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (corner === 0) graphics.moveTo(px, py);
    else graphics.lineTo(px, py);
  }
  graphics.closePath();
}

/** How thick a supply wire is drawn, in world units. */
const WIRE_WIDTH = 2.5;

/** Dash and gap, in world units. */
/**
 * How far inside a node the run of dashes is cut, as a share of its radius.
 *
 * Far enough in that a dash of full length is hidden before it has to be cut
 * short: a node is at least fifteen across, so half of that is more than a
 * dash is long.
 */
const UNDER_NODE = 0.5;

const DASH_LENGTH = 7;
const DASH_GAP = 7;
/** World units a dash travels per second. */
const DASH_SPEED = 26;

/** How long the opening beacon stays up, in simulated seconds. */
const BEACON_SECONDS = 7;
/** Seconds for one ring to travel from the node to its widest. */
const BEACON_PERIOD = 1.6;
const BEACON_RINGS = 3;

/** How far behind the head the tail of a stream trails, in edge fractions. */
const MOTE_TRAIL = 0.22;

/** Stable scatter for a mote's offsets, so streams do not shimmer randomly. */
function pseudoRandom(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
