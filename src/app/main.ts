import { Application } from 'pixi.js';
import type { Difficulty } from '../ai/ai';
import { SHARE_MODES } from '../core/balancer';
import { CONVERSIONS, conversionsFor, convertNode, revertNode } from '../core/convert';
import { formatPoints } from '../core/format';
import { defenceMultiplier, growthMultiplier } from '../core/kinds';
import { MAX_LEVEL, upgradeCost } from '../core/levels';
import { wireMidpoint } from '../core/geometry';
import { isEliminated } from '../core/simulation';
import type { GameNode, NodeKind, ShareMode } from '../core/state';
import { upgradeNode } from '../core/upgrade';
import { cutWire, wiresFrom } from '../core/wires';
import { standingsFor } from '../core/standings';
import { outputNames } from './outputs';
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

/*
 * Anything that stops the game starting says so.
 *
 * The board is a canvas: when the code that fills it never runs, what the
 * player gets is a black rectangle and a HUD with nothing in it, which looks
 * like a game that simply does not work. Registered before anything else so
 * that a failure inside the very first await is caught too.
 */
const crash = document.querySelector<HTMLElement>('.crash')!;
const crashWhy = document.querySelector<HTMLElement>('[data-crash]')!;

function reportCrash(reason: unknown): void {
  const said =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : String(reason ?? 'причина неизвестна');
  // The first failure is the one worth reading; later ones are usually its echo.
  if (crash.hidden) crashWhy.textContent = said;
  crash.hidden = false;
}

window.addEventListener('error', (event) => reportCrash(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportCrash(event.reason));
document
  .querySelector('[data-crash-reload]')!
  .addEventListener('click', () => window.location.reload());

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
  dim: document.querySelector<HTMLElement>('[data-dim]')!,
  actions: document.querySelector<HTMLElement>('.actions')!,
  actionRing: document.querySelector<HTMLElement>('[data-actions-ring]')!,
  actionNote: document.querySelector<HTMLElement>('[data-actions-note]')!,
  pause: document.querySelector<HTMLElement>('.pause')!,
  cutWire: document.querySelector<HTMLButtonElement>('[data-cut-wire]')!,
};

/**
 * Where the clear circle in the dimming layer was last put, or null when the
 * board is not dimmed at all.
 *
 * Declared up here with the rest of the state rather than beside the function
 * that uses it: `fitBoard` paints the overlays before the first frame is
 * drawn, and a `let` further down the file is not yet initialised when it
 * does — which is a black screen and an error panel, not a subtle bug.
 */
let lastHole: Hole | null = null;

// A phone's footer holds one button, so the seed goes where the rest of the
// small print already is: the menu behind it.
if (touchPlayer) hud.pause.appendChild(hud.seed);

hud.cutWire.addEventListener('click', () => {
  const wire = controls.hoveredWire;
  if (wire === null) return;
  cutWire(match.state, HUMAN, wire.from, wire.to);
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
  return dialog.open || resumeDialog.open || shareDialog.open;
}

function updateRunning(): void {
  const blocked = covered() || paused;
  hud.pause.hidden = !paused || covered();

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

const dialog = document.querySelector<HTMLDialogElement>('.setup')!;
const setupForm = dialog.querySelector('form')!;
const resumeDialog = document.querySelector<HTMLDialogElement>('.resume')!;
const resumeSummary = resumeDialog.querySelector<HTMLElement>('[data-resume-summary]')!;

/*
 * The balancer's own panel.
 *
 * A hub has two things worth setting and neither belongs on a button: how it
 * shares out, and which of its wires are still wanted. It is a real dialog,
 * so it stops the clock the way the other two do — nobody should have to
 * decide anything while the board moves underneath them.
 */
const shareDialog = document.querySelector<HTMLDialogElement>('.share')!;
const shareModes = shareDialog.querySelector<HTMLElement>('[data-choices="share"]')!;
const shareHint = shareDialog.querySelector<HTMLElement>('[data-share-hint]')!;
const shareOutputs = shareDialog.querySelector<HTMLElement>('[data-share-outputs]')!;

/** The hub the panel is open on, or null when it is shut. */
let sharing: number | null = null;

function openShare(nodeId: number): void {
  const node = match.state.nodes[nodeId];
  if (!node || node.kind !== 'balancer') return;

  sharing = nodeId;
  buildChoices(shareDialog, 'share', SHARE_MODES, node.share ?? 'round');
  paintShare();
  shareDialog.showModal();
  updateRunning();
}

shareModes.addEventListener('change', () => {
  const node = sharing === null ? undefined : match.state.nodes[sharing];
  if (!node) return;

  node.share = (readChoice(shareDialog, 'share') || 'round') as ShareMode;
  // Starting over rather than carrying on from wherever the other mode left
  // the cursor: a list the player has just changed should begin at its top.
  node.cursor = 0;
  paintShare();
});

shareDialog.addEventListener('close', () => {
  sharing = null;
  updateRunning();
  renderer.draw(match.state, match.alpha, STEP_SECONDS, controls.hint);
  app.render();
});

/** Fills in the panel from the hub it is open on. */
function paintShare(): void {
  const node = sharing === null ? undefined : match.state.nodes[sharing];
  if (!node) return;

  shareHint.textContent = SHARE_MODES[node.share ?? 'round'].hint;
  shareOutputs.replaceChildren();

  const outputs = wiresFrom(match.state, node.id);
  if (outputs.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = touchPlayer
      ? 'Проводов нет. Включите «Провод» внизу и проведите к своему соседу.'
      : 'Проводов нет. Протяните правой кнопкой к своему соседу.';
    shareOutputs.appendChild(empty);
    return;
  }

  const names = outputNames(node, outputs.map((id) => match.state.nodes[id]!));

  for (const toId of outputs) {
    const target = match.state.nodes[toId];
    if (!target) continue;

    const row = document.createElement('li');

    const name = document.createElement('span');
    name.textContent = names.get(toId) ?? '';

    const state = document.createElement('em');
    state.textContent = `${formatPoints(target.points)} / ${target.capacity}`;

    const cut = document.createElement('button');
    cut.type = 'button';
    cut.textContent = '×';
    cut.title = 'Убрать этот провод';
    cut.setAttribute('aria-label', 'Убрать этот провод');
    cut.addEventListener('click', () => {
      cutWire(match.state, HUMAN, node.id, toId);
      paintShare();
    });

    row.append(name, state, cut);
    shareOutputs.appendChild(row);
  }
}


let settings: MatchSettings = {
  ...defaultSettings(),
  seed: randomSeed(),
  portrait: portraitScreen(),
};
let match = new Match(settings);
let seats: { bar: HTMLElement; points: HTMLElement }[] = [];
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
    hud.actions.hidden = true;
    hud.cutWire.hidden = true;
    zoomRail.hidden = true;
    paintDim(null);
    return;
  }

  paintActions();
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
  const owner = match.state.nodes[wire!.from]?.owner ?? HUMAN;
  const colour = cssColour(factionOf(owner).glow);
  hud.cutWire.style.borderColor = colour;
  hud.cutWire.style.color = colour;
}

function cssColour(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/**
 * One thing the selected node can be asked to do.
 *
 * The ring is built from a list rather than from a fixed set of buttons,
 * because what a node offers depends on what it is: a plain node can be built
 * up and, at the top, built into something; a hub can be set up and taken
 * back down again.
 */
interface NodeAction {
  /** What goes inside the button: a character, or a mark that is drawn. */
  mark: string | (() => SVGElement);
  /** What the button is for, read out by a screen reader and on hover. */
  title: string;
  disabled?: boolean;
  run(): void;
}

/**
 * The silhouette on the button that builds a node into a kind.
 *
 * The same fan the node itself will wear once it is built, so the button
 * teaches the mark rather than standing in for it. A new buildable kind needs
 * a mark here and a silhouette in the renderer — a kind is a row in a table,
 * but a picture of one is a picture.
 */
const CONVERSION_MARKS: Partial<Record<NodeKind, () => SVGElement>> = {
  balancer: fanMark,
};

function fanMark(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  for (const [x, y] of [
    [5, 5],
    [12, 3],
    [19, 5],
  ]) {
    const ray = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    ray.setAttribute('d', `M12 20 L${x} ${y}`);
    svg.appendChild(ray);
  }

  return svg;
}

/**
 * Lays the ring of actions around the selected node.
 *
 * It is DOM rather than something drawn into the canvas so that the buttons
 * are real buttons: hover, keyboard focus and a proper hit area come free.
 * The block sits on the node's centre and the buttons are placed on an arc
 * around it, so the ring follows the node through a pan or a zoom.
 */
function paintActions(): void {
  const selected = controls.selected;
  const node = selected === null ? undefined : match.state.nodes[selected];

  if (!node || node.owner !== HUMAN) {
    hud.actions.hidden = true;
    paintDim(null);
    if (node && node.owner !== HUMAN) controls.clearSelection();
    return;
  }

  const at = renderer.ringFor(node);
  hud.actions.hidden = false;
  hud.actions.style.left = `${at.x}px`;
  hud.actions.style.top = `${at.y}px`;

  const size = buttonSize();
  const radius = at.radius + size / 2 + RING_GAP;

  layOutRing(node.id, actionsFor(node), radius);
  hud.actionNote.textContent = noteFor(node);
  hud.actionNote.style.transform = `translate(-50%, ${radius + size / 2 + NOTE_GAP}px)`;

  // The clear circle takes in the whole ring, so nothing the player is about
  // to press is standing in the dark.
  paintDim({ x: at.x, y: at.y, radius: radius + size });
}

/** How far outside the node the buttons sit, and the note below them. */
const RING_GAP = 10;
const NOTE_GAP = 12;

/**
 * Dims the board around the node being given orders.
 *
 * Darkening rather than blurring, and with a hole in it rather than over the
 * whole board: this is a real-time game, and a board that cannot be read is a
 * board on which the other player is moving unseen. The node, its ring and
 * its neighbours stay exactly as bright as they were, so the throw you were
 * about to make is still there to make.
 *
 * Written through custom properties rather than by rebuilding the gradient,
 * and only when the hole has actually moved: this is called on every frame of
 * a sixty-hertz loop, and a full-screen layer that repaints for nothing is
 * the sort of cost that only ever shows up on somebody else's phone.
 *
 * The layer is never taken out of the document, only faded. Hiding it as well
 * meant the fade had two switches, and the one that was off decided: after
 * the first time it was put away the class went on a layer that was still
 * display:none, and the board never dimmed again.
 */
function paintDim(hole: Hole | null): void {
  if (!hole) {
    lastHole = null;
    hud.dim.classList.remove('dim--on');
    return;
  }

  if (moved(lastHole, hole)) {
    hud.dim.style.setProperty('--hole-x', `${hole.x}px`);
    hud.dim.style.setProperty('--hole-y', `${hole.y}px`);
    hud.dim.style.setProperty('--hole-r', `${hole.radius}px`);
  }

  lastHole = hole;
  hud.dim.classList.add('dim--on');
}

interface Hole {
  x: number;
  y: number;
  radius: number;
}

/** Below a pixel nothing is visible, and the layer is expensive to repaint. */
function moved(was: Hole | null, now: Hole): boolean {
  if (was === null) return true;
  return (
    Math.abs(was.x - now.x) >= 1 ||
    Math.abs(was.y - now.y) >= 1 ||
    Math.abs(was.radius - now.radius) >= 1
  );
}


/**
 * Places the buttons on an arc to the right of the node.
 *
 * The step between them is measured in pixels along that arc rather than in
 * degrees, so two buttons on a small node do not overlap and four on a big
 * one do not drift halfway round the board.
 *
 * The buttons are rebuilt only when the ring's make-up changes, never on the
 * frame. This runs sixty times a second: replacing the DOM each time would
 * throw away the focus ring and cancel the press the player is in the middle
 * of. What does change every frame — where each button sits, and whether it
 * can be afforded — is written to the elements that are already there.
 */
function layOutRing(nodeId: number, actions: NodeAction[], radius: number): void {
  ringActions = actions;

  const signature = [nodeId, ...actions.map((action) => action.title)].join('|');

  if (signature !== ringSignature) {
    ringSignature = signature;
    hud.actionRing.replaceChildren();

    actions.forEach((action, index) => {
      const slot = document.createElement('span');
      slot.className = 'actions__slot';
      slot.style.setProperty('--i', String(index));

      const button = document.createElement('button');
      button.type = 'button';
      button.title = action.title;
      button.setAttribute('aria-label', action.title);

      if (typeof action.mark === 'string') button.textContent = action.mark;
      else button.appendChild(action.mark());

      // Through the list rather than through this action, so the handler
      // survives every frame that does not rebuild the ring.
      button.addEventListener('click', () => {
        ringActions[index]?.run();
        paintOverlays();
        renderer.draw(match.state, match.alpha, STEP_SECONDS, controls.hint);
        app.render();
      });

      slot.appendChild(button);
      hud.actionRing.appendChild(slot);
    });
  }

  const step = (Math.PI * 2) / actions.length;

  actions.forEach((action, index) => {
    const slot = hud.actionRing.children[index] as HTMLElement | undefined;
    const button = slot?.firstElementChild as HTMLButtonElement | undefined;
    if (!slot || !button) return;

    button.disabled = action.disabled ?? false;
    // Evenly round the node from the top, clockwise. The seat carries the
    // placement and the button carries the press, so pressing one never has
    // to know where on the ring it is sitting.
    const angle = -Math.PI / 2 + index * step;
    slot.style.setProperty('--x', `${Math.cos(angle) * radius}px`);
    slot.style.setProperty('--y', `${Math.sin(angle) * radius}px`);
  });
}

/** What the buttons on screen stand for, refreshed every frame. */
let ringActions: NodeAction[] = [];
/** The make-up of the ring as built, so it is rebuilt only when it changes. */
let ringSignature = '';

function buttonSize(): number {
  return touchPlayer ? 42 : 30;
}

/** What this node can be asked to do, in the order the ring shows it. */
function actionsFor(node: GameNode): NodeAction[] {
  const actions: NodeAction[] = [];
  const cost = upgradeCost(node.level);

  if (cost !== null) {
    actions.push({
      mark: '+',
      title: `Поднять уровень, ${cost}`,
      disabled: node.points < cost,
      run: () => void upgradeNode(match.state, HUMAN, node.id),
    });
  }

  for (const kind of conversionsFor(match.state, node.id)) {
    const conversion = CONVERSIONS[kind]!;
    actions.push({
      mark: CONVERSION_MARKS[kind] ?? '•',
      title: `${conversion.label}, ${conversion.cost}`,
      disabled: node.points < conversion.cost,
      run: () => void convertNode(match.state, HUMAN, node.id, kind),
    });
  }

  if (node.kind === 'balancer') {
    actions.push({
      mark: '⚙',
      title: 'Настроить раздачу',
      run: () => openShare(node.id),
    });
  }

  if (CONVERSIONS[node.kind]) {
    actions.push({
      mark: '↺',
      title: 'Вернуть обычный узел',
      run: () => void revertNode(match.state, HUMAN, node.id),
    });
  }

  return actions;
}

/**
 * The line under the ring: what this node is, or what the next level costs.
 *
 * A hub has no next level and no price to quote, so it says what it is doing
 * instead — which is the one thing about it that is not visible on the board.
 */
function noteFor(node: GameNode): string {
  if (node.kind === 'balancer') {
    const outputs = wiresFrom(match.state, node.id).length;
    const mode = SHARE_MODES[node.share ?? 'round'].label.toLowerCase();
    return outputs === 0 ? 'Раздавать некуда: нет проводов' : `${mode}, выходов ${outputs}`;
  }

  const cost = upgradeCost(node.level);
  if (cost !== null) {
    const short = Math.ceil(cost - node.points);
    const step = `Уровень ${node.level} → ${node.level + 1}`;
    const price = short > 0 ? `не хватает ${formatPoints(short)}` : `за ${cost}`;
    return [step, price, bonusGained(node)].filter(Boolean).join(', ');
  }

  const buildable = conversionsFor(match.state, node.id)[0];
  if (buildable) {
    const conversion = CONVERSIONS[buildable]!;
    const short = Math.ceil(conversion.cost - node.points);
    return short > 0
      ? `${conversion.label}: не хватает ${formatPoints(short)}`
      : `${conversion.label} за ${conversion.cost}`;
  }

  return `Уровень ${MAX_LEVEL} — дальше некуда`;
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

    // A dot for whose it is and one number for how much. The names and the
    // word "узлов" cost a line and say nothing the tide bar above has not
    // already said, on any screen.
    const row = document.createElement('span');
    row.className = 'side';
    row.style.setProperty('--seat', colour);
    row.title = faction.label;

    const dot = document.createElement('i');
    dot.className = 'side__dot';
    const points = document.createElement('b');

    row.append(dot, points);
    hud.readout.appendChild(row);

    seats.push({ bar, points });
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
