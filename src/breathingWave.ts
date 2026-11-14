// The math behind the welcome page's dot grid (src/BreathingGrid.web.tsx and src/BreathingGrid.tsx), kept apart so the
// web canvas and the still phone version draw the same picture. Positions are in page points, so the grid scrolls with
// the page even though the canvas only covers the screen.

export const GAP = 22; // space between dots, in points
export const SPEED = 1.5; // how much faster than a calm 6-breaths-a-minute pace the grid breathes
export const BREATH_MS = 10000 / SPEED; // one breath of the wave
export const SHAPE_MS = 5200 / SPEED; // a graph draws, holds, and fades in this long
export const SHAPE_DRAW_MS = 1400 / SPEED; // ...of which drawing it takes this long
export const SHAPE_FADE_MS = 1200 / SPEED; // ...and fading it this long
export const SHAPE_GAP_MS = [1200 / SPEED, 2600 / SPEED]; // the pause before the next graph, shortest and longest
// How often each kind is picked: mostly lines, now and then bars, and only once in a while a link.
export const SHAPE_ODDS: [ShapeKind, number][] = [
  ["trend", 0.5],
  ["steps", 0.25],
  ["bars", 0.15],
  ["link", 0.1],
];

export function pickKind(random = Math.random): ShapeKind {
  let roll = random();
  for (const [kind, odds] of SHAPE_ODDS) if ((roll -= odds) < 0) return kind;
  return "trend";
}

export const MAX_SHAPES = { wide: 4, narrow: 2 }; // how many graphs can show at once

const WAVELENGTH = 520;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// How strongly to draw the dot at page point (x, y), from 0 to about 0.55. Rings spread out from the top right corner
// of the page once a breath, the grid is quieter on the left where the words start, and on a narrow screen, where the
// words run the full width, the whole grid is softer.
export function dotAlpha(x: number, y: number, w: number, ms: number) {
  const d = Math.hypot(x - w * 0.88, y - 70);
  const phase = (d / WAVELENGTH - ms / BREATH_MS) * Math.PI * 2;
  const band = Math.pow((Math.sin(phase) + 1) / 2, 3);
  const quiet = 0.4 + 0.6 * smooth(0.1, 0.65, x / w);
  const soft = w < 768 ? 0.45 : 1;
  return (0.1 + 0.45 * band) * quiet * soft;
}

// The small graphs that come and go on the grid, each built on its dots (page columns and rows):
// - "trend": a line across neighboring dots that drifts gently upward, like a symptom easing over a week;
// - "steps": a line that holds level and then jumps, like sleep stages through a night;
// - "bars": a few columns of dots rising from one baseline, like a week of daily scores;
// - "link": a curve that joins two dots a little apart, like a pattern Wellnest found between two things.
// `points` are every dot a graph lights or crosses, used to keep graphs off words and apart from each other.
export type ShapeKind = "trend" | "steps" | "bars" | "link";
export type Shape = { kind: ShapeKind; born: number; points: [number, number][] };

export function makeShape(kind: ShapeKind, c0: number, r0: number, born: number, random = Math.random): Shape {
  const points: [number, number][] = [];
  if (kind === "trend") {
    let r = r0;
    const length = 6 + Math.floor(random() * 4);
    for (let i = 0; i < length; i++) {
      points.push([c0 + i, r]);
      const step = random();
      r += step < 0.4 ? -1 : step < 0.8 ? 0 : 1;
    }
  } else if (kind === "steps") {
    // Every dot along the way, so each piece runs straight across or straight up or down.
    let c = c0;
    let r = r0;
    points.push([c, r]);
    while (c < c0 + 9) {
      const run = 1 + Math.floor(random() * 3);
      for (let i = 0; i < run; i++) points.push([++c, r]);
      let next = r0 + Math.floor(random() * 7) - 3;
      if (next === r) next = r + (r < r0 ? 1 : -1);
      while (r !== next) points.push([c, (r += Math.sign(next - r))]);
    }
  } else if (kind === "bars") {
    // r0 is the baseline; each bar is listed from the baseline up.
    const count = 5 + Math.floor(random() * 3);
    for (let i = 0; i < count; i++) {
      const tall = 1 + Math.floor(random() * 4);
      for (let k = 0; k < tall; k++) points.push([c0 + i * 2, r0 - k]);
    }
  } else {
    // Just the two ends; the curve between them is worked out when it is drawn.
    points.push([c0, r0], [c0 + 5 + Math.floor(random() * 6), r0 + Math.floor(random() * 7) - 3]);
  }
  return { kind, born, points };
}

// How wide (columns) and how far above and below its start row (rows) a graph of each kind can reach.
export const SHAPE_SPAN: Record<ShapeKind, { cols: number; up: number; down: number }> = {
  trend: { cols: 10, up: 9, down: 9 },
  steps: { cols: 11, up: 3, down: 3 },
  bars: { cols: 14, up: 3, down: 0 },
  link: { cols: 11, up: 5, down: 3 }, // the arc bows up to about 4.2 rows above the start
};

// The point on a link's curve at t (0 to 1): a gentle arc bowing upward between the two ends.
export function linkPoint(a: [number, number], b: [number, number], t: number): [number, number] {
  const mx = (a[0] + b[0]) / 2;
  const my = Math.min(a[1], b[1]) - Math.max(1.5, Math.abs(b[0] - a[0]) * 0.35);
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * mx + t * t * b[0], u * u * a[1] + 2 * u * t * my + t * t * b[1]];
}

// Every spot a graph covers, in columns and rows (a link's curve is sampled), for checking it has room.
export function footprint(shape: Shape): [number, number][] {
  if (shape.kind !== "link") return shape.points;
  const [a, b] = shape.points;
  return Array.from({ length: 13 }, (_, i) => linkPoint(a, b, i / 12));
}
