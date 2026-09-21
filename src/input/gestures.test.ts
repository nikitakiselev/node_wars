import { describe, expect, it } from 'vitest';
import { GestureReader, SCREEN_SLOP, type Gesture } from './gestures';

/** A reader that treats a disc around the origin as something worth grabbing. */
function readerOverNode(): GestureReader {
  return new GestureReader({ grabs: (x, y) => Math.hypot(x, y) <= 20 });
}

function kinds(gestures: Gesture[]): string[] {
  return gestures.map((gesture) => gesture.kind);
}

function only<K extends Gesture['kind']>(
  gestures: Gesture[],
  kind: K,
): Extract<Gesture, { kind: K }>[] {
  return gestures.filter(
    (gesture): gesture is Extract<Gesture, { kind: K }> => gesture.kind === kind,
  );
}

describe('one finger', () => {
  it('opens a drag when it lands on something grabbable', () => {
    const reader = readerOverNode();

    expect(reader.down({ id: 1, x: 0, y: 0 })).toEqual([{ kind: 'dragStart', x: 0, y: 0 }]);
  });

  it('carries the drag along as the finger moves', () => {
    const reader = readerOverNode();
    reader.down({ id: 1, x: 0, y: 0 });

    expect(reader.move({ id: 1, x: 40, y: 10 })).toEqual([
      { kind: 'dragMove', x: 40, y: 10 },
    ]);
  });

  it('reads a release near the press as a tap rather than an order', () => {
    const reader = readerOverNode();
    reader.down({ id: 1, x: 0, y: 0 });
    reader.move({ id: 1, x: SCREEN_SLOP - 1, y: 0 });

    expect(reader.up(1)).toEqual([
      { kind: 'dragCancel' },
      { kind: 'tap', x: SCREEN_SLOP - 1, y: 0 },
    ]);
  });

  it('reads a release past the slop as the end of a drag', () => {
    const reader = readerOverNode();
    reader.down({ id: 1, x: 0, y: 0 });
    reader.move({ id: 1, x: 60, y: 0 });

    expect(reader.up(1)).toEqual([{ kind: 'dragEnd', x: 60, y: 0 }]);
  });

  it('pans the view when it lands on nothing', () => {
    const reader = readerOverNode();

    expect(reader.down({ id: 1, x: 200, y: 200 })).toEqual([]);
    expect(reader.move({ id: 1, x: 190, y: 205 })).toEqual([
      { kind: 'pan', dx: -10, dy: 5 },
    ]);
  });

  it('taps open water without ending a drag that never started', () => {
    const reader = readerOverNode();
    reader.down({ id: 1, x: 200, y: 200 });

    expect(reader.up(1)).toEqual([{ kind: 'tap', x: 200, y: 200 }]);
  });

  it('drops the drag when the system takes the touch away', () => {
    const reader = readerOverNode();
    reader.down({ id: 1, x: 0, y: 0 });

    expect(reader.cancel(1)).toEqual([{ kind: 'dragCancel' }]);
    expect(reader.up(1)).toEqual([]);
  });
});

describe('two fingers', () => {
  it('calls off a drag the first finger had opened', () => {
    const reader = readerOverNode();
    reader.down({ id: 1, x: 0, y: 0 });

    expect(reader.down({ id: 2, x: 100, y: 0 })).toEqual([{ kind: 'dragCancel' }]);
  });

  it('zooms by how much the gap between them grew', () => {
    const reader = readerOverNode();
    reader.down({ id: 1, x: 100, y: 0 });
    reader.down({ id: 2, x: 200, y: 0 });

    const spread = reader.move({ id: 2, x: 300, y: 0 });

    // The gap went from 100 to 200, about a midpoint that slid 50 to the right.
    expect(spread).toEqual([
      { kind: 'pan', dx: 50, dy: 0 },
      { kind: 'pinch', factor: 2, x: 200, y: 0 },
    ]);
  });

  it('slides the view by however far both of them went', () => {
    const reader = readerOverNode();
    reader.down({ id: 1, x: 100, y: 100 });
    reader.down({ id: 2, x: 200, y: 100 });

    // One finger at a time, because that is how the events arrive.
    const moved = [
      ...reader.move({ id: 1, x: 120, y: 130 }),
      ...reader.move({ id: 2, x: 220, y: 130 }),
    ];

    const panned = only(moved, 'pan').reduce(
      (total, pan) => ({ dx: total.dx + pan.dx, dy: total.dy + pan.dy }),
      { dx: 0, dy: 0 },
    );
    const zoomed = only(moved, 'pinch').reduce((total, pinch) => total * pinch.factor, 1);

    expect(panned).toEqual({ dx: 20, dy: 30 });
    // The gap between them never changed, so the board must not have resized.
    expect(zoomed).toBeCloseTo(1);
  });

  it('leaves the survivor panning rather than back in a drag', () => {
    const reader = readerOverNode();
    reader.down({ id: 1, x: 0, y: 0 });
    reader.down({ id: 2, x: 100, y: 0 });
    reader.up(2);

    expect(kinds(reader.move({ id: 1, x: 30, y: 0 }))).toEqual(['pan']);
  });

  it('ignores a third finger', () => {
    const reader = readerOverNode();
    reader.down({ id: 1, x: 100, y: 0 });
    reader.down({ id: 2, x: 200, y: 0 });

    expect(reader.down({ id: 3, x: 150, y: 80 })).toEqual([]);
    expect(reader.move({ id: 3, x: 150, y: 200 })).toEqual([]);
    expect(kinds(reader.move({ id: 2, x: 300, y: 0 }))).toEqual(['pan', 'pinch']);
  });
});
