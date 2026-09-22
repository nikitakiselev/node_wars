import { describe, expect, test } from 'vitest';
import { makeNode, makeState } from './fixtures';
import { setWire } from './wires';
import { nodeAtPoint, squadPosition, wireAtPoint, wireMidpoint } from './geometry';

describe('nodeAtPoint', () => {
  const state = makeState(
    [makeNode(0, { x: 100, y: 100, radius: 20 }), makeNode(1, { x: 300, y: 100, radius: 30 })],
    [[0, 1]],
  );

  test('finds the node under the cursor', () => {
    expect(nodeAtPoint(state, 105, 95)?.id).toBe(0);
  });

  test('returns null when the cursor is on empty space', () => {
    expect(nodeAtPoint(state, 200, 400)).toBeNull();
  });

  test('accepts a click slightly outside the circle so small nodes stay clickable', () => {
    expect(nodeAtPoint(state, 100 + 20 + 6, 100)?.id).toBe(0);
  });

  test('prefers the nearest node when two are within reach', () => {
    const crowded = makeState(
      [makeNode(0, { x: 0, y: 0, radius: 30 }), makeNode(1, { x: 40, y: 0, radius: 30 })],
      [],
    );

    expect(nodeAtPoint(crowded, 30, 0)?.id).toBe(1);
  });
});

describe('squadPosition', () => {
  const state = makeState(
    [makeNode(0, { x: 0, y: 0 }), makeNode(1, { x: 100, y: 0 })],
    [[0, 1]],
  );
  const squad = { id: 1, owner: 0, from: 0, to: 1, amount: 5, progress: 0.25, speed: 1 };

  test('sits at the source when it has just left', () => {
    expect(squadPosition(state, { ...squad, progress: 0 })).toEqual({ x: 0, y: 0 });
  });

  test('sits at the target on arrival', () => {
    expect(squadPosition(state, { ...squad, progress: 1 })).toEqual({ x: 100, y: 0 });
  });

  test('interpolates linearly in between', () => {
    expect(squadPosition(state, squad)).toEqual({ x: 25, y: 0 });
  });

  test('extrapolates past the target when asked, for render smoothing', () => {
    expect(squadPosition(state, { ...squad, progress: 1.1 }).x).toBeCloseTo(110);
  });
});

describe('wireAtPoint', () => {
  function wired() {
    const state = makeState(
      [
        makeNode(0, { x: 0, y: 0, owner: 0, radius: 20 }),
        makeNode(1, { x: 200, y: 0, owner: 0, radius: 20 }),
        makeNode(2, { x: 0, y: 400, owner: 0, radius: 20 }),
      ],
      [
        [0, 1],
        [0, 2],
      ],
    );
    setWire(state, 0, 0, 1);
    return state;
  }

  test('finds the wire the cursor is resting on', () => {
    expect(wireAtPoint(wired(), 100, 3)).toEqual({ from: 0, to: 1 });
  });

  test('ignores a cursor well clear of the line', () => {
    expect(wireAtPoint(wired(), 100, 60)).toBeNull();
  });

  test('ignores a cursor past either end of the line', () => {
    expect(wireAtPoint(wired(), -80, 0)).toBeNull();
    expect(wireAtPoint(wired(), 280, 0)).toBeNull();
  });

  test('finds nothing where no wire has been laid', () => {
    expect(wireAtPoint(wired(), 0, 200)).toBeNull();
  });

  test('picks the nearer wire when two run close together', () => {
    const state = wired();
    setWire(state, 0, 2, 0);

    expect(wireAtPoint(state, 4, 300)).toEqual({ from: 2, to: 0 });
  });
});

describe('wireMidpoint', () => {
  test('sits halfway along the wire', () => {
    const state = makeState(
      [makeNode(0, { x: 0, y: 0, owner: 0 }), makeNode(1, { x: 200, y: 100, owner: 0 })],
      [[0, 1]],
    );
    setWire(state, 0, 0, 1);

    expect(wireMidpoint(state, { from: 0, to: 1 })).toEqual({ x: 100, y: 50 });
  });

  test('is nothing when the node has no wire', () => {
    const state = makeState([makeNode(0, { owner: 0 })], []);

    expect(wireMidpoint(state, { from: 0, to: 1 })).toBeNull();
  });

  test('is nothing for a wire that is not there, though its neighbours are', () => {
    const state = makeState(
      [makeNode(0, { owner: 0 }), makeNode(1, { owner: 0 })],
      [[0, 1]],
    );

    expect(wireMidpoint(state, { from: 0, to: 1 })).toBeNull();
  });
});
