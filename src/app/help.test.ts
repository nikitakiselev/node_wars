import { describe, expect, test } from 'vitest';
import { auraMultiplier, defenceMultiplier, growthMultiplier } from '../core/kinds';
import { MAX_LEVEL, capacityForLevel, upgradeCost } from '../core/levels';
import { helpSections } from './help';

const sections = helpSections();

describe('the rules panel', () => {
  test('covers what a new player has to be told', () => {
    const titles = sections.map((s) => s.title).join(' ').toLowerCase();

    for (const topic of [
      'цель',
      'атак',
      'уровн',
      'тип',
      'провод',
      'захват',
      'обзор',
      'пауз',
    ]) {
      expect(titles, topic).toContain(topic);
    }
  });

  test('stays short enough to read at a glance', () => {
    expect(sections.length).toBeLessThanOrEqual(8);

    for (const section of sections) {
      expect(section.lines.length, section.title).toBeLessThanOrEqual(4);
      for (const line of section.lines) {
        expect(line.length, line).toBeLessThanOrEqual(100);
      }
    }
  });

  test('every section says something', () => {
    for (const section of sections) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.lines.length + (section.table ? 1 : 0)).toBeGreaterThan(0);
    }
  });

  test('the level table is the real one, not a copy that can drift', () => {
    // The level table is transposed: it reads better as rows in a narrow panel.
    const table = sections.find((s) => s.table?.rows[0]?.[0] === 'Уровень')?.table;
    expect(table).toBeDefined();
    expect(table!.rows).toHaveLength(3);

    const [levels, caps, costs] = table!.rows;
    expect(levels!.slice(1)).toEqual(
      Array.from({ length: MAX_LEVEL }, (_, i) => String(i + 1)),
    );
    expect(caps!.slice(1)).toEqual(
      Array.from({ length: MAX_LEVEL }, (_, i) => String(capacityForLevel(i + 1))),
    );
    expect(costs!.slice(1)).toEqual(
      Array.from({ length: MAX_LEVEL }, (_, i) => String(upgradeCost(i + 1) ?? '—')),
    );
  });

  test('the kind table reads its multipliers from the game, not from prose', () => {
    const table = sections.find((s) => s.table?.rows.some((r) => r[0]?.includes('Крепость')))
      ?.table;
    expect(table).toBeDefined();

    const fortress = table!.rows.find((r) => r[0]!.includes('Крепость'))!;
    const farm = table!.rows.find((r) => r[0]!.includes('Ферма'))!;
    const core = table!.rows.find((r) => r[0]!.includes('Ядро'))!;

    for (let level = 1; level <= MAX_LEVEL; level++) {
      expect(fortress[level]).toBe(`${defenceMultiplier({ kind: 'fortress', level })}×`);
      expect(farm[level]).toBe(`${growthMultiplier({ kind: 'farm', level })}×`);
      expect(core[level]).toBe(`${auraMultiplier({ kind: 'core', level })}×`);
    }
  });

  test('tells the player which key sends what', () => {
    const everything = sections.flatMap((s) => s.lines).join(' ');

    expect(everything).toContain('Shift');
    expect(everything).toContain('Alt');
    expect(everything).toContain('Esc');
  });
});

describe('the rules on a touch screen', () => {
  const touch = helpSections('touch');
  const everything = touch.flatMap((s) => s.lines).join(' ');

  test('covers exactly the same ground', () => {
    expect(touch.map((s) => s.title)).toEqual(sections.map((s) => s.title));
  });

  test('never explains a phone with a mouse it does not have', () => {
    for (const word of ['Shift', 'Alt', 'Esc', 'мыш', 'Колесо', 'Правой', 'Кликн']) {
      expect(everything.toLowerCase(), word).not.toContain(word.toLowerCase());
    }
  });

  test('names the bar, the menu and the gestures a finger uses instead', () => {
    expect(everything).toContain('Провод');
    expect(everything).toContain('пальц');
    // The footer holds one button on a phone; everything else is behind it.
    expect(everything).toContain('Меню');
  });

  test('stays as short as the version written for a mouse', () => {
    for (const section of touch) {
      expect(section.lines.length, section.title).toBeLessThanOrEqual(4);
      for (const line of section.lines) {
        expect(line.length, line).toBeLessThanOrEqual(100);
      }
    }
  });

  test('keeps the tables, which are the same rules either way', () => {
    touch.forEach((section, index) => {
      expect(section.table).toEqual(sections[index]!.table);
    });
  });
});
