import { describe, expect, test } from 'vitest';
import { makeNode } from './fixtures';
import {
  MAX_LEVEL,
  applyLevel,
  capacityForLevel,
  radiusForLevel,
  upgradeCost,
} from './levels';

describe('the level table', () => {
  test('capacity climbs with every level', () => {
    for (let level = 1; level < MAX_LEVEL; level++) {
      expect(capacityForLevel(level + 1)).toBeGreaterThan(capacityForLevel(level));
    }
  });

  test('a node starts at twenty-five points of room and reaches two hundred forty', () => {
    expect(capacityForLevel(1)).toBe(25);
    expect(capacityForLevel(MAX_LEVEL)).toBe(240);
  });

  test('radius grows too, but never far enough for nodes to touch', () => {
    for (let level = 1; level < MAX_LEVEL; level++) {
      expect(radiusForLevel(level + 1)).toBeGreaterThan(radiusForLevel(level));
    }
    // The densest board puts nodes 108 units apart.
    expect(radiusForLevel(MAX_LEVEL) * 2).toBeLessThan(108);
  });

  test('radius grows more slowly than capacity, so big nodes stay legible', () => {
    const capacityRatio = capacityForLevel(MAX_LEVEL) / capacityForLevel(1);
    const radiusRatio = radiusForLevel(MAX_LEVEL) / radiusForLevel(1);

    expect(radiusRatio).toBeLessThan(capacityRatio);
  });

  test('an upgrade costs the room it adds', () => {
    for (let level = 1; level < MAX_LEVEL; level++) {
      expect(upgradeCost(level)).toBe(capacityForLevel(level + 1) - capacityForLevel(level));
    }
  });

  test('there is nothing to buy at the top level', () => {
    expect(upgradeCost(MAX_LEVEL)).toBeNull();
  });
});

describe('applyLevel', () => {
  test('moves level, capacity and radius together', () => {
    const node = makeNode(0);

    applyLevel(node, 4);

    expect(node.level).toBe(4);
    expect(node.capacity).toBe(capacityForLevel(4));
    expect(node.radius).toBe(radiusForLevel(4));
  });

  test('refuses to go below the first level or above the last', () => {
    const node = makeNode(0);

    applyLevel(node, 0);
    expect(node.level).toBe(1);

    applyLevel(node, 99);
    expect(node.level).toBe(MAX_LEVEL);
  });

  test('leaves the garrison alone, even when it now exceeds the cap', () => {
    const node = makeNode(0, { points: 200 });

    applyLevel(node, 1);

    expect(node.points).toBe(200);
  });
});
