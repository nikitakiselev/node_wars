/**
 * Draws the home-screen icons.
 *
 * Run with `node scripts/icons.mjs`; the PNGs it writes are committed, because
 * a build must not depend on a drawing step. There is no image library here
 * and none is wanted for six flat shapes: a PNG is a zlib stream of rows, and
 * zlib ships with Node.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const WATER = [4, 18, 26];
const FILAMENT = [23, 62, 74];
const AMBER = [245, 169, 78];
const JADE = [63, 214, 193];
const SILT = [110, 129, 137];

/** The mark: a little board, in coordinates from 0 to 1. */
const NODES = [
  { x: 0.27, y: 0.29, r: 0.105, colour: AMBER },
  { x: 0.69, y: 0.22, r: 0.07, colour: SILT },
  { x: 0.75, y: 0.63, r: 0.115, colour: JADE },
  { x: 0.31, y: 0.74, r: 0.085, colour: AMBER },
  { x: 0.5, y: 0.47, r: 0.06, colour: SILT },
];
const EDGES = [
  [0, 1],
  [0, 4],
  [1, 4],
  [4, 2],
  [4, 3],
  [2, 3],
];

/** How much of the icon the mark covers; a maskable one keeps further in. */
const FRAMING = { plain: 0.9, maskable: 0.66 };

function draw(size, framing) {
  // Drawn four times over and averaged down: cheaper than antialiasing by hand.
  const ss = 4;
  const big = size * ss;
  const pixels = new Uint8Array(big * big * 4);

  for (let i = 0; i < big * big; i++) {
    pixels[i * 4] = WATER[0];
    pixels[i * 4 + 1] = WATER[1];
    pixels[i * 4 + 2] = WATER[2];
    pixels[i * 4 + 3] = 255;
  }

  const place = (p) => ({
    x: (0.5 + (p.x - 0.5) * framing) * big,
    y: (0.5 + (p.y - 0.5) * framing) * big,
  });

  for (const [from, to] of EDGES) {
    const a = place(NODES[from]);
    const b = place(NODES[to]);
    line(pixels, big, a, b, (0.022 * framing * big) / 2, FILAMENT);
  }

  for (const node of NODES) {
    const at = place(node);
    disc(pixels, big, at, node.r * framing * big, node.colour);
    // A ring of water inside the disc, so a node reads as a node.
    disc(pixels, big, at, node.r * framing * big * 0.52, WATER);
  }

  return downsample(pixels, big, ss);
}

function disc(pixels, width, at, radius, colour) {
  const r2 = radius * radius;
  for (let y = Math.max(0, at.y - radius) | 0; y < Math.min(width, at.y + radius + 1); y++) {
    for (let x = Math.max(0, at.x - radius) | 0; x < Math.min(width, at.x + radius + 1); x++) {
      const dx = x + 0.5 - at.x;
      const dy = y + 0.5 - at.y;
      if (dx * dx + dy * dy > r2) continue;
      set(pixels, width, x, y, colour);
    }
  }
}

function line(pixels, width, a, b, half, colour) {
  const minX = Math.max(0, Math.min(a.x, b.x) - half) | 0;
  const maxX = Math.min(width, Math.max(a.x, b.x) + half + 1);
  const minY = Math.max(0, Math.min(a.y, b.y) - half) | 0;
  const maxY = Math.min(width, Math.max(a.y, b.y) + half + 1);

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      if (distanceToSegment(x + 0.5, y + 0.5, a, b) > half) continue;
      set(pixels, width, x, y, colour);
    }
  }
}

function distanceToSegment(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length));
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
}

function set(pixels, width, x, y, colour) {
  const at = (y * width + x) * 4;
  pixels[at] = colour[0];
  pixels[at + 1] = colour[1];
  pixels[at + 2] = colour[2];
  pixels[at + 3] = 255;
}

function downsample(pixels, big, ss) {
  const size = big / ss;
  const out = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const total = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const at = ((y * ss + sy) * big + x * ss + sx) * 4;
          total[0] += pixels[at];
          total[1] += pixels[at + 1];
          total[2] += pixels[at + 2];
        }
      }
      const at = (y * size + x) * 4;
      const count = ss * ss;
      out[at] = Math.round(total[0] / count);
      out[at + 1] = Math.round(total[1] / count);
      out[at + 2] = Math.round(total[2] / count);
      out[at + 3] = 255;
    }
  }

  return out;
}

/* PNG, the least of it: one header chunk, the rows, and an end marker. */

function png(pixels, size) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    // Filter 0: no prediction. The image is flat colour; it compresses anyway.
    rows[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(
      rows,
      y * (size * 4 + 1) + 1,
    );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // truecolour with alpha

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, body) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(tagged), 0);
  return Buffer.concat([head, tagged, tail]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

mkdirSync(OUT, { recursive: true });
for (const [name, size, framing] of [
  ['icon-180.png', 180, FRAMING.plain],
  ['icon-192.png', 192, FRAMING.plain],
  ['icon-512.png', 512, FRAMING.plain],
  ['icon-maskable-512.png', 512, FRAMING.maskable],
]) {
  writeFileSync(join(OUT, name), png(draw(size, framing), size));
  console.log(`${name}  ${size}×${size}`);
}
