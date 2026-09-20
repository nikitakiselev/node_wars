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
  mote: Texture;
}

export function createBrushes(): Brushes {
  return {
    glow: radialTexture(128, [
      [0, 'rgba(255,255,255,0.95)'],
      [0.25, 'rgba(255,255,255,0.45)'],
      [0.6, 'rgba(255,255,255,0.12)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    disc: discTexture(128),
    mote: radialTexture(32, [
      [0, 'rgba(255,255,255,1)'],
      [0.35, 'rgba(255,255,255,0.7)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
  };
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
