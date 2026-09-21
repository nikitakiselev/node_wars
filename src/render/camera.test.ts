import { describe, expect, test } from 'vitest';
import { Camera, MAX_ZOOM } from './camera';

const VIEW = { width: 1400, height: 800 };
const WORLD = { width: 1600, height: 1000 };

function camera() {
  const made = new Camera();
  made.setViewport(VIEW.width, VIEW.height, { top: 0, bottom: 0, left: 0, right: 0 });
  made.setWorld(WORLD.width, WORLD.height);
  return made;
}

/** Where a world point lands on screen under the current view. */
function onScreen(made: Camera, x: number, y: number) {
  const { scale, x: left, y: top } = made.transform;
  return { x: left + x * scale, y: top + y * scale };
}

describe('at rest', () => {
  test('the whole board fits and sits in the middle', () => {
    const { scale, x, y } = camera().transform;

    expect(WORLD.width * scale).toBeLessThanOrEqual(VIEW.width + 0.001);
    expect(WORLD.height * scale).toBeLessThanOrEqual(VIEW.height + 0.001);
    expect(x + (WORLD.width * scale) / 2).toBeCloseTo(VIEW.width / 2);
    expect(y + (WORLD.height * scale) / 2).toBeCloseTo(VIEW.height / 2);
  });

  test('the space the HUD takes is left alone', () => {
    const made = new Camera();
    made.setViewport(VIEW.width, VIEW.height, { top: 60, bottom: 50, left: 20, right: 20 });
    made.setWorld(WORLD.width, WORLD.height);
    const { scale, y } = made.transform;

    expect(y).toBeGreaterThanOrEqual(60);
    expect(y + WORLD.height * scale).toBeLessThanOrEqual(VIEW.height - 50 + 0.001);
  });

  test('a wider board is drawn smaller', () => {
    const wide = camera();
    wide.setWorld(WORLD.width * 2, WORLD.height * 2);

    expect(wide.transform.scale).toBeLessThan(camera().transform.scale);
  });
});

describe('zooming', () => {
  test('starts at the whole board and will not go below it', () => {
    const made = camera();
    expect(made.zoom).toBe(1);

    made.zoomAt(0.2, 700, 400);

    expect(made.zoom).toBe(1);
  });

  test('stops at the closest view it offers', () => {
    const made = camera();

    for (let i = 0; i < 40; i++) made.zoomAt(1.5, 700, 400);

    expect(made.zoom).toBe(MAX_ZOOM);
  });

  test('the point under the cursor stays under the cursor', () => {
    const made = camera();
    const before = made.transform;
    const cursor = { x: 420, y: 260 };
    const worldUnderCursor = {
      x: (cursor.x - before.x) / before.scale,
      y: (cursor.y - before.y) / before.scale,
    };

    made.zoomAt(2, cursor.x, cursor.y);

    const after = onScreen(made, worldUnderCursor.x, worldUnderCursor.y);
    expect(after.x).toBeCloseTo(cursor.x);
    expect(after.y).toBeCloseTo(cursor.y);
  });

  test('zooming in and back out returns to where it started', () => {
    const made = camera();
    const before = made.transform;

    made.zoomAt(2, 500, 300);
    made.zoomAt(0.5, 500, 300);

    expect(made.transform.scale).toBeCloseTo(before.scale);
    expect(made.transform.x).toBeCloseTo(before.x);
  });
});

describe('panning', () => {
  test('does nothing while the whole board is on screen', () => {
    const made = camera();
    const before = made.transform;

    made.panBy(200, 200);

    expect(made.transform.x).toBeCloseTo(before.x);
    expect(made.transform.y).toBeCloseTo(before.y);
  });

  test('moves the board once it is bigger than the view', () => {
    const made = camera();
    made.zoomAt(3, 700, 400);
    const before = made.transform;

    made.panBy(-60, 0);

    expect(made.transform.x).toBeLessThan(before.x);
  });

  test('never lets the board be dragged off the screen', () => {
    const made = camera();
    made.zoomAt(2, 700, 400);

    made.panBy(9000, 9000);
    const { scale, x, y } = made.transform;

    expect(x).toBeLessThanOrEqual(0.001);
    expect(y).toBeLessThanOrEqual(0.001);
    expect(x + WORLD.width * scale).toBeGreaterThanOrEqual(VIEW.width - 0.001);
    expect(y + WORLD.height * scale).toBeGreaterThanOrEqual(VIEW.height - 0.001);
  });

  test('reaches the edge of the screen, not the edge of the HUD', () => {
    // The HUD is see-through and the board is drawn underneath it. Stopping at
    // the HUD's edge leaves a band of empty water under the buttons that the
    // player cannot get rid of, however far they drag.
    const made = new Camera();
    made.setViewport(VIEW.width, VIEW.height, { top: 60, bottom: 100, left: 20, right: 20 });
    made.setWorld(WORLD.width, WORLD.height);
    made.zoomAt(3, 700, 400);

    made.panBy(0, -9000);
    const up = made.transform;
    expect(up.y + WORLD.height * up.scale).toBeGreaterThanOrEqual(VIEW.height - 0.001);

    made.panBy(0, 9000);
    const down = made.transform;
    expect(down.y).toBeLessThanOrEqual(0.001);
  });

  test('still keeps the whole board clear of the HUD when it fits', () => {
    const made = new Camera();
    made.setViewport(VIEW.width, VIEW.height, { top: 60, bottom: 100, left: 20, right: 20 });
    made.setWorld(WORLD.width, WORLD.height);

    made.panBy(0, -9000);
    const { scale, y } = made.transform;

    expect(y).toBeGreaterThanOrEqual(60 - 0.001);
    expect(y + WORLD.height * scale).toBeLessThanOrEqual(VIEW.height - 100 + 0.001);
  });

  test('a new board starts from the whole view again', () => {
    const made = camera();
    made.zoomAt(3, 400, 400);
    made.panBy(-200, -100);

    made.reset();

    expect(made.zoom).toBe(1);
    expect(made.transform).toEqual(camera().transform);
  });
});
