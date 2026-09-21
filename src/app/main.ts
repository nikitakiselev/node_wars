import { Application } from 'pixi.js';
import type { Difficulty } from '../ai/ai';
import { formatPoints } from '../core/format';
import { defenceMultiplier, growthMultiplier } from '../core/kinds';
import { MAX_LEVEL, upgradeCost } from '../core/levels';
import { wireMidpoint } from '../core/geometry';
import { isEliminated } from '../core/simulation';
import type { GameNode } from '../core/state';
import { upgradeNode } from '../core/upgrade';
import { clearWire } from '../core/wires';
import { standingsFor } from '../core/standings';
import { SEND_MODES, type SendMode } from '../input/fractions';
import { PointerControls } from '../input/pointer';
import { MAX_ZOOM } from '../render/camera';
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
import { renderHelp } from './help';
import { readOptions } from './options';
import { clearSave, describeSave, loadSave, writeSave } from './save';
import { buildChoices, readChoice } from './settings-form';
import './style.css';

const app = new Application();
const boardFrame = document.getElementById('board')!;
await app.init({
  background: COLORS.waterDeep,
  antialias: true,
  // Sized to the board's own box, which is the page, rather than to `window`:
  // an innerHeight read a moment too early leaves a strip along an edge that
  // nothing ever redraws.
  resizeTo: boardFrame,
  resolution: Math.min(window.devicePixelRatio, 2),
  autoDensity: true,
});
boardFrame.appendChild(app.canvas);

// The simulation steps at 30 Hz and nothing on screen moves faster than the
// eye follows, so drawing 120 times a second on a high-refresh display only
// heats the machine.
app.ticker.maxFPS = 60;

const renderer = new GameRenderer(app, WORLD.width, WORLD.height);
renderer.layout();
app.renderer.on('resize', fitBoard);

const options = readOptions(window.location.search);

/**
 * Whether the player is pointing with a finger rather than a cursor.
 *
 * Read once: a device does not grow a mouse mid-match, and the answer decides
 * both which half of the controls the game explains and which of them it lays
 * out — the stylesheet keys off this class rather than asking the device
 * itself, so that ?controls=touch can overrule it.
 */
const touchPlayer =
  options.controls === 'auto'
    ? window.matchMedia('(pointer: coarse)').matches
    : options.controls === 'touch';
document.documentElement.classList.toggle('touch', touchPlayer);

const hudFrame = document.querySelector<HTMLElement>('.hud')!;
const hudTop = document.querySelector<HTMLElement>('[data-hud-top]')!;
const hudBottom = document.querySelector<HTMLElement>('[data-hud-bottom]')!;

/**
 * Hands the board whatever room the HUD is not using.
 *
 * Measured rather than assumed, because the top block grows with the number of
 * players and the bottom one with the mode bar — and on a phone both of them
 * sit inside safe-area padding whose size only the browser knows.
 */
function fitBoard(): void {
  const padding = getComputedStyle(hudFrame);
  const top = hudTop.getBoundingClientRect();
  const bottom = hudBottom.getBoundingClientRect();

  // The strip that keeps the clock and the scoreboard off the board is drawn
  // to the same measurement.
  hudFrame.style.setProperty('--hud-top', `${Math.round(top.bottom)}px`);

  renderer.setInsets({
    top: top.bottom + BOARD_GAP,
    bottom: Math.max(0, window.innerHeight - bottom.top) + BOARD_GAP,
    left: parseFloat(padding.paddingLeft) || 0,
    right: parseFloat(padding.paddingRight) || 0,
  });
}

/** Breathing room between the HUD and the nearest node. */
const BOARD_GAP = 12;

const hud = {
  tide: document.querySelector<HTMLElement>('[data-tide]')!,
  readout: document.querySelector<HTMLElement>('[data-readout]')!,
  seed: document.querySelector<HTMLElement>('[data-seed]')!,
  verdict: document.querySelector<HTMLElement>('.verdict')!,
  verdictText: document.querySelector<HTMLElement>('[data-verdict]')!,
  upgrade: document.querySelector<HTMLElement>('.upgrade')!,
  upgradeButton: document.querySelector<HTMLButtonElement>('[data-upgrade]')!,
  upgradeNote: document.querySelector<HTMLElement>('[data-upgrade-note]')!,
  pause: document.querySelector<HTMLElement>('.pause')!,
  cutWire: document.querySelector<HTMLButtonElement>('[data-cut-wire]')!,
};

// A phone's footer holds one button, so the seed goes where the rest of the
// small print already is: the menu behind it.
if (touchPlayer) hud.pause.appendChild(hud.seed);

/**
 * What the browser is actually giving us, written down where it can be read.
 *
 * On iOS a home-screen app does not always get the whole screen, and there is
 * no way to see that from here: the board fills the page exactly and still
 * stops short of the glass. Rather than guess at it, the numbers go in the
 * menu. Temporary — it comes out once the question is settled.
 */
const diagnostics = document.createElement('span');
diagnostics.className = 'pause__diag';
hud.pause.appendChild(diagnostics);

function paintDiagnostics(): void {
  const probe = getComputedStyle(document.querySelector('.safe-probe')!);
  const safe = `${probe.paddingTop} / ${probe.paddingBottom}`;
  diagnostics.textContent = [
    `сборка ${__BUILD_TIME__}`,
    `окно ${window.innerWidth}×${window.innerHeight}`,
    `экран ${window.screen.width}×${window.screen.height}`,
    `холст ${Math.round(app.screen.width)}×${Math.round(app.screen.height)}`,
    `поля ${safe}`,
    `dpr ${window.devicePixelRatio}`,
    window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'браузер',
  ].join(' · ');
}

hud.cutWire.addEventListener('click', () => {
  const wire = controls.hoveredWire;
  if (wire === null) return;
  clearWire(match.state, HUMAN, wire);
  controls.clearSelection();
  paintOverlays();
  app.render();
});

/**
 * The board runs only when nothing is covering it.
 *
 * Three separate things stop the clock — either dialog and a pause — so one
 * place decides, rather than each of them calling start and stop and fighting
 * over who spoke last.
 */
let paused = false;

function covered(): boolean {
  return dialog.open || resumeDialog.open;
}

function updateRunning(): void {
  const blocked = covered() || paused;
  hud.pause.hidden = !paused || covered();
  if (!hud.pause.hidden) paintDiagnostics();

  // What floats over the board is paintOverlays' business, not this one's.
  paintOverlays();

  if (blocked) {
    app.ticker.stop();
    return;
  }
  app.ticker.start();
}

function setPaused(next: boolean): void {
  if (paused === next) return;
  paused = next;
  updateRunning();
}

const helpDialog = document.querySelector<HTMLDialogElement>('.help')!;
renderHelp(
  helpDialog.querySelector<HTMLElement>('[data-help-body]')!,
  touchPlayer ? 'touch' : 'mouse',
);

// One panel, three ways in: the footer, the setup dialog and the pause screen.
for (const button of document.querySelectorAll('[data-help]')) {
  button.addEventListener('click', () => helpDialog.showModal());
}

document.querySelector('[data-resume]')!.addEventListener('click', () => setPaused(false));

// Escape pauses on a keyboard; a phone has no Escape, so it has a button.
document.querySelector('[data-pause]')!.addEventListener('click', () => setPaused(true));

// The game saves itself, but a player wants to see that it has.
const saveButton = document.querySelector<HTMLButtonElement>('[data-save-now]')!;
saveButton.addEventListener('click', () => {
  saveNow();
  saveButton.textContent = 'Сохранено';
  window.setTimeout(() => {
    saveButton.textContent = 'Сохранить';
  }, 1400);
});

// Leaving the window pauses: a real-time game running unwatched is just a game
// being lost. Automated runs want the opposite, hence ?autopause=off.
if (options.autoPause) {
  window.addEventListener('blur', () => setPaused(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPaused(true);
  });
}

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  // A dialog handles Escape itself; two owners would fight over it.
  if (covered() || helpDialog.open) return;
  event.preventDefault();
  setPaused(!paused);
});

hud.upgradeButton.addEventListener('click', () => {
  const selected = controls.selected;
  if (selected === null) return;
  upgradeNode(match.state, HUMAN, selected);
  paintUpgradeControl();
  app.render();
});

const dialog = document.querySelector<HTMLDialogElement>('.setup')!;
const setupForm = dialog.querySelector('form')!;
const resumeDialog = document.querySelector<HTMLDialogElement>('.resume')!;
const resumeSummary = resumeDialog.querySelector<HTMLElement>('[data-resume-summary]')!;

let settings: MatchSettings = {
  ...defaultSettings(),
  seed: randomSeed(),
  portrait: portraitScreen(),
};
let match = new Match(settings);
let seats: { bar: HTMLElement; nodes: HTMLElement; points: HTMLElement }[] = [];
/** The match to return to if the setup dialog is dismissed without starting. */
let resumed: Match = match;
/** Until the first match is started there is nothing to dismiss the dialog to. */
let started = false;

/**
 * What a bare drag means, for a player with no modifier keys.
 *
 * Sticky and on screen rather than held down: a finger cannot hold Shift, and
 * a player should be able to read what the next drag will do before making it.
 * A modifier still wins over this, so a mouse plays exactly as it did.
 */
let sendMode: SendMode = 'all';
const modeBar = document.querySelector<HTMLElement>('[data-choices="sendMode"]')!;
buildChoices(document, 'sendMode', SEND_MODES, sendMode);

modeBar.addEventListener('change', () => {
  sendMode = (readChoice(modeBar, 'sendMode') || 'all') as SendMode;
  // Wiring and upgrading are different questions about the same node; leaving
  // the + hanging over it while the bar says "провод" only confuses matters.
  controls.clearSelection();
  paintOverlays();
  app.render();
});

const controls = new PointerControls(
  {
    canvas: app.canvas,
    toWorld: (x, y) => renderer.toWorld(x, y),
    panBy: (dx, dy) => renderer.panBy(dx, dy),
    zoomAt: (factor, x, y) => renderer.zoomAt(factor, x, y),
  },
  HUMAN,
  () => match.state,
  () => {
    paintOverlays();
    renderer.draw(match.state, match.alpha, STEP_SECONDS, controls.hint);
    app.render();
  },
  () => sendMode,
);

/*
 * Zoom on one thumb.
 *
 * A pinch takes two fingers, which takes both hands. The rail is the same
 * zoom laid along the right edge: drag it up to come in, down to go back to
 * the whole board. It reads the camera rather than keeping a number of its
 * own, so pinching moves the thumb too — there is one zoom, shown twice.
 */
const zoomRail = document.querySelector<HTMLElement>('[data-zoom]')!;
const zoomThumb = document.querySelector<HTMLElement>('[data-zoom-thumb]')!;
zoomRail.hidden = !touchPlayer;

function paintZoom(): void {
  zoomRail.hidden = !touchPlayer;
  if (zoomRail.hidden) return;
  // Geometric, so that half way up is half way in: 1, 2, 4 rather than 1, 2.5, 4.
  const fraction = Math.log(renderer.zoom) / Math.log(MAX_ZOOM);
  zoomThumb.style.top = `${(1 - fraction) * 100}%`;
}

function zoomFromRail(clientY: number): void {
  const rail = zoomRail.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, 1 - (clientY - rail.top) / rail.height));
  const target = Math.pow(MAX_ZOOM, fraction);

  // About the middle of the screen: the thing you were looking at stays put.
  renderer.zoomAt(target / renderer.zoom, window.innerWidth / 2, window.innerHeight / 2);
  paintOverlays();
  renderer.draw(match.state, match.alpha, STEP_SECONDS, controls.hint);
  app.render();
}

zoomRail.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  zoomRail.setPointerCapture(event.pointerId);
  zoomFromRail(event.clientY);
});

zoomRail.addEventListener('pointermove', (event) => {
  if (!zoomRail.hasPointerCapture(event.pointerId)) return;
  zoomFromRail(event.clientY);
});

buildSettingsForm();
fitBoard();
openStart();
registerWorker();

/**
 * Keeps the game on the phone rather than on the network.
 *
 * Added to the home screen it is expected to open in a tunnel or on a plane,
 * and a match lives in local storage already — the only thing that needed the
 * network was fetching the game itself.
 */
function registerWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      // updateViaCache: 'none' — the worker script itself must not come from
      // the browser's cache, or the thing whose job is to fetch new builds is
      // the one file that never gets fetched.
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((registration) => {
        // A home-screen app can sit suspended for days and come back without
        // navigating anywhere, so nothing ever asks whether there is a new
        // build. Ask on every wake instead of waiting to be told.
        const ask = () => void registration.update().catch(() => undefined);
        ask();
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) ask();
        });
      })
      .catch(() => {
        // An unregistered worker costs offline play and nothing else.
      });
  });

  // A new worker taking charge means new files are in place; the page is still
  // running the old ones. Write the match down first — a reload that loses the
  // game would be a worse bug than the one being fixed.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    saveNow();
    window.location.reload();
  });
}

/**
 * What the player is asked on the way in.
 *
 * A match left in storage is offered first and on its own: someone coming
 * back to a game wants to come back to it, not to fill in a form about a
 * different one. Setting a new match up is what the setup dialog is for, and
 * with nothing saved it is all there is to ask.
 */
function openStart(): void {
  const saved = loadSave(window.localStorage);
  if (!saved) {
    openSettings();
    return;
  }

  // The board behind the prompt is the saved one, so "continue" shows you
  // what you would be continuing.
  showMatch(new Match(saved.settings, saved.state));
  resumeSummary.textContent = describeSave(saved);
  resumeDialog.showModal();
  updateRunning();
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

/**
 * Whether the board should be stood on its end.
 *
 * A phone held upright cannot show a board wider than it is tall without
 * shrinking the nodes past reading, so the shape of the screen decides the
 * shape of the world. Turning the phone afterwards does not redraw the match:
 * the board you are playing is the board you started.
 */
function portraitScreen(): boolean {
  return window.innerHeight > window.innerWidth;
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
    portrait: portraitScreen(),
  };
}

/** How often the match is written to storage while it plays, in milliseconds. */
const SAVE_EVERY = 2000;
let lastSaved = 0;

function openSettings(): void {
  resumed = match;
  // The board behind the dialog is the board you are about to play, so every
  // change to the form redraws it on one fixed seed: only the setting you
  // touched moves, not the whole map.
  showMatch(new Match(settingsFromForm(randomSeed())));
  dialog.showModal();
  updateRunning();
}

setupForm.addEventListener('change', () => {
  showMatch(new Match(settingsFromForm(match.settings.seed)));
});

// Escape closes a <dialog> by default. On the very first visit that would
// drop the player into a match they never started, so it is refused until
// one has been.
for (const sheet of [dialog, resumeDialog]) {
  sheet.addEventListener('cancel', (event) => {
    if (!started) event.preventDefault();
  });
}

resumeDialog.addEventListener('close', () => {
  // Turning the saved match down is the only way into the setup dialog from
  // here; the saved board is already on screen for the other answer.
  if (resumeDialog.returnValue !== 'resume') {
    openSettings();
    return;
  }
  started = true;
  paused = false;
  updateRunning();
});

dialog.addEventListener('close', () => {
  // Dismissing the dialog puts the match that was running back on screen; the
  // preview was only ever a preview.
  if (dialog.returnValue === 'start') {
    started = true;
  } else {
    showMatch(resumed);
  }
  settings = match.settings;
  // Starting a match clears any pause that was in force when you opened the
  // dialog; the board you just set up should be running.
  paused = false;
  updateRunning();
});

for (const button of document.querySelectorAll('[data-open-settings]')) {
  button.addEventListener('click', openSettings);
}

/** Puts a match on screen and paints one frame of it. */
function showMatch(next: Match): void {
  match = next;
  renderer.setWorld(match.world.width, match.world.height);
  renderer.build(match.state);
  renderer.markHome(match.state.nodes.find((node) => node.owner === HUMAN)?.id ?? null);
  buildScoreboard(match.settings.aiCount + 1);
  hud.seed.textContent = `Карта ${match.settings.seed}`;
  hud.verdict.hidden = verdictFor() === null;

  // Drawing the scene is not the same as putting it on the canvas: while the
  // ticker is paused for the dialog, nothing else will.
  controls.clearSelection();
  // The scoreboard just changed height, so the board's room has changed with it.
  fitBoard();
  renderer.draw(match.state, 0, STEP_SECONDS, controls.hint);
  paintHud();
  paintOverlays();
  app.render();
}

/**
 * Keeps the controls that float over the board where they belong.
 *
 * All three are drawn after the menu and the verdict in the markup, so they
 * sit on top of both and stay live: the zoom rail could be dragged straight
 * through the pause screen. One place decides whether they are on screen at
 * all, rather than each of them being hidden by whoever thought of it.
 */
function paintOverlays(): void {
  if (covering()) {
    hud.upgrade.hidden = true;
    hud.cutWire.hidden = true;
    zoomRail.hidden = true;
    return;
  }

  paintUpgradeControl();
  paintWireControl();
  paintZoom();
}

/** Whether anything is drawn over the board at the moment. */
function covering(): boolean {
  return paused || covered() || !hud.verdict.hidden;
}

/**
 * Parks the × on the wire the cursor is resting on.
 *
 * Right-clicking the node takes its wire down too, but nobody discovers that
 * on their own; a button on the wire itself is the way it gets found.
 */
function paintWireControl(): void {
  const wire = controls.hoveredWire;
  const middle = wire === null ? null : wireMidpoint(match.state, wire);

  if (!middle) {
    hud.cutWire.hidden = true;
    return;
  }

  const at = renderer.toScreen(middle.x, middle.y);
  hud.cutWire.hidden = false;
  hud.cutWire.style.left = `${at.x}px`;
  hud.cutWire.style.top = `${at.y}px`;

  // The button belongs to the wire, so it wears the wire's colour.
  const owner = match.state.nodes[wire!]?.owner ?? HUMAN;
  const colour = cssColour(factionOf(owner).glow);
  hud.cutWire.style.borderColor = colour;
  hud.cutWire.style.color = colour;
}

function cssColour(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/**
 * Parks the upgrade control beside the selected node.
 *
 * It is DOM rather than something drawn into the canvas so that it is a real
 * button: hover, keyboard focus and a proper hit area come for free.
 */
function paintUpgradeControl(): void {
  const selected = controls.selected;
  const node = selected === null ? undefined : match.state.nodes[selected];

  if (!node || node.owner !== HUMAN) {
    hud.upgrade.hidden = true;
    if (node && node.owner !== HUMAN) controls.clearSelection();
    return;
  }

  const anchor = renderer.anchorFor(node);
  hud.upgrade.hidden = false;
  hud.upgrade.style.left = `${anchor.x}px`;
  hud.upgrade.style.top = `${anchor.y}px`;

  const cost = upgradeCost(node.level);
  if (cost === null) {
    hud.upgradeButton.disabled = true;
    hud.upgradeNote.textContent = `Уровень ${MAX_LEVEL} — дальше некуда`;
    return;
  }

  const short = Math.ceil(cost - node.points);
  hud.upgradeButton.disabled = short > 0;
  const step = `Уровень ${node.level} → ${node.level + 1}`;
  const price = short > 0 ? `не хватает ${formatPoints(short)}` : `за ${cost}`;
  hud.upgradeNote.textContent = [step, price, bonusGained(node)]
    .filter(Boolean)
    .join(', ');
}

/**
 * What the next level does for this node beyond the extra room.
 *
 * Capacity is visible in the node itself, but the difference between a
 * third-level fortress and a fourth-level one is not, and it is the whole
 * reason to build that kind up.
 */
function bonusGained(node: Pick<GameNode, 'kind' | 'level'>): string {
  const next = { kind: node.kind, level: node.level + 1 };

  if (node.kind === 'fortress') {
    return `защита ${defenceMultiplier(node)}× → ${defenceMultiplier(next)}×`;
  }
  if (node.kind === 'farm') {
    return `прирост ${growthMultiplier(node)}× → ${growthMultiplier(next)}×`;
  }
  return '';
}

/** Rebuilds the scoreboard, which has one seat per player in the match. */
function buildScoreboard(playerCount: number): void {
  hud.tide.replaceChildren();
  hud.readout.replaceChildren();
  seats = [];

  for (let player = 0; player < playerCount; player++) {
    const faction = factionOf(player);
    const colour = cssColour(faction.glow);

    const bar = document.createElement('div');
    bar.className = 'tide__seat';
    bar.style.background = colour;
    bar.style.boxShadow = `0 0 14px ${colour}99`;
    hud.tide.appendChild(bar);

    // One seat, written twice over: a sentence for a screen with room for it,
    // and a dot with a number for one without. Which of them shows is the
    // stylesheet's business; both are kept up to date either way.
    const row = document.createElement('span');
    row.className = 'side';
    row.style.setProperty('--seat', colour);

    const dot = document.createElement('i');
    dot.className = 'side__dot';

    const name = document.createElement('span');
    name.className = 'side__spelled';
    name.textContent = `${faction.label}: `;

    const nodes = document.createElement('b');
    nodes.className = 'side__spelled';
    const nodesUnit = document.createElement('span');
    nodesUnit.className = 'side__spelled';
    nodesUnit.textContent = ' узлов, ';

    const points = document.createElement('b');
    const pointsUnit = document.createElement('span');
    pointsUnit.className = 'side__spelled';
    pointsUnit.textContent = ' очков';

    row.append(dot, name, nodes, nodesUnit, points, pointsUnit);
    hud.readout.appendChild(row);

    seats.push({ bar, nodes, points });
  }
}

app.ticker.add((ticker) => {
  match.advance(Math.min(ticker.deltaMS / 1000, 0.25));
  renderer.draw(match.state, match.alpha, STEP_SECONDS, controls.hint);
  paintHud();
  paintOverlays();
  keepSaved();
});

/**
 * Writes the match down every couple of seconds.
 *
 * Saving on a timer rather than behind a button means closing the tab by
 * accident costs a few seconds rather than the whole game. A finished match is
 * cleared instead: there is nothing to come back to.
 */
function keepSaved(): void {
  const now = performance.now();
  if (now - lastSaved < SAVE_EVERY) return;
  lastSaved = now;
  saveNow();
}

function saveNow(): void {
  // The board behind the setup dialog is a preview of a match nobody has
  // started. Writing it down — and leaving the page does write it down —
  // would throw away the match the player actually left in storage.
  if (!started || covered()) return;

  if (match.state.winner !== null || isEliminated(match.state, HUMAN)) {
    clearSave(window.localStorage);
    return;
  }
  writeSave(window.localStorage, match);
}

// The timer runs off the render loop, which stops when the game is paused or
// the tab is hidden — exactly the moments before a tab gets closed. Write the
// match down on the way out as well.
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveNow();
});

function paintHud(): void {
  seats.forEach((seat, player) => {
    const standing = standingsFor(match.state, player);
    seat.bar.style.width = `${standing.share * 100}%`;
    seat.nodes.textContent = String(standing.nodes);
    seat.points.textContent = formatPoints(standing.points);
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
