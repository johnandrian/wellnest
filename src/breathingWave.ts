// The math behind the landing page's dot grid (src/BreathingGrid.web.tsx and src/BreathingGrid.tsx), kept apart so the
// web canvas and the still phone version draw the same picture.

export const GAP = 22; // space between dots, in points
export const BREATH_MS = 10000; // one slow breath: about 6 a minute
export const TREND_MS = 5200; // a trend line draws, holds, and fades in this long

const WAVELENGTH = 520;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// How strongly to draw the dot at (x, y), from 0 to about 0.55. A ring spreads out from the top right corner once a
// breath, the grid is quieter behind the headline on the left, and it fades out toward the bottom. On a narrow screen
// the words run the full width, so the whole grid is softer there.
export function dotAlpha(x: number, y: number, w: number, h: number, ms: number) {
  const d = Math.hypot(x - w * 0.88, y - h * 0.08);
  const phase = (d / WAVELENGTH - ms / BREATH_MS) * Math.PI * 2;
  const band = Math.pow((Math.sin(phase) + 1) / 2, 3);
  const quiet = 0.4 + 0.6 * smooth(0.1, 0.65, x / w);
  const fade = 1 - smooth(0.45, 1, y / h);
  const soft = w < 768 ? 0.45 : 1;
  return (0.1 + 0.45 * band) * quiet * fade * soft;
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
