export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

/** Closest the view goes. Beyond this the board is a few nodes on a big screen. */
export const MAX_ZOOM = 4;

/**
 * Where the board sits on screen.
 *
 * Zoom 1 is the whole board fitted into the space the HUD leaves free, and it
 * is also the floor: there is nothing outside the board to look at. Panning is
 * clamped to keep the board covering the view, so it can never be dragged off
 * into empty space.
 *
 * Kept free of Pixi so the arithmetic — which is the part that goes wrong — can
 * be tested on its own.
 */
export class Camera {
  private viewWidth = 1;
  private viewHeight = 1;
  private insets: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
  private worldWidth = 1;
  private worldHeight = 1;
  private level = 1;
  private panX = 0;
  private panY = 0;

  setViewport(width: number, height: number, insets: Insets): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.insets = insets;
    this.clamp();
  }

  setWorld(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
    this.clamp();
  }

  get zoom(): number {
    return this.level;
  }

  get transform(): ViewTransform {
    const scale = this.fitScale() * this.level;
    const room = this.room();
    return {
      scale,
      x: this.insets.left + (room.width - this.worldWidth * scale) / 2 + this.panX,
      y: this.insets.top + (room.height - this.worldHeight * scale) / 2 + this.panY,
    };
  }

  /** Zooms about a point on screen, which stays put as everything else moves. */
  zoomAt(factor: number, screenX: number, screenY: number): void {
    const before = this.transform;
    const world = {
      x: (screenX - before.x) / before.scale,
      y: (screenY - before.y) / before.scale,
    };

    this.level = Math.min(MAX_ZOOM, Math.max(1, this.level * factor));

    // Whatever the clamped zoom turned out to be, put that world point back
    // under the cursor.
    const after = this.transform;
    this.panX += screenX - (after.x + world.x * after.scale);
    this.panY += screenY - (after.y + world.y * after.scale);
    this.clamp();
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.clamp();
  }

  reset(): void {
    this.level = 1;
    this.panX = 0;
    this.panY = 0;
  }

  private room() {
    return {
      width: Math.max(1, this.viewWidth - this.insets.left - this.insets.right),
      height: Math.max(1, this.viewHeight - this.insets.top - this.insets.bottom),
    };
  }

  private fitScale(): number {
    const room = this.room();
    return Math.min(room.width / this.worldWidth, room.height / this.worldHeight);
  }

  /** Holds the board against the edges of the view rather than inside them. */
  private clamp(): void {
    const scale = this.fitScale() * this.level;
    const room = this.room();

    this.panX = clampAxis(
      this.panX,
      this.worldWidth * scale,
      room.width,
      this.viewWidth,
      this.insets.left,
    );
    this.panY = clampAxis(
      this.panY,
      this.worldHeight * scale,
      room.height,
      this.viewHeight,
      this.insets.top,
    );
  }
}

/**
 * How far the board may slide on one axis.
 *
 * Two limits, and which one applies depends on how big the board has become.
 *
 * The insets exist so that the *whole* board is visible beside the HUD at rest
 * — but the HUD is see-through and the board is drawn underneath it, so once
 * the board is bigger than the screen there is no reason to stop it at the
 * HUD's edge. Doing so leaves a band of empty water under the buttons that no
 * amount of dragging gets rid of. Big enough to cover the screen, it may be
 * dragged until its edge reaches the screen's.
 *
 * Below that it has to keep the HUD-free room covered instead, and smaller
 * than the room it stays centred, because sliding it would only reveal
 * emptiness.
 */
function clampAxis(
  pan: number,
  extent: number,
  room: number,
  view: number,
  near: number,
): number {
  if (extent >= view) {
    // Where the near edge sits before any panning: the board is centred in the
    // room, which is itself off-centre in the view.
    const home = near + (room - extent) / 2;
    return Math.min(-home, Math.max(view - extent - home, pan));
  }

  const slack = (extent - room) / 2;
  if (slack <= 0) return 0;
  return Math.min(slack, Math.max(-slack, pan));
}
