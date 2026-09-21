import { describe, expect, test } from 'vitest';
import { setWire } from '../core/wires';
import { HUMAN, Match, defaultSettings } from './match';
import { SAVE_VERSION, clearSave, describeSave, loadSave, writeSave } from './save';

/** localStorage without a browser. */
function storage(): Storage {
  const held = new Map<string, string>();
  return {
    get length() {
      return held.size;
    },
    clear: () => held.clear(),
    getItem: (key) => held.get(key) ?? null,
    key: (index) => [...held.keys()][index] ?? null,
    removeItem: (key) => void held.delete(key),
    setItem: (key, value) => void held.set(key, value),
  };
}

function played() {
  const match = new Match({ ...defaultSettings(), seed: 4242 });
  for (let frame = 0; frame < 60 * 30; frame++) match.advance(1 / 60);
  return match;
}

describe('saving a match', () => {
  test('brings the board back exactly as it was', () => {
    const where = storage();
    const match = played();

    writeSave(where, match);
    const back = loadSave(where);

    expect(back).not.toBeNull();
    expect(back!.state).toEqual(match.state);
  });

  test('brings back the settings the match was started with', () => {
    const where = storage();
    const match = new Match({ ...defaultSettings(), seed: 77, aiCount: 3, mapSize: 'large' });

    writeSave(where, match);

    expect(loadSave(where)!.settings).toEqual(match.settings);
  });

  test('keeps the supply wires, holes and all', () => {
    const where = storage();
    const match = played();
    const mine = match.state.nodes.find((node) => node.owner === 0)!;
    const neighbour = match.state.adjacency[mine.id]!.find(
      (id) => match.state.nodes[id]!.owner === 0,
    );
    if (neighbour !== undefined) setWire(match.state, 0, mine.id, neighbour);

    writeSave(where, match);
    const back = loadSave(where)!;

    // JSON turns a hole in an array into null; a wire of null is not a wire.
    expect(back.state.wires).toEqual(match.state.wires);
    for (const wire of back.state.wires) {
      expect(wire === undefined || typeof wire === 'number').toBe(true);
    }
  });

  test('a second save replaces the first', () => {
    const where = storage();
    const first = new Match({ ...defaultSettings(), seed: 1 });
    const second = new Match({ ...defaultSettings(), seed: 2 });

    writeSave(where, first);
    writeSave(where, second);

    expect(loadSave(where)!.settings.seed).toBe(2);
  });
});

describe('a save that cannot be used', () => {
  test('nothing saved reads as nothing', () => {
    expect(loadSave(storage())).toBeNull();
  });

  test('a save from another version is refused', () => {
    const where = storage();
    writeSave(where, played());
    const raw = JSON.parse(where.getItem('node-wars/save')!);
    raw.version = SAVE_VERSION + 1;
    where.setItem('node-wars/save', JSON.stringify(raw));

    expect(loadSave(where)).toBeNull();
  });

  test('a half-written save is refused rather than half-loaded', () => {
    const where = storage();
    writeSave(where, played());
    const raw = JSON.parse(where.getItem('node-wars/save')!);
    delete raw.state.nodes;
    where.setItem('node-wars/save', JSON.stringify(raw));

    expect(loadSave(where)).toBeNull();
  });

  test('nonsense is refused rather than thrown', () => {
    const where = storage();
    where.setItem('node-wars/save', '{ not json');

    expect(loadSave(where)).toBeNull();
  });

  test('clearing it leaves nothing behind', () => {
    const where = storage();
    writeSave(where, played());

    clearSave(where);

    expect(loadSave(where)).toBeNull();
  });

  test('a storage that refuses to write does not take the game down', () => {
    const full: Storage = {
      ...storage(),
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };

    expect(() => writeSave(full, played())).not.toThrow();
  });
});

describe('describing a save', () => {
  test('names the map and how much of it is yours', () => {
    const where = storage();
    const match = played();
    writeSave(where, match);

    const line = describeSave(loadSave(where)!);

    const mine = match.state.nodes.filter((node) => node.owner === HUMAN).length;
    expect(line).toContain(String(match.settings.seed));
    expect(line).toContain(`${mine} из ${match.state.nodes.length}`);
  });
});
