import { defenceMultiplier, growthMultiplier } from '../core/kinds';
import { MAX_LEVEL, capacityForLevel, upgradeCost } from '../core/levels';

export interface HelpTable {
  head: string[];
  rows: string[][];
}

export interface HelpSection {
  title: string;
  lines: string[];
  table?: HelpTable;
}

const LEVELS = Array.from({ length: MAX_LEVEL }, (_, index) => index + 1);

/**
 * The rules, short enough to read standing up.
 *
 * Every number here is read from the tables the game actually plays by, so
 * tuning the balance cannot leave the help saying something else.
 */
export function helpSections(): HelpSection[] {
  return [
    {
      title: 'Цель',
      lines: ['Забрать сеть целиком. Партия кончается, когда в живых остаётся один.'],
    },
    {
      title: 'Атака',
      lines: [
        'Тяните от своего узла к соседнему.',
        'Перетаскивание — все очки, Shift — половина, Alt — четверть.',
        'Атака вровень с обороной узел не берёт: нужен хотя бы один лишний отряд.',
      ],
    },
    {
      title: 'Уровни',
      lines: [
        'Число в узле — очки. Сам он растёт только до потолка, выше — лишь подвозом.',
        'Кликните свой узел и нажмите +, чтобы поднять потолок. Платит сам узел.',
      ],
      table: {
        head: [],
        rows: [
          ['Уровень', ...LEVELS.map(String)],
          ['Потолок', ...LEVELS.map((level) => String(capacityForLevel(level)))],
          ['Цена', ...LEVELS.map((level) => String(upgradeCost(level) ?? '—'))],
        ],
      },
    },
    {
      title: 'Типы узлов',
      lines: ['Обычный узел от уровня получает только объём, остальные — ещё и своё умение.'],
      table: {
        head: ['', ...LEVELS.map(String)],
        rows: [
          [
            'Крепость, защита',
            ...LEVELS.map((level) => `${defenceMultiplier({ kind: 'fortress', level })}×`),
          ],
          [
            'Ферма, прирост',
            ...LEVELS.map((level) => `${growthMultiplier({ kind: 'farm', level })}×`),
          ],
        ],
      },
    },
    {
      title: 'Провода',
      lines: [
        'Правой кнопкой протяните от своего узла к своему же соседу.',
        'Заполнившийся узел сам отправит по проводу половину — так тыл кормит фронт.',
        'Провод из узла один. Наведите на него мышь и нажмите ×, чтобы убрать.',
        'Атаковать провод не умеет — куда бить, решаете вы.',
      ],
    },
    {
      title: 'Захват',
      lines: [
        'Отбитый у соперника узел теряет уровень. Нейтральный достаётся как есть.',
      ],
    },
    {
      title: 'Пауза',
      lines: ['Esc, и сама собой — когда вы переключаетесь на другое окно.'],
    },
  ];
}

/** Draws the rules into a host element, replacing whatever was there. */
export function renderHelp(host: HTMLElement): void {
  host.replaceChildren();

  for (const section of helpSections()) {
    const heading = document.createElement('h2');
    heading.textContent = section.title;
    host.appendChild(heading);

    for (const line of section.lines) {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      host.appendChild(paragraph);
    }

    if (section.table) host.appendChild(buildTable(section.table));
  }
}

function buildTable(table: HelpTable): HTMLTableElement {
  const element = document.createElement('table');

  if (table.head.length > 0) {
    const head = element.createTHead().insertRow();
    for (const cell of table.head) {
      const th = document.createElement('th');
      th.textContent = cell;
      head.appendChild(th);
    }
  }

  const body = element.createTBody();
  for (const row of table.rows) {
    const line = body.insertRow();
    row.forEach((cell, index) => {
      const element = index === 0 ? document.createElement('th') : document.createElement('td');
      element.textContent = cell;
      line.appendChild(element);
    });
  }

  return element;
}
