// The math behind the welcome page's dot grid (src/BreathingGrid.web.tsx and src/BreathingGrid.tsx), kept apart so the
// web canvas and the still phone version draw the same picture. Positions are in page points, so the grid scrolls with
// the page even though the canvas only covers the screen.

export const GAP = 22; // space between dots, in points
export const SPEED = 1.5; // how much faster than a calm 6-breaths-a-minute pace the grid breathes
export const BREATH_MS = 10000 / SPEED; // one breath of the wave
export const TREND_MS = 5200 / SPEED; // a trend line draws, holds, and fades in this long
export const TREND_DRAW_MS = 1400 / SPEED; // ...of which drawing it takes this long
export const TREND_FADE_MS = 1200 / SPEED; // ...and fading it this long
export const TREND_GAP_MS = [4000 / SPEED, 8000 / SPEED]; // the pause before the next line, shortest and longest

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

export type Trend = { born: number; points: [number, number][] };

// A short line across neighboring dots that drifts gently upward, like a symptom easing over a week. It stays inside
// `lane` (the rows of clear space between the top bar and the hero) and away from the left edge.
export function makeTrend(cols: number, lane: [number, number], born: number, random = Math.random): Trend {
  const [top, bottom] = lane;
  const length = 7 + Math.floor(random() * 3);
  const c0 = Math.floor(cols * 0.3 + random() * Math.max(1, cols * 0.6 - length));
  let r = top + Math.floor(random() * (bottom - top + 1));
  const points: [number, number][] = [];
  for (let i = 0; i < length; i++) {
    points.push([c0 + i, r]);
    const step = random();
    r = Math.max(top, Math.min(bottom, r + (step < 0.4 ? -1 : step < 0.8 ? 0 : 1)));
  }
  return { born, points };
}
