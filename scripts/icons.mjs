/**
 * Draws the home-screen icons.
 *
 * Run with `node scripts/icons.mjs`; the PNGs it writes are committed, because
 * a build must not depend on a drawing step. There is no image library here
 * and none is wanted for one line and five discs: a PNG is a zlib stream of
 * rows, and zlib ships with Node.
 *
 * The mark is the game's verb rather than its board — a node throwing its
 * garrison at a neighbour. A picture of the whole network turns to mush at
 * sixty pixels, which is the size the icon is actually looked at; two nodes
 * and a stream between them survive it, and still say what the game is.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const DEEP = [3, 12, 18];
const GLOW = [13, 45, 55];
const FILAMENT = [28, 74, 86];
const AMBER = [245, 169, 78];
const JADE = [63, 214, 193];

/** Drawn this many times over and averaged down, in place of antialiasing. */
const SS = 4;

/**
 * How much of the icon the mark covers.
 *
 * A maskable icon may be cropped to a circle by the launcher, so its mark
 * keeps well inside; iOS crops nothing and would only make it look timid.
 */
const FRAMING = { plain: 0.88, maskable: 0.68 };

function draw(size, framing) {
  const big = size * SS;
  const canvas = new Float64Array(big * big * 3);
  const u = (value) => value * framing * big;
  const at = (x, y) => [big / 2 + u(x - 0.5), big / 2 + u(y - 0.5)];

  // A pool of light behind the mark, so a flat dark square gets some depth.
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const distance = Math.hypot((x - big / 2) / big, (y - big * 0.44) / big);
      const light = Math.max(0, 1 - distance * 2.1) ** 2;
      const index = (y * big + x) * 3;
      canvas[index] = DEEP[0] + (GLOW[0] - DEEP[0]) * light;
      canvas[index + 1] = DEEP[1] + (GLOW[1] - DEEP[1]) * light;
      canvas[index + 2] = DEEP[2] + (GLOW[2] - DEEP[2]) * light;
    }
  }

  const from = at(0.24, 0.74);
  const to = at(0.76, 0.26);
  const source = u(0.155);
  const target = u(0.125) + u(0.062) / 2;

  // The edge runs between the two nodes, not under them: a line carried into
  // the middle of the ring leaves a stub sitting inside it.
  line(canvas, big, along(from, to, source), along(to, from, target), u(0.028), FILAMENT);

  // Three motes in flight, thinning out behind the one in front: the stream
  // is what tells you the points are moving rather than just connected.
  [
    [0.68, 0.042],
    [0.55, 0.034],
    [0.43, 0.025],
  ].forEach(([along, radius]) => {
    disc(
      canvas,
      big,
      [from[0] + (to[0] - from[0]) * along, from[1] + (to[1] - from[1]) * along],
      u(radius),
      AMBER,
    );
  });

  disc(canvas, big, from, source, AMBER);
  ring(canvas, big, to, u(0.125), u(0.062), JADE);

  return downsample(canvas, big);
}

/** A point `distance` along the way from one node towards another. */
function along(from, to, distance) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  return [
    from[0] + ((to[0] - from[0]) / length) * distance,
    from[1] + ((to[1] - from[1]) / length) * distance,
  ];
}

function disc(canvas, width, [cx, cy], radius, colour) {
  for (let y = Math.max(0, (cy - radius) | 0); y < Math.min(width, cy + radius + 1); y++) {
    for (let x = Math.max(0, (cx - radius) | 0); x < Math.min(width, cx + radius + 1); x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) continue;
      set(canvas, width, x, y, colour);
    }
  }
}

function ring(canvas, width, [cx, cy], radius, stroke, colour) {
  const outer = radius + stroke / 2;
  const inner = radius - stroke / 2;
  for (let y = Math.max(0, (cy - outer) | 0); y < Math.min(width, cy + outer + 1); y++) {
    for (let x = Math.max(0, (cx - outer) | 0); x < Math.min(width, cx + outer + 1); x++) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (distance > outer || distance < inner) continue;
      set(canvas, width, x, y, colour);
    }
  }
}

function line(canvas, width, a, b, stroke, colour) {
  const half = stroke / 2;
  const minX = Math.max(0, (Math.min(a[0], b[0]) - half) | 0);
  const maxX = Math.min(width, Math.max(a[0], b[0]) + half + 1);
  const minY = Math.max(0, (Math.min(a[1], b[1]) - half) | 0);
  const maxY = Math.min(width, Math.max(a[1], b[1]) + half + 1);

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      if (distanceToSegment(x + 0.5, y + 0.5, a, b) > half) continue;
      set(canvas, width, x, y, colour);
    }
  }
}

function distanceToSegment(x, y, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length));
  return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
}

function set(canvas, width, x, y, colour) {
  const index = (y * width + x) * 3;
  canvas[index] = colour[0];
  canvas[index + 1] = colour[1];
  canvas[index + 2] = colour[2];
}

function downsample(canvas, big) {
  const size = big / SS;
  const out = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const total = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const index = ((y * SS + sy) * big + x * SS + sx) * 3;
          total[0] += canvas[index];
          total[1] += canvas[index + 1];
          total[2] += canvas[index + 2];
        }
      }
      const index = (y * size + x) * 4;
      const count = SS * SS;
      out[index] = Math.round(total[0] / count);
      out[index + 1] = Math.round(total[1] / count);
      out[index + 2] = Math.round(total[2] / count);
      // Opaque throughout: iOS rounds the corners itself, and an icon with
      // transparent ones comes out with black behind them.
      out[index + 3] = 255;
    }
  }

  return out;
}

/* PNG, the least of it: one header chunk, the rows, and an end marker. */

function png(pixels, size) {
  const stride = size * 4 + 1;
  const rows = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    // Filter 0: no prediction. The image is flat colour; it compresses anyway.
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(rows, y * stride + 1);
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
