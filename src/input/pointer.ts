import { nodeAtPoint } from '../core/geometry';
import { sendSquad } from '../core/orders';
import type { GameState, OwnerId } from '../core/state';
import type { DragHint } from '../render/renderer';

/** Share of a node's garrison sent by a plain drag, and by the modifiers. */
const FRACTIONS = { plain: 0.5, everything: 1, probe: 0.25 } as const;

interface Surface {
  canvas: HTMLCanvasElement;
  toWorld(x: number, y: number): { x: number; y: number };
}

/**
 * Turns pointer gestures into orders.
 *
 * Dragging from one of your nodes to a neighbour attacks it. Shift commits the
 * whole garrison, Alt sends a quarter. Releasing anywhere else cancels, so a
 * misdrag costs nothing.
 */
export class PointerControls {
  private from: number | null = null;
  private cursor: { x: number; y: number } | null = null;
  private targets = new Set<number>();

  constructor(
    private readonly surface: Surface,
    private readonly player: OwnerId,
    private readonly getState: () => GameState,
  ) {
    const canvas = surface.canvas;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('contextmenu', preventDefault);
  }

  get hint(): DragHint {
    return { from: this.from, cursor: this.cursor, targets: this.targets };
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
    if (!node || node.owner !== this.player) return;

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

    if (target && target.id !== this.from) {
      sendSquad(state, this.player, this.from, target.id, fractionFor(event));
    }

    this.clear();
  };

  private readonly onCancel = (): void => this.clear();

  private clear(): void {
    this.from = null;
    this.cursor = null;
    this.targets = new Set();
  }
}

function fractionFor(event: PointerEvent): number {
  if (event.shiftKey) return FRACTIONS.everything;
  if (event.altKey) return FRACTIONS.probe;
  return FRACTIONS.plain;
}

function preventDefault(event: Event): void {
  event.preventDefault();
}
