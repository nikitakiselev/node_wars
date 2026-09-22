import { describe, expect, test } from 'vitest';
import { bearingName, outputNames } from './outputs';

const hub = { id: 0, x: 100, y: 100 };

describe('which way an output lies', () => {
  test('reads the compass the way the board is drawn, south downwards', () => {
    expect(bearingName(hub, { id: 1, x: 200, y: 100 })).toBe('восток');
    expect(bearingName(hub, { id: 1, x: 100, y: 200 })).toBe('юг');
    expect(bearingName(hub, { id: 1, x: 0, y: 100 })).toBe('запад');
    expect(bearingName(hub, { id: 1, x: 100, y: 0 })).toBe('север');
    expect(bearingName(hub, { id: 1, x: 180, y: 180 })).toBe('юго-восток');
  });
});

describe('naming the outputs of a hub', () => {
  test('a direction on its own when nothing shares it', () => {
    const names = outputNames(hub, [
      { id: 1, x: 200, y: 100 },
      { id: 2, x: 100, y: 200 },
    ]);

    expect(names.get(1)).toBe('На восток');
    expect(names.get(2)).toBe('На юг');
  });

  test('two in one direction are told apart by how far off they are', () => {
    const names = outputNames(hub, [
      { id: 1, x: 20, y: 105 },
      { id: 2, x: 60, y: 95 },
    ]);

    expect(names.get(2)).toBe('На запад, ближний');
    expect(names.get(1)).toBe('На запад, дальний');
  });

  test('three get a middle one', () => {
    const names = outputNames(hub, [
      { id: 1, x: 10, y: 100 },
      { id: 2, x: 50, y: 100 },
      { id: 3, x: 30, y: 100 },
    ]);

    expect(names.get(2)).toBe('На запад, ближний');
    expect(names.get(3)).toBe('На запад, средний');
    expect(names.get(1)).toBe('На запад, дальний');
  });

  test('no two rows ever read alike, however the neighbours are arranged', () => {
    const crowded = [
      { id: 1, x: 40, y: 100 },
      { id: 2, x: 30, y: 102 },
      { id: 3, x: 20, y: 98 },
      { id: 4, x: 10, y: 101 },
      { id: 5, x: 100, y: 10 },
    ];

    const names = [...outputNames(hub, crowded).values()];

    expect(names).toHaveLength(crowded.length);
    expect(new Set(names).size).toBe(crowded.length);
  });

  test('nothing wired is nothing named', () => {
    expect(outputNames(hub, []).size).toBe(0);
  });
});
