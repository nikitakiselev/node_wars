import type { NodeKind } from '../core/state';

/**
 * The kinds, drawn as SVG.
 *
 * The board draws the same silhouettes into Pixi, which cannot be shared with
 * a page — but everything on a page can share this: the button that offers to
 * build a kind and the rules panel that explains it. Two drawings of one
 * shape are already one too many, and three would be a promise nobody keeps.
 *
 * The proportions are the board's own, so a mark here and a node out there
 * are recognisably the same thing rather than two pictures of it.
 */
const SVG = 'http://www.w3.org/2000/svg';

/** Where everything is drawn from, in a 24-unit square. */
const MIDDLE = 12;
/** The node itself, when the node is drawn at all. */
const NODE = 6.4;

/** The kind's badge alone, for a button that is already a circle. */
export function kindBadge(kind: NodeKind): SVGElement {
  return draw((svg) => badge(svg, kind, NODE * 1.45));
}

/** The node wearing its badge, for a list that has to say which is which. */
export function kindMark(kind: NodeKind): SVGElement {
  return draw((svg) => {
    circle(svg, NODE);
    badge(svg, kind, NODE);
  });
}

function draw(build: (svg: SVGElement) => void): SVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  build(svg);
  return svg;
}

/**
 * What each kind wears, measured from the node it sits on.
 *
 * A fortress gets corners, because a corner is the one thing that cannot be
 * mistaken for another circle. A farm gets rays all the way round, since it
 * earns where it stands. A core gets a halo, which reaches away from it, as
 * its earning does. A balancer gets three of the farm's rays and only at the
 * top: it earns nothing and only ever passes things on.
 */
function badge(svg: SVGElement, kind: NodeKind, radius: number): void {
  if (kind === 'fortress') {
    hexagon(svg, radius * 1.24);
    return;
  }

  if (kind === 'core') {
    circle(svg, radius * 1.3);
    circle(svg, radius * (1.3 + 0.22), 0.55);
    return;
  }

  if (kind === 'farm') {
    for (let ray = 0; ray < 6; ray++) {
      spoke(svg, (ray * Math.PI) / 3 + Math.PI / 6, radius * 1.18, radius * 1.5);
    }
    return;
  }

  if (kind === 'balancer') {
    for (let ray = -1; ray <= 1; ray++) {
      spoke(svg, (ray * Math.PI) / 5 - Math.PI / 2, radius * 1.1, radius * 1.55);
    }
  }
}

function circle(svg: SVGElement, radius: number, opacity = 1): void {
  const shape = document.createElementNS(SVG, 'circle');
  shape.setAttribute('cx', String(MIDDLE));
  shape.setAttribute('cy', String(MIDDLE));
  shape.setAttribute('r', radius.toFixed(2));
  if (opacity !== 1) shape.setAttribute('opacity', String(opacity));
  svg.appendChild(shape);
}

function hexagon(svg: SVGElement, radius: number): void {
  const points: string[] = [];
  // Flat-topped, the way the board traces it.
  for (let corner = 0; corner < 6; corner++) {
    points.push(at((corner * Math.PI) / 3, radius));
  }
  path(svg, `M${points.join('L')}Z`);
}

function spoke(svg: SVGElement, angle: number, from: number, to: number): void {
  path(svg, `M${at(angle, from)}L${at(angle, to)}`);
}

function at(angle: number, radius: number): string {
  return `${(MIDDLE + Math.cos(angle) * radius).toFixed(2)} ${(
    MIDDLE + Math.sin(angle) * radius
  ).toFixed(2)}`;
}

function path(svg: SVGElement, d: string): void {
  const shape = document.createElementNS(SVG, 'path');
  shape.setAttribute('d', d);
  svg.appendChild(shape);
}
