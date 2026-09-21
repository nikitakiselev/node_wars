import { describe, expect, test } from 'vitest';
import { makeNode } from './fixtures';
import { MAX_LEVEL } from './levels';
import { auraMultiplier, defenceMultiplier, growthMultiplier } from './kinds';
import type { NodeKind } from './state';

function at(kind: NodeKind, level: number) {
  return makeNode(0, { kind, level });
}

describe('what a level is worth to each kind', () => {
  test('a plain node gets nothing but room', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      expect(defenceMultiplier(at('base', level)), `level ${level}`).toBe(1);
      expect(growthMultiplier(at('base', level)), `level ${level}`).toBe(1);
      expect(auraMultiplier(at('base', level)), `level ${level}`).toBe(1);
    }
  });

  test('only a core carries an aura', () => {
    for (const kind of ['base', 'fortress', 'farm'] as const) {
      expect(auraMultiplier(at(kind, MAX_LEVEL)), kind).toBe(1);
    }
    expect(auraMultiplier(at('core', 1))).toBeGreaterThan(1);
  });

  test('a core speeds the network up more as it is built up', () => {
    for (let level = 1; level < MAX_LEVEL; level++) {
      expect(auraMultiplier(at('core', level + 1))).toBeGreaterThan(
        auraMultiplier(at('core', level)),
      );
    }
  });

  test('a core is not a farm: it earns at the plain rate itself', () => {
    expect(growthMultiplier(at('core', MAX_LEVEL))).toBe(1);
  });

  test('walls get thicker as a fortress is built up', () => {
    for (let level = 1; level < MAX_LEVEL; level++) {
      expect(defenceMultiplier(at('fortress', level + 1))).toBeGreaterThan(
        defenceMultiplier(at('fortress', level)),
      );
    }
  });

  test('a new fortress is a nuisance and a finished one is a wall', () => {
    expect(defenceMultiplier(at('fortress', 1))).toBeCloseTo(1.2);
    expect(defenceMultiplier(at('fortress', MAX_LEVEL))).toBeCloseTo(2);
  });

  test('a fortress earns no faster for being a fortress', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      expect(growthMultiplier(at('fortress', level)), `level ${level}`).toBe(1);
    }
  });

  test('a farm earns more as it is built up', () => {
    for (let level = 1; level < MAX_LEVEL; level++) {
      expect(growthMultiplier(at('farm', level + 1))).toBeGreaterThan(
        growthMultiplier(at('farm', level)),
      );
    }
  });

  test('a finished farm earns two and a half times a plain node', () => {
    expect(growthMultiplier(at('farm', 1))).toBeCloseTo(1.4);
    expect(growthMultiplier(at('farm', MAX_LEVEL))).toBeCloseTo(2.5);
  });

  test('a farm is no harder to take for being a farm', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      expect(defenceMultiplier(at('farm', level)), `level ${level}`).toBe(1);
    }
  });

  test('levels outside the table are clamped rather than undefined', () => {
    expect(defenceMultiplier(at('fortress', 0))).toBeCloseTo(1.2);
    expect(growthMultiplier(at('farm', 99))).toBeCloseTo(2.5);
  });
});
