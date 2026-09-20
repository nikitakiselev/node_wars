import { describe, expect, test } from 'vitest';
import { makeNode, makeState } from './fixtures';
import { nodeAtPoint, squadPosition } from './geometry';

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
