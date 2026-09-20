import { Application } from 'pixi.js';
import type { Difficulty } from '../ai/ai';
import { standingsFor } from '../core/standings';
import { PointerControls } from '../input/pointer';
import { GameRenderer } from '../render/renderer';
import { COLORS, factionOf } from '../render/theme';
import {
  HUMAN,
  MAP_DIFFICULTIES,
  MAP_SIZES,
  MAX_OPPONENTS,
  Match,
  STEP_SECONDS,
  WORLD,
  defaultSettings,
  type MatchSettings,
} from './match';
import { buildChoices, readChoice } from './settings-form';
import './style.css';

const app = new Application();
await app.init({
  background: COLORS.waterDeep,
  antialias: true,
  resizeTo: window,
  resolution: Math.min(window.devicePixelRatio, 2),
  autoDensity: true,
});
document.getElementById('board')!.appendChild(app.canvas);

// The simulation steps at 30 Hz and nothing on screen moves faster than the
// eye follows, so drawing 120 times a second on a high-refresh display only
// heats the machine.
app.ticker.maxFPS = 60;

const renderer = new GameRenderer(app, WORLD.width, WORLD.height);
renderer.layout();
app.renderer.on('resize', () => renderer.layout());

const hud = {
  tide: document.querySelector<HTMLElement>('[data-tide]')!,
  readout: document.querySelector<HTMLElement>('[data-readout]')!,
  seed: document.querySelector<HTMLElement>('[data-seed]')!,
  verdict: document.querySelector<HTMLElement>('.verdict')!,
  verdictText: document.querySelector<HTMLElement>('[data-verdict]')!,
};

const dialog = document.querySelector<HTMLDialogElement>('.setup')!;
let settings: MatchSettings = { ...defaultSettings(), seed: randomSeed() };
let match = new Match(settings);
let seats: { bar: HTMLElement; nodes: HTMLElement; points: HTMLElement }[] = [];

const controls = new PointerControls(
  { canvas: app.canvas, toWorld: (x, y) => renderer.toWorld(x, y) },
  HUMAN,
  () => match.state,
);

buildSettingsForm();
startMatch(settings);
dialog.showModal();
app.ticker.stop();

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

function buildSettingsForm(): void {
  buildChoices(dialog, 'mapSize', MAP_SIZES, settings.mapSize);
  buildChoices(dialog, 'mapDifficulty', MAP_DIFFICULTIES, settings.mapDifficulty);
  buildChoices(dialog, 'aiCount', opponentChoices(), String(settings.aiCount));
  buildChoices(
    dialog,
    'difficulty',
    { easy: { label: 'Спокойно' }, normal: { label: 'Ровно' }, hard: { label: 'Жёстко' } },
    settings.difficulty,
  );
}

/** One option per possible opponent, named the way a person would say it. */
function opponentChoices(): Record<string, { label: string }> {
  const names = ['Один', 'Двое', 'Трое', 'Четверо', 'Пятеро'];
  const choices: Record<string, { label: string }> = {};
  for (let count = 1; count <= MAX_OPPONENTS; count++) {
    choices[count] = { label: names[count - 1] ?? String(count) };
  }
  return choices;
}

dialog.addEventListener('close', () => {
  app.ticker.start();
  if (dialog.returnValue !== 'start') return;

  settings = {
    seed: randomSeed(),
    mapSize: readChoice(dialog, 'mapSize') as MatchSettings['mapSize'],
    mapDifficulty: readChoice(dialog, 'mapDifficulty') as MatchSettings['mapDifficulty'],
    aiCount: Number(readChoice(dialog, 'aiCount')),
    difficulty: readChoice(dialog, 'difficulty') as Difficulty,
  };
  startMatch(settings);
});

for (const button of document.querySelectorAll('[data-open-settings]')) {
  button.addEventListener('click', () => {
    dialog.showModal();
    // Nothing behind the dialog is worth drawing, and the match should not
    // run on while you are setting up the next one.
    app.ticker.stop();
  });
}

function startMatch(next: MatchSettings): void {
  match = new Match(next);
  renderer.build(match.state);
  buildScoreboard(next.aiCount + 1);
  hud.seed.textContent = `Карта ${next.seed}`;
  hud.verdict.hidden = true;

  // One frame right away: the board sits visible behind the setup dialog
  // while the ticker is stopped, and drawing the scene is not the same as
  // putting it on the canvas — with the ticker paused, nothing else will.
  renderer.draw(match.state, 0, STEP_SECONDS, controls.hint);
  paintHud();
  app.render();
}

/** Rebuilds the scoreboard, which has one seat per player in the match. */
function buildScoreboard(playerCount: number): void {
  hud.tide.replaceChildren();
  hud.readout.replaceChildren();
  seats = [];

  for (let player = 0; player < playerCount; player++) {
    const faction = factionOf(player);
    const colour = `#${faction.glow.toString(16).padStart(6, '0')}`;

    const bar = document.createElement('div');
    bar.className = 'tide__seat';
    bar.style.background = colour;
    bar.style.boxShadow = `0 0 14px ${colour}99`;
    hud.tide.appendChild(bar);

    const row = document.createElement('span');
    row.className = 'side';
    const nodes = document.createElement('b');
    const points = document.createElement('b');
    nodes.style.color = colour;
    points.style.color = colour;
    row.append(`${faction.label}: `, nodes, ' узлов, ', points, ' очков');
    hud.readout.appendChild(row);

    seats.push({ bar, nodes, points });
  }
}

app.ticker.add((ticker) => {
  match.advance(Math.min(ticker.deltaMS / 1000, 0.25));
  renderer.draw(match.state, match.alpha, STEP_SECONDS, controls.hint);
  paintHud();
});

function paintHud(): void {
  seats.forEach((seat, player) => {
    const standing = standingsFor(match.state, player);
    seat.bar.style.width = `${standing.share * 100}%`;
    seat.nodes.textContent = String(standing.nodes);
    seat.points.textContent = String(Math.round(standing.points));
  });

  const winner = match.state.winner;
  if (winner === null) return;
  hud.verdict.hidden = false;
  hud.verdictText.textContent =
    winner === HUMAN ? 'Сеть ваша' : `Сеть потеряна: ${factionOf(winner).label}`;
}
