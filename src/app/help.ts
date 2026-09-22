import { BALANCER_COST, MIN_BALANCER_NEIGHBOURS } from '../core/convert';
import { auraMultiplier, defenceMultiplier, growthMultiplier } from '../core/kinds';
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

/** What the player has in their hand. */
export type Controls = 'mouse' | 'touch';

/**
 * The rules, short enough to read standing up.
 *
 * Every number here is read from the tables the game actually plays by, so
 * tuning the balance cannot leave the help saying something else.
 *
 * The rules themselves are one set; only the sentences about how to give an
 * order differ, because a phone has no right button, no modifier keys and no
 * Escape. Telling a player to right-click on a screen with no mouse is the
 * same kind of lie as a stale number, so the panel asks which it is talking to.
 */
export function helpSections(controls: Controls = 'mouse'): HelpSection[] {
  const touch = controls === 'touch';

  return [
    {
      title: 'Цель',
      lines: ['Забрать сеть целиком. Партия кончается, когда в живых остаётся один.'],
    },
    {
      title: 'Атака',
      lines: [
        touch
          ? 'Ведите пальцем от своего узла к соседнему.'
          : 'Тяните от своего узла к соседнему.',
        touch
          ? 'Сколько отправить — «Всё», «½» или «¼» — выбирается на полосе внизу.'
          : 'Перетаскивание — все очки, Shift — половина, Alt — четверть.',
        'Атака вровень с обороной узел не берёт: нужен хотя бы один лишний отряд.',
      ],
    },
    {
      title: 'Уровни',
      lines: [
        'Число в узле — очки. Сам он растёт только до потолка, выше — лишь подвозом.',
        touch
          ? 'Коснитесь своего узла и нажмите +, чтобы поднять потолок. Платит сам узел.'
          : 'Кликните свой узел и нажмите +, чтобы поднять потолок. Платит сам узел.',
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
      lines: [
        'Обычный узел от уровня получает только объём, остальные — ещё и своё умение.',
        'Ядро на карте одно, посередине. Пока оно ваше, быстрее растёт вся ваша сеть.',
        `Узел ${MAX_LEVEL} уровня с ${MIN_BALANCER_NEIGHBOURS} своими соседями строится в балансировщик за ${BALANCER_COST}.`,
        'Балансировщик не зарабатывает и не копит: пришедшее сразу уходит по его проводам.',
      ],
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
          [
            'Ядро, вся сеть',
            ...LEVELS.map((level) => `${auraMultiplier({ kind: 'core', level })}×`),
          ],
        ],
      },
    },
    {
      title: 'Провода',
      lines: [
        touch
          ? 'Включите «Провод» на полосе внизу и проведите пальцем к своему же соседу.'
          : 'Правой кнопкой протяните от своего узла к своему же соседу.',
        'Наполнившись, узел отправит дальше половину, а половину оставит себе.',
        touch
          ? 'Из узла один провод, из балансировщика — к каждому соседу. Убрать: тем же режимом.'
          : 'Из узла один провод, из балансировщика — к каждому соседу. Убрать: навести и ×.',
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
      title: 'Обзор',
      lines: touch
        ? [
            'Карта двигается одним пальцем по пустому месту.',
            'Двумя пальцами, щипком, — приблизить и отдалить.',
            'Полоска справа — тот же масштаб, но одной рукой.',
          ]
        : [
            'Колесо мыши приближает и отдаляет — там, где стоит курсор.',
            'Тянуть карту: средней кнопкой или левой по пустому месту.',
          ],
    },
    {
      title: 'Пауза и сохранение',
      lines: [
        touch
          ? 'Кнопка ☰ внизу открывает Меню: пауза, правила, новая партия, сохранение.'
          : 'Esc ставит на паузу, и она встаёт сама, когда вы уходите в другое окно.',
        'Партия сохраняется по ходу дела: «Продолжить» в окне новой партии вернёт её.',
      ],
    },
  ];
}

/** Draws the rules into a host element, replacing whatever was there. */
export function renderHelp(host: HTMLElement, controls: Controls = 'mouse'): void {
  host.replaceChildren();

  for (const section of helpSections(controls)) {
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
