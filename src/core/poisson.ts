import type { Rng } from './rng';

export interface Point {
  x: number;
  y: number;
}

const CANDIDATES_PER_POINT = 24;

/**
 * Bridson's Poisson-disk sampling: scatters points that are never closer than
 * minDist to each other.
 *
 * Plain uniform random points clump and leave holes, which reads as a sloppy
 * map. Even spacing also keeps node circles from overlapping on screen.
 */
export function poissonDiskSample(
  width: number,
  height: number,
  minDist: number,
  rng: Rng,
): Point[] {
  const cellSize = minDist / Math.SQRT2;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const grid: (Point | undefined)[] = new Array(cols * rows);

  const cellIndex = (p: Point) =>
    Math.floor(p.y / cellSize) * cols + Math.floor(p.x / cellSize);

  const fits = (p: Point): boolean => {
    if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) return false;
    const col = Math.floor(p.x / cellSize);
    const row = Math.floor(p.y / cellSize);
    for (let r = Math.max(0, row - 2); r <= Math.min(rows - 1, row + 2); r++) {
      for (let c = Math.max(0, col - 2); c <= Math.min(cols - 1, col + 2); c++) {
        const other = grid[r * cols + c];
        if (other && Math.hypot(other.x - p.x, other.y - p.y) < minDist) return false;
      }
    }
    return true;
  };

  const first: Point = { x: rng.float(0, width), y: rng.float(0, height) };
  const points: Point[] = [first];
  grid[cellIndex(first)] = first;
  const active: Point[] = [first];

  while (active.length > 0) {
    const activeIndex = rng.range(0, active.length - 1);
    const origin = active[activeIndex]!;
    let placed = false;

    for (let i = 0; i < CANDIDATES_PER_POINT; i++) {
      const angle = rng.float(0, Math.PI * 2);
      const distance = rng.float(minDist, minDist * 2);
      const candidate: Point = {
        x: origin.x + Math.cos(angle) * distance,
        y: origin.y + Math.sin(angle) * distance,
      };
      if (!fits(candidate)) continue;

      points.push(candidate);
      grid[cellIndex(candidate)] = candidate;
      active.push(candidate);
      placed = true;
      break;
    }

    if (!placed) {
      active[activeIndex] = active[active.length - 1]!;
      active.pop();
    }
  }

  return points;
}
