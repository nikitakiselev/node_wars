import { Application } from 'pixi.js';
import type { Difficulty } from '../ai/ai';
import { isEliminated } from '../core/simulation';
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
const setupForm = dialog.querySelector('form')!;

let settings: MatchSettings = { ...defaultSettings(), seed: randomSeed() };
let match = new Match(settings);
let seats: { bar: HTMLElement; nodes: HTMLElement; points: HTMLElement }[] = [];
/** The match to return to if the setup dialog is dismissed without starting. */
let resumed: Match = match;
/** Until the first match is started there is nothing to dismiss the dialog to. */
let started = false;

const controls = new PointerControls(
  { canvas: app.canvas, toWorld: (x, y) => renderer.toWorld(x, y) },
  HUMAN,
  () => match.state,
);

buildSettingsForm();
showMatch(match);
openSettings();

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

/** The settings the dialog currently describes, on the seed being previewed. */
function settingsFromForm(seed: number): MatchSettings {
  return {
    seed,
    mapSize: readChoice(dialog, 'mapSize') as MatchSettings['mapSize'],
    mapDifficulty: readChoice(dialog, 'mapDifficulty') as MatchSettings['mapDifficulty'],
    aiCount: Number(readChoice(dialog, 'aiCount')),
    difficulty: readChoice(dialog, 'difficulty') as Difficulty,
  };
}

function openSettings(): void {
  resumed = match;
  // The board behind the dialog is the board you are about to play, so every
  // change to the form redraws it on one fixed seed: only the setting you
  // touched moves, not the whole map.
  showMatch(new Match(settingsFromForm(randomSeed())));
  dialog.showModal();
  app.ticker.stop();
}

setupForm.addEventListener('change', () => {
  showMatch(new Match(settingsFromForm(match.settings.seed)));
});

// Escape closes a <dialog> by default. On the very first visit that would
// drop the player into a match they never started, so it is refused until
// one has been.
dialog.addEventListener('cancel', (event) => {
  if (!started) event.preventDefault();
});

dialog.addEventListener('close', () => {
  // Dismissing the dialog puts the match that was running back on screen; the
  // preview was only ever a preview.
  if (dialog.returnValue !== 'start') {
    showMatch(resumed);
  } else {
    started = true;
  }
  settings = match.settings;
  app.ticker.start();
});

for (const button of document.querySelectorAll('[data-open-settings]')) {
  button.addEventListener('click', openSettings);
}

/** Puts a match on screen and paints one frame of it. */
function showMatch(next: Match): void {
  match = next;
  renderer.build(match.state);
  renderer.markHome(match.state.nodes.find((node) => node.owner === HUMAN)?.id ?? null);
  buildScoreboard(match.settings.aiCount + 1);
  hud.seed.textContent = `Карта ${match.settings.seed}`;
  hud.verdict.hidden = verdictFor() === null;

  // Drawing the scene is not the same as putting it on the canvas: while the
  // ticker is paused for the dialog, nothing else will.
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

  const verdict = verdictFor();
  if (verdict === null) return;
  hud.verdict.hidden = false;
  hud.verdictText.textContent = verdict;
}

/**
 * What to tell the player, or null while the match is still theirs to play.
 *
 * Being wiped out ends your match even when the bots fight on among
 * themselves, so this does not wait for an overall winner.
 */
function verdictFor(): string | null {
  const winner = match.state.winner;
  if (winner === HUMAN) return 'Сеть ваша';
  if (winner !== null) return `Сеть потеряна: победил ${factionOf(winner).label}`;
  if (isEliminated(match.state, HUMAN)) return 'Сеть потеряна';
  return null;
}
