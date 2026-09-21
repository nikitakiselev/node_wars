/**
 * Turns a stream of touches into the four things a board can be asked to do:
 * drag something across it, tap it, slide it, or zoom it.
 *
 * Kept free of the DOM — it takes plain points rather than PointerEvents — so
 * the thresholds, which are the part that goes wrong, can be tested in Node.
 * Everything here is in canvas pixels, never world units: a finger is the same
 * size whatever the zoom, so a slop measured in the world would shrink to
 * nothing as the player zoomed in.
 */

/** A finger on the glass, in canvas pixels. */
export interface Touch {
  id: number;
  x: number;
  y: number;
}

export type Gesture =
  | { kind: 'dragStart'; x: number; y: number }
  | { kind: 'dragMove'; x: number; y: number }
  | { kind: 'dragEnd'; x: number; y: number }
  | { kind: 'dragCancel' }
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'pinch'; factor: number; x: number; y: number };

/** Travel, in canvas pixels, still read as a tap rather than a drag. */
export const SCREEN_SLOP = 10;

interface Tracked {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  /** Set on the finger that opened a drag. */
  dragging: boolean;
  /** Set on a finger left over from a pinch: it may pan, and nothing else. */
  spent: boolean;
}

export interface GestureOptions {
  /** Whether a press at this point lands on something the player can drag. */
  grabs(x: number, y: number): boolean;
}

export class GestureReader {
  private readonly touches: Tracked[] = [];
  /** Gap and midpoint between the two fingers at the last event. */
  private gap = 0;
  private centre = { x: 0, y: 0 };

  constructor(private readonly options: GestureOptions) {}

  down(touch: Touch): Gesture[] {
    // Two fingers already say everything this board can be told; a third is
    // a hand resting on the glass.
    if (this.touches.length >= 2) return [];

    const grabbed = this.touches.length === 0 && this.options.grabs(touch.x, touch.y);
    this.touches.push({
      id: touch.id,
      x: touch.x,
      y: touch.y,
      startX: touch.x,
      startY: touch.y,
      dragging: grabbed,
      spent: false,
    });

    if (this.touches.length === 2) {
      // A second finger is a request to move the view, so whatever the first
      // one had picked up is put back down rather than thrown.
      const out: Gesture[] = this.dropDrag();
      this.measure();
      return out;
    }

    return grabbed ? [{ kind: 'dragStart', x: touch.x, y: touch.y }] : [];
  }

  move(touch: Touch): Gesture[] {
    const tracked = this.touches.find((candidate) => candidate.id === touch.id);
    if (!tracked) return [];

    const from = { x: tracked.x, y: tracked.y };
    tracked.x = touch.x;
    tracked.y = touch.y;

    if (this.touches.length === 2) return this.pinch();
    if (tracked.dragging) return [{ kind: 'dragMove', x: touch.x, y: touch.y }];

    return [{ kind: 'pan', dx: touch.x - from.x, dy: touch.y - from.y }];
  }

  up(id: number): Gesture[] {
    const tracked = this.take(id);
    if (!tracked) return [];

    // Coming out of a pinch, the finger still down is holding the view, not
    // reaching for a node: it may keep panning and nothing more.
    if (this.touches.length === 1) {
      const survivor = this.touches[0]!;
      survivor.spent = true;
      survivor.dragging = false;
      return [];
    }

    if (tracked.spent) return [];

    const tapped = travelled(tracked) <= SCREEN_SLOP;
    if (tracked.dragging) {
      return tapped
        ? [{ kind: 'dragCancel' }, { kind: 'tap', x: tracked.x, y: tracked.y }]
        : [{ kind: 'dragEnd', x: tracked.x, y: tracked.y }];
    }

    return tapped ? [{ kind: 'tap', x: tracked.x, y: tracked.y }] : [];
  }

  cancel(id: number): Gesture[] {
    const tracked = this.take(id);
    if (!tracked) return [];

    if (this.touches.length === 1) {
      const survivor = this.touches[0]!;
      survivor.spent = true;
      survivor.dragging = false;
    }

    return tracked.dragging ? [{ kind: 'dragCancel' }] : [];
  }

  private take(id: number): Tracked | null {
    const index = this.touches.findIndex((candidate) => candidate.id === id);
    if (index < 0) return null;
    return this.touches.splice(index, 1)[0] ?? null;
  }

  private dropDrag(): Gesture[] {
    const dragger = this.touches.find((candidate) => candidate.dragging);
    if (!dragger) return [];
    dragger.dragging = false;
    dragger.spent = true;
    return [{ kind: 'dragCancel' }];
  }

  /**
   * What the pair did since the last event: the midpoint slid, and the gap
   * between them grew or shrank.
   *
   * The slide is reported first so that the zoom happens about where the
   * fingers are now, which is what keeps the board still under them.
   */
  private pinch(): Gesture[] {
    const previous = { gap: this.gap, centre: this.centre };
    this.measure();

    const factor = previous.gap > 0 ? this.gap / previous.gap : 1;
    return [
      { kind: 'pan', dx: this.centre.x - previous.centre.x, dy: this.centre.y - previous.centre.y },
      { kind: 'pinch', factor, x: this.centre.x, y: this.centre.y },
    ];
  }

  private measure(): void {
    const [first, second] = this.touches;
    if (!first || !second) return;
    this.gap = Math.hypot(second.x - first.x, second.y - first.y);
    this.centre = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  }
}

function travelled(touch: Tracked): number {
  return Math.hypot(touch.x - touch.startX, touch.y - touch.startY);
}
