import { nodeAtPoint, wireAtPoint } from '../core/geometry';
import { sendSquad } from '../core/orders';
import type { GameNode, GameState, OwnerId } from '../core/state';
import { clearWire, setWire } from '../core/wires';
import { fractionFor, type SendMode } from './fractions';
import { GestureReader, type Gesture } from './gestures';
import type { DragHint } from '../render/renderer';

interface Surface {
  canvas: HTMLCanvasElement;
  toWorld(x: number, y: number): { x: number; y: number };
  /** Slides the view by a distance in canvas pixels. */
  panBy(dx: number, dy: number): void;
  /** Zooms about a point on the canvas. */
  zoomAt(factor: number, screenX: number, screenY: number): void;
}

/**
 * Turns pointer gestures into orders.
 *
 * With a mouse, dragging from one of your nodes to a neighbour attacks it with
 * everything it has; Shift keeps half back, Alt sends only a quarter, and the
 * right button lays a supply wire. Releasing anywhere else cancels, so a
 * misdrag costs nothing.
 *
 * A finger has no buttons and no modifiers, so the same drag is read through
 * a GestureReader and the part a modifier used to say — how much, or whether
 * this is a wire — is read off the mode bar instead. Both roads meet in the
 * same private drag: there is one set of rules about what a drag does, not two.
 */
/** Pointer travel, in world units, still counted as a click rather than a drag. */
const CLICK_SLOP = 8;

const MIDDLE_BUTTON = 1;
const RIGHT_BUTTON = 2;
/** How much one notch of the wheel changes the zoom. */
const WHEEL_STEP = 1.15;

export class PointerControls {
  private from: number | null = null;
  private cursor: { x: number; y: number } | null = null;
  private targets = new Set<number>();
  private pressedAt: { x: number; y: number } | null = null;
  private chosen: number | null = null;
  /** Set while a drag is laying a supply wire rather than throwing a squad. */
  private wiring = false;
  /** The wire the cursor is resting on, identified by its source node. */
  private hovered: number | null = null;
  /** Where the view was last grabbed, in canvas pixels. */
  private dragging: { x: number; y: number } | null = null;

  private readonly touch = new GestureReader({
    grabs: (x, y) => this.ownNodeAt(this.surface.toWorld(x, y)) !== null,
  });

  constructor(
    private readonly surface: Surface,
    private readonly player: OwnerId,
    private readonly getState: () => GameState,
    /** Called when the selection or the hovered wire changes, so controls can
     * follow at once rather than on the next frame. */
    private readonly onUiChange: () => void = () => {},
    /** What a bare drag means, for a player with no modifier keys to hold. */
    private readonly getMode: () => SendMode = () => 'all',
  ) {
    const canvas = surface.canvas;
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('contextmenu', preventDefault);
  }

  get hint(): DragHint {
    return {
      from: this.from,
      cursor: this.cursor,
      targets: this.targets,
      selected: this.chosen,
      wiring: this.wiring,
    };
  }

  /** The node the player has picked out, or null. */
  get selected(): number | null {
    return this.chosen;
  }

  /** The wire under the cursor, by source node, or null. */
  get hoveredWire(): number | null {
    return this.hovered;
  }

  /** Drops the selection, for when the node is lost or the board is replaced. */
  clearSelection(): void {
    this.hovered = null;
    this.select(null);
  }

  private select(nodeId: number | null): void {
    if (this.chosen === nodeId) return;
    this.chosen = nodeId;
    this.onUiChange();
  }

  destroy(): void {
    const canvas = this.surface.canvas;
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('pointercancel', this.onCancel);
    canvas.removeEventListener('contextmenu', preventDefault);
  }

  private pointAt(event: PointerEvent) {
    const screen = this.screenAt(event);
    return this.surface.toWorld(screen.x, screen.y);
  }

  private screenAt(event: PointerEvent | WheelEvent) {
    const rect = this.surface.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** The player's own node under a world point, or null. */
  private ownNodeAt(point: { x: number; y: number }): GameNode | null {
    const node = nodeAtPoint(this.getState(), point.x, point.y);
    return node && node.owner === this.player ? node : null;
  }

  private readonly onWheel = (event: WheelEvent): void => {
    // The page must not scroll out from under the board.
    event.preventDefault();
    const screen = this.screenAt(event);
    this.surface.zoomAt(event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, screen.x, screen.y);
    this.onUiChange();
  };

  private readonly onDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') {
      this.surface.canvas.setPointerCapture(event.pointerId);
      this.apply(this.touch.down({ id: event.pointerId, ...this.screenAt(event) }));
      return;
    }

    const state = this.getState();
    const point = this.pointAt(event);
    const node = nodeAtPoint(state, point.x, point.y);

    // The middle button always drags the view; the left one does too when it
    // lands on open water, where there is nothing else for it to mean.
    if (event.button === MIDDLE_BUTTON || (!node && event.button !== RIGHT_BUTTON)) {
      this.dragging = this.screenAt(event);
      this.surface.canvas.setPointerCapture(event.pointerId);
      this.select(null);
      return;
    }

    if (!node || node.owner !== this.player) {
      // A press on somebody else's node puts the selection away.
      this.select(null);
      return;
    }

    // The right button lays supply wires, which run between your own nodes;
    // the left one throws squads, which go at everyone else's.
    this.pressedAt = point;
    this.beginDrag(node, event.button === RIGHT_BUTTON);
    this.surface.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') {
      this.apply(this.touch.move({ id: event.pointerId, ...this.screenAt(event) }));
      return;
    }

    if (this.dragging) {
      const screen = this.screenAt(event);
      this.surface.panBy(screen.x - this.dragging.x, screen.y - this.dragging.y);
      this.dragging = screen;
      this.onUiChange();
      return;
    }

    const point = this.pointAt(event);

    if (this.from !== null) {
      this.cursor = point;
      return;
    }

    this.restOn(point);
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') {
      this.apply(this.touch.up(event.pointerId));
      return;
    }

    if (this.dragging) {
      this.dragging = null;
      return;
    }
    if (this.from === null) return;

    const point = this.pointAt(event);
    const target = nodeAtPoint(this.getState(), point.x, point.y);

    // A press and release in the same spot is a click, not a throw: it picks
    // the node out so its controls appear, rather than ordering an attack.
    const travelled = this.pressedAt
      ? Math.hypot(point.x - this.pressedAt.x, point.y - this.pressedAt.y)
      : Infinity;

    if (travelled <= CLICK_SLOP && target?.id === this.from) this.tapNode(this.from, this.wiring);
    else this.finishDrag(target, fractionFor(event));

    this.clear();
  };

  private readonly onCancel = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') {
      this.apply(this.touch.cancel(event.pointerId));
      return;
    }
    this.clear();
  };

  /** Carries out what the fingers asked for. */
  private apply(gestures: Gesture[]): void {
    for (const gesture of gestures) {
      switch (gesture.kind) {
        case 'dragStart': {
          const node = this.ownNodeAt(this.surface.toWorld(gesture.x, gesture.y));
          if (node) this.beginDrag(node, this.getMode() === 'wire');
          break;
        }
        case 'dragMove':
          if (this.from !== null) this.cursor = this.surface.toWorld(gesture.x, gesture.y);
          break;
        case 'dragEnd': {
          if (this.from === null) break;
          const point = this.surface.toWorld(gesture.x, gesture.y);
          const target = nodeAtPoint(this.getState(), point.x, point.y);
          this.finishDrag(target, fractionFor(NO_KEYS, this.getMode()));
          this.clear();
          break;
        }
        case 'dragCancel':
          this.clear();
          break;
        case 'tap':
          this.onTap(this.surface.toWorld(gesture.x, gesture.y));
          break;
        case 'pan':
          this.surface.panBy(gesture.dx, gesture.dy);
          this.onUiChange();
          break;
        case 'pinch':
          this.surface.zoomAt(gesture.factor, gesture.x, gesture.y);
          this.onUiChange();
          break;
      }
    }
  }

  /**
   * A tap, which is how a finger asks about something rather than orders it.
   *
   * On one of your own nodes it picks the node out, or takes its wire down if
   * the bar is set to wiring. Anywhere else it looks for a wire to rest on,
   * which is what puts the × within reach of a player who cannot hover.
   */
  private onTap(point: { x: number; y: number }): void {
    const state = this.getState();
    const node = this.ownNodeAt(point);

    if (node) {
      this.tapNode(node.id, this.getMode() === 'wire');
      return;
    }

    const wire = wireAtPoint(state, point.x, point.y);
    this.hovered = wire;
    this.select(null);
    this.onUiChange();
  }

  /** Resting on a wire brings up its controls; dragging is not the time. */
  private restOn(point: { x: number; y: number }): void {
    const wire = wireAtPoint(this.getState(), point.x, point.y);
    if (wire === this.hovered) return;
    this.hovered = wire;
    this.onUiChange();
  }

  /** Picks up a node: from here the drag is the same whatever opened it. */
  private beginDrag(node: GameNode, wiring: boolean): void {
    const state = this.getState();
    this.wiring = wiring;
    this.hovered = null;
    this.from = node.id;
    this.cursor = { x: node.x, y: node.y };
    this.targets = new Set(
      (state.adjacency[node.id] ?? []).filter((id) =>
        wiring ? state.nodes[id]?.owner === this.player : state.nodes[id]?.owner !== this.player,
      ),
    );
  }

  /**
   * A press and release on the same node, by whatever pointer.
   *
   * While wiring, the node is being asked to let go of its wire; otherwise it
   * is being picked out so its controls appear.
   */
  private tapNode(nodeId: number, wiring: boolean): void {
    if (!wiring) {
      this.select(this.chosen === nodeId ? null : nodeId);
      return;
    }

    clearWire(this.getState(), this.player, nodeId);
    this.hovered = null;
    this.onUiChange();
  }

  /** Lets a drag go over a node, or over nothing, which costs nothing. */
  private finishDrag(target: GameNode | null, fraction: number): void {
    if (this.from === null || !target || target.id === this.from) return;
    const state = this.getState();

    if (this.wiring) {
      setWire(state, this.player, this.from, target.id);
      return;
    }

    sendSquad(state, this.player, this.from, target.id, fraction);
    this.select(null);
  }

  private clear(): void {
    this.dragging = null;
    this.wiring = false;
    this.from = null;
    this.cursor = null;
    this.pressedAt = null;
    this.targets = new Set();
  }
}

/** A finger holds down nothing; the mode bar speaks for it. */
const NO_KEYS = { shiftKey: false, altKey: false } as const;

function preventDefault(event: Event): void {
  event.preventDefault();
}
