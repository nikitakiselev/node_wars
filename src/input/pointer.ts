import { nodeAtPoint, wireAtPoint } from '../core/geometry';
import { sendSquad } from '../core/orders';
import type { GameState, OwnerId } from '../core/state';
import { clearWire, setWire } from '../core/wires';
import { fractionFor } from './fractions';
import type { DragHint } from '../render/renderer';

interface Surface {
  canvas: HTMLCanvasElement;
  toWorld(x: number, y: number): { x: number; y: number };
}

/**
 * Turns pointer gestures into orders.
 *
 * Dragging from one of your nodes to a neighbour attacks it with everything it
 * has; Shift keeps half back, Alt sends only a quarter. Releasing anywhere
 * else cancels, so a misdrag costs nothing.
 */
/** Pointer travel, in world units, still counted as a click rather than a drag. */
const CLICK_SLOP = 8;

const RIGHT_BUTTON = 2;

export class PointerControls {
  private from: number | null = null;
  private cursor: { x: number; y: number } | null = null;
  private targets = new Set<number>();
  private pressedAt: { x: number; y: number } | null = null;
  private chosen: number | null = null;
  /** Set while the right button is drawing a supply wire. */
  private wiring = false;
  /** The wire the cursor is resting on, identified by its source node. */
  private hovered: number | null = null;

  constructor(
    private readonly surface: Surface,
    private readonly player: OwnerId,
    private readonly getState: () => GameState,
    /** Called when the selection or the hovered wire changes, so controls can
     * follow at once rather than on the next frame. */
    private readonly onUiChange: () => void = () => {},
  ) {
    const canvas = surface.canvas;
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
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('pointercancel', this.onCancel);
    canvas.removeEventListener('contextmenu', preventDefault);
  }

  private pointAt(event: PointerEvent) {
    const rect = this.surface.canvas.getBoundingClientRect();
    return this.surface.toWorld(event.clientX - rect.left, event.clientY - rect.top);
  }

  private readonly onDown = (event: PointerEvent): void => {
    const state = this.getState();
    const point = this.pointAt(event);
    const node = nodeAtPoint(state, point.x, point.y);
    if (!node || node.owner !== this.player) {
      // A press on empty ground puts the selection away.
      this.select(null);
      return;
    }

    // The right button lays supply wires, which run between your own nodes;
    // the left one throws squads, which go at everyone else's.
    this.wiring = event.button === RIGHT_BUTTON;
    this.hovered = null;
    this.pressedAt = point;
    this.from = node.id;
    this.cursor = point;
    this.targets = new Set(
      (state.adjacency[node.id] ?? []).filter((id) =>
        this.wiring
          ? state.nodes[id]?.owner === this.player
          : state.nodes[id]?.owner !== this.player,
      ),
    );
    this.surface.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onMove = (event: PointerEvent): void => {
    const point = this.pointAt(event);

    if (this.from !== null) {
      this.cursor = point;
      return;
    }

    // Resting on a wire brings up its controls; dragging is not the time.
    const wire = wireAtPoint(this.getState(), point.x, point.y);
    if (wire === this.hovered) return;
    this.hovered = wire;
    this.onUiChange();
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (this.from === null) return;

    const state = this.getState();
    const point = this.pointAt(event);
    const target = nodeAtPoint(state, point.x, point.y);

    // A press and release in the same spot is a click, not a throw: it picks
    // the node out so its controls appear, rather than ordering an attack.
    const travelled = this.pressedAt
      ? Math.hypot(point.x - this.pressedAt.x, point.y - this.pressedAt.y)
      : Infinity;
    const isClick = travelled <= CLICK_SLOP && target?.id === this.from;

    if (this.wiring) {
      // A right-click in place takes down the wire the node already has.
      if (isClick) clearWire(state, this.player, this.from);
      else if (target && target.id !== this.from) {
        setWire(state, this.player, this.from, target.id);
      }
      this.clear();
      return;
    }

    if (isClick) {
      this.select(this.chosen === this.from ? null : this.from);
      this.clear();
      return;
    }

    if (target && target.id !== this.from) {
      sendSquad(state, this.player, this.from, target.id, fractionFor(event));
      this.select(null);
    }

    this.clear();
  };

  private readonly onCancel = (): void => this.clear();

  private clear(): void {
    this.wiring = false;
    this.from = null;
    this.cursor = null;
    this.pressedAt = null;
    this.targets = new Set();
  }
}

function preventDefault(event: Event): void {
  event.preventDefault();
}
