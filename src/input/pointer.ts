import { nodeAtPoint } from '../core/geometry';
import { fractionFor } from './fractions';
import { sendSquad } from '../core/orders';
import type { GameState, OwnerId } from '../core/state';
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

export class PointerControls {
  private from: number | null = null;
  private cursor: { x: number; y: number } | null = null;
  private targets = new Set<number>();
  private pressedAt: { x: number; y: number } | null = null;
  private chosen: number | null = null;

  constructor(
    private readonly surface: Surface,
    private readonly player: OwnerId,
    private readonly getState: () => GameState,
    /** Called when the picked-out node changes, so controls can follow at
     * once rather than on the next frame. */
    private readonly onSelectionChange: () => void = () => {},
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
    };
  }

  /** The node the player has picked out, or null. */
  get selected(): number | null {
    return this.chosen;
  }

  /** Drops the selection, for when the node is lost or the board is replaced. */
  clearSelection(): void {
    this.select(null);
  }

  private select(nodeId: number | null): void {
    if (this.chosen === nodeId) return;
    this.chosen = nodeId;
    this.onSelectionChange();
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

    this.pressedAt = point;
    this.from = node.id;
    this.cursor = point;
    this.targets = new Set(
      (state.adjacency[node.id] ?? []).filter(
        (id) => state.nodes[id]?.owner !== this.player,
      ),
    );
    this.surface.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (this.from === null) return;
    this.cursor = this.pointAt(event);
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
    if (travelled <= CLICK_SLOP && target?.id === this.from) {
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
    this.from = null;
    this.cursor = null;
    this.pressedAt = null;
    this.targets = new Set();
  }
}

function preventDefault(event: Event): void {
  event.preventDefault();
}
