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
  /** One dash and the gap after it, repeated along a supply wire. */
  dash: Texture;
}

/**
 * Side of the dash tile, in texture pixels.
 *
 * A plain square, scaled to whatever a dash needs to be. Drawn larger than it
 * is shown so an edge stays clean when the board is zoomed right in.
 */
export const DASH_TILE = 16;

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
  canvas.width = DASH_TILE;
  canvas.height = DASH_TILE;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, DASH_TILE, DASH_TILE);

  return Texture.from(canvas);
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
