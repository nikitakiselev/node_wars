import {
  Application,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Sprite,
  Text,
} from 'pixi.js';
import { NEUTRAL, type GameState, type Squad } from '../core/state';
import { COLORS, FONT_FAMILY, factionOf } from './theme';
import { createBrushes, type Brushes } from './textures';

/** What the renderer needs to know about the player's current gesture. */
export interface DragHint {
  from: number | null;
  cursor: { x: number; y: number } | null;
  targets: ReadonlySet<number>;
}

const EMPTY_DRAG: DragHint = { from: null, cursor: null, targets: new Set() };

interface NodeView {
  glow: Sprite;
  disc: Sprite;
  ring: Graphics;
  label: Text;
  lastOwner: number;
  lastLabel: string;
  /** What the ring last drew; redrawing is skipped while this holds. */
  lastRing: string;
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

/** Screen-space room reserved for the HUD, in CSS pixels. */
const INSETS = { top: 62, bottom: 52, left: 20, right: 20 } as const;

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
  private readonly liveEdgeLayer = new Graphics();
  private readonly glowLayer = new Container();
  private readonly discLayer = new Container();
  private readonly ringLayer = new Container();
  private readonly beaconLayer = new Graphics();
  private readonly motes: ParticleContainer;
  private readonly effectLayer = new Container();
  private readonly labelLayer = new Container();

  private readonly brushes: Brushes;
  private readonly views: NodeView[] = [];
  private readonly streams = new Map<number, Mote[]>();
  private readonly pool: Particle[] = [];
  private readonly flashes: Flash[] = [];
  private lastOwners: number[] = [];
  private homeNode: number | null = null;

  constructor(
    private readonly app: Application,
    private readonly worldWidth: number,
    private readonly worldHeight: number,
  ) {
    this.brushes = createBrushes();
    this.motes = new ParticleContainer({
      dynamicProperties: { position: true, color: true, scale: true },
    });
    this.motes.blendMode = 'add';
    this.beaconLayer.blendMode = 'add';

    this.world.addChild(
      this.edgeLayer,
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

  /**
   * Fits the world into the canvas, letterboxed and centred inside the space
   * the HUD leaves free, so no node ever hides under the scoreboard.
   */
  layout(): void {
    const { width, height } = this.app.screen;
    const available = {
      width: Math.max(1, width - INSETS.left - INSETS.right),
      height: Math.max(1, height - INSETS.top - INSETS.bottom),
    };
    const scale = Math.min(
      available.width / this.worldWidth,
      available.height / this.worldHeight,
    );
    this.world.scale.set(scale);
    this.world.position.set(
      INSETS.left + (available.width - this.worldWidth * scale) / 2,
      INSETS.top + (available.height - this.worldHeight * scale) / 2,
    );
  }

  /** Converts a canvas-space point into world coordinates. */
  toWorld(x: number, y: number): { x: number; y: number } {
    const point = this.world.toLocal({ x, y });
    return { x: point.x, y: point.y };
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

      const disc = new Sprite(this.brushes.disc);
      disc.anchor.set(0.5);
      disc.position.set(node.x, node.y);
      disc.width = node.radius * 2;
      disc.height = node.radius * 2;
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
    this.drawNodes(state, time);
    this.drawRings(state);
    this.drawStreams(state, alpha, stepSeconds, time);
    this.drawLiveEdges(state, drag);
    this.drawBeacon(state, time);
    this.advanceFlashes(state, stepSeconds * alpha);
  }

  private drawNodes(state: GameState, time: number): void {
    state.nodes.forEach((node, index) => {
      const view = this.views[index];
      if (!view) return;

      const faction = factionOf(node.owner);
      const fill = Math.min(1, node.points / node.capacity);
      // Owned nodes breathe in time with their income; a full node sits bright
      // and still, which reads as "these points are going to waste".
      const breath = node.owner === NEUTRAL ? 0 : Math.sin(time * 2.2 + index) * 0.06;

      view.glow.tint = faction.glow;
      view.glow.alpha = node.owner === NEUTRAL ? 0.18 + fill * 0.2 : 0.45 + fill * 0.5;
      const glowSize = node.radius * (3.4 + fill * 0.9 + breath);
      view.glow.width = glowSize;
      view.glow.height = glowSize;

      view.disc.tint = faction.core;
      view.disc.alpha = node.owner === NEUTRAL ? 0.85 : 1;

      const text = String(Math.floor(node.points));
      if (text !== view.lastLabel) {
        view.label.text = text;
        view.lastLabel = text;
      }
      view.label.alpha = node.owner === NEUTRAL ? 0.65 : 1;
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
      const signature = `${node.owner}:${Math.round(fill * 64)}:${full}`;
      if (signature === view.lastRing) return;
      view.lastRing = signature;

      const faction = factionOf(node.owner);
      view.ring
        .clear()
        .circle(node.x, node.y, node.radius)
        .stroke({ width: 2, color: faction.glow, alpha: 0.35 });

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
            .stroke({ width: 2, color: faction.glow, alpha: 0.55 });
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
