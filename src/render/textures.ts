import { Texture } from 'pixi.js';

/**
 * Pre-rendered brushes.
 *
 * Every glow, disc and particle on screen is one of these three textures,
 * tinted. Uploading a handful of small textures once and letting the GPU tint
 * thousands of sprites is what keeps the particle streams cheap.
 */
export interface Brushes {
  glow: Texture;
  disc: Texture;
  /** Flat-topped hexagon: the body of a fortress. */
  bastion: Texture;
  mote: Texture;
  /** One dash of a supply wire; the gaps between them are left undrawn. */
  dash: Texture;
}

/**
 * One dash and the gap that follows it, in texture pixels.
 *
 * This is a *repeating* tile, not one dash: a whole wire is drawn as a single
 * sprite with this pattern running along it, so the whole line is rasterised
 * by one continuous mapping. Drawing each dash as its own sprite is what the
 * renderer did before, and it could not be made to work — every dash met the
 * pixel grid at its own offset and picked its own length, and because the
 * dashes move, the pattern of longer and shorter ones travelled along the
 * wire. Identical dashes in the arithmetic, a running wave on the screen.
 *
 * Four texture pixels to a world unit, so the tile still has something to
 * show when the board is zoomed right in.
 */
export const DASH_TILE = { width: 56, height: 10 } as const;

/** Share of the tile the dash itself takes up; the rest is the gap. */
const DASH_FILL = 0.5;

export function createBrushes(): Brushes {
  return {
    glow: radialTexture(128, [
      [0, 'rgba(255,255,255,0.95)'],
      [0.25, 'rgba(255,255,255,0.45)'],
      [0.6, 'rgba(255,255,255,0.12)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    disc: discTexture(128),
    bastion: hexagonTexture(128),
    mote: radialTexture(32, [
      [0, 'rgba(255,255,255,1)'],
      [0.35, 'rgba(255,255,255,0.7)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    dash: dashTexture(),
  };
}

/**
 * One dash of a supply wire.
 *
 * A flat square, tinted and stretched into whatever dash is needed. Every dash
 * on the board is a particle wearing this one texture, which is what lets them
 * all go down in a single draw call.
 */
function dashTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = DASH_TILE.width;
  canvas.height = DASH_TILE.height;
  const ctx = canvas.getContext('2d')!;

  /*
   * The dash sits in the middle of its tile with the gap split either side,
   * so the pattern joins itself cleanly however many times it repeats.
   *
   * Soft edges and rounded ends: the line is a couple of pixels thick at rest
   * and a hard edge at that size is a row of steps. The blur is drawn inside
   * the dash rather than beyond it, so two tiles never bleed into each other.
   */
  const length = DASH_TILE.width * DASH_FILL;
  const margin = (DASH_TILE.width - length) / 2;
  const thickness = DASH_TILE.height - 4;

  ctx.filter = 'blur(1.6px)';
  ctx.fillStyle = '#ffffff';
  roundedRect(ctx, margin, 2, length, thickness, thickness / 2);
  ctx.fill();

  const texture = Texture.from(canvas);
  // The tile is repeated along the wire and is usually smaller on screen than
  // it is in the texture; without these it would be sampled one pixel in four.
  texture.source.addressMode = 'repeat';
  texture.source.autoGenerateMipmaps = true;
  return texture;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function radialTexture(size: number, stops: [number, string][]): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return Texture.from(canvas);
}

function hexagonTexture(size: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const half = size / 2;
  const radius = half - 1;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let corner = 0; corner < 6; corner++) {
    const angle = (corner * Math.PI) / 3;
    const x = half + Math.cos(angle) * radius;
    const y = half + Math.sin(angle) * radius;
    if (corner === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  return Texture.from(canvas);
}

function discTexture(size: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const half = size / 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(half, half, half - 1, 0, Math.PI * 2);
  ctx.fill();

  return Texture.from(canvas);
}
