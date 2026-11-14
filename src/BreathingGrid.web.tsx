// The welcome page's background on the web: a fine grid of teal dots behind the whole page that a wave swells and fades
// in a steady breathing rhythm. Small graphs come and go on it, the kinds of things Wellnest shows: mostly trend lines
// and step lines (like sleep stages), then scatters with a fitted line, dose timelines with a missed dose or two, and
// little bar charts of lit dots, and once in a while a curved link between two dots with a pulse running along it,
// like a pattern found between two things. Each draws itself, holds, and dissolves back into the grid.
// The canvas only covers the screen and stays put; the dots move with `scroll` (the page's scroll offset, kept up to
// date by the page) so the grid looks like part of the page from top to bottom. Before a graph appears it checks the
// page under every dot it would use and only goes where there are no words, buttons, or cards, and never on top of
// another graph.
// It ignores the pointer, pauses when the tab is hidden, and with reduced motion holds one still frame (redrawn only
// when the page scrolls). src/BreathingGrid.tsx is the still version for phones.
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { colors, themed } from "./theme";
import { useReducedMotion } from "./Motion";
import {
  BREATH_MS,
  dotAlpha,
  fitLine,
  footprint,
  GAP,
  linkPoint,
  makeShape,
  MAX_SHAPES,
  Shape,
  SHAPE_DRAW_MS,
  SHAPE_FADE_MS,
  SHAPE_GAP_MS,
  SHAPE_MS,
  SHAPE_SPAN,
  pickKind,
} from "./breathingWave";

function rgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

const pause = () => SHAPE_GAP_MS[0] + Math.random() * (SHAPE_GAP_MS[1] - SHAPE_GAP_MS[0]);
const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function BreathingGrid({ scroll }: { scroll: { current: number } }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    const screen = el?.parentElement?.parentElement; // the page's own screen, which holds this layer and the page
    if (!el || !ctx || !screen) return;
    let w = 0;
    let h = 0;
    let frame = 0;
    let shapes: Shape[] = [];
    let nextShape = 600;
    let drawnAt = NaN; // the scroll offset of the last still frame
    const start = performance.now();

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawnAt = NaN;
    };

    // Whether the page is bare background at screen point (x, y): nothing there has its own fill or picture, and no
    // words. Anything above the page (a dialog) or off the canvas counts as taken.
    const bare = (x: number, y: number, box: DOMRect, seen: Map<Element, boolean>) => {
      if (x < 6 || y < 6 || x > w - 6 || y > h - 6) return false;
      let n = document.elementFromPoint(box.left + x, box.top + y);
      if (!n || !screen.contains(n)) return false;
      for (; n && n !== screen; n = n.parentElement) {
        let ok = seen.get(n);
        if (ok === undefined) {
          const cs = getComputedStyle(n);
          const fill = cs.backgroundColor;
          ok =
            (fill === "transparent" || fill === "rgba(0, 0, 0, 0)") &&
            cs.backgroundImage === "none" &&
            n.tagName !== "IMG" &&
            !Array.from(n.childNodes).some((c) => c.nodeType === Node.TEXT_NODE && !!c.textContent?.trim());
          seen.set(n, ok);
        }
        if (!ok) return false;
      }
      return true;
    };

    // Try a few spots on screen for a new graph and keep the first that has room.
    const spawn = (ms: number, cols: number, ox: number, sy: number) => {
      const box = el.getBoundingClientRect();
      const seen = new Map<Element, boolean>();
      const taken = shapes.flatMap(footprint);
      const rTop = Math.ceil(sy / GAP);
      const rBottom = Math.floor((sy + h) / GAP);
      for (let tries = 0; tries < 18; tries++) {
        const kind = pickKind();
        if (kind === "link" && shapes.some((s) => s.kind === "link")) continue; // one arch on screen at most
        const span = SHAPE_SPAN[kind];
        const lo = rTop + span.up + 1;
        const hi = rBottom - span.down - 1;
        if (cols < span.cols + 2 || hi < lo) continue;
        const c0 = 1 + Math.floor(Math.random() * (cols - span.cols - 2));
        const r0 = lo + Math.floor(Math.random() * (hi - lo + 1));
        const shape = makeShape(kind, c0, r0, ms);
        const spots = footprint(shape);
        const clash = spots.some(([c, r]) => taken.some(([tc, tr]) => Math.abs(tc - c) < 3 && Math.abs(tr - r) < 3));
        if (clash) continue;
        const room = spots.every(([c, r]) => {
          const x = ox + c * GAP;
          const y = r * GAP - sy;
          return [[0, 0], [13, 0], [-13, 0], [0, 13], [0, -13]].every(([dx, dy]) => bare(x + dx, y + dy, box, seen));
        });
        if (room) return shape;
      }
      return null;
    };

    const draw = (ms: number) => {
      const sy = scroll.current;
      ctx.clearRect(0, 0, w, h);
      const ink = rgb(colors.primary); // read every frame, so a dark-mode switch shows at once
      const cols = Math.ceil(w / GAP) + 1;
      const ox = (w - (cols - 1) * GAP) / 2;
      const r0 = Math.floor(sy / GAP);
      const r1 = Math.ceil((sy + h) / GAP);
      const X = (c: number) => ox + c * GAP;
      const Y = (r: number) => r * GAP - sy;

      shapes = shapes.filter((s) => ms - s.born <= SHAPE_MS);
      if (!reduced && ms >= nextShape) {
        const max = w >= 768 ? MAX_SHAPES.wide : MAX_SHAPES.narrow;
        const shape = shapes.length < max ? spawn(ms, cols, ox, sy) : null;
        if (shape) shapes.push(shape);
        nextShape = ms + (shape ? pause() : 400);
      }

      const lit = new Map<string, number>(); // dots a graph lights, and how brightly
      const light = (c: number, r: number, v: number) => lit.set(`${c},${r}`, Math.max(v, lit.get(`${c},${r}`) ?? 0));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (const s of shapes) {
        const age = ms - s.born;
        const p = clamp(age / SHAPE_DRAW_MS); // how much of it has drawn
        const fade = age > SHAPE_MS - SHAPE_FADE_MS ? clamp((SHAPE_MS - age) / SHAPE_FADE_MS) : 1;
        const pts = s.points;

        if (s.kind === "trend" || s.kind === "steps") {
          // A line that draws itself point by point. A step line lights only its corners and ends, and keeps its
          // corners sharp.
          const drawn = p * (pts.length - 1);
          const corner = (i: number) => {
            if (s.kind === "trend" || i === 0 || i === pts.length - 1) return true;
            const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
            return b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1];
          };
          ctx.lineJoin = s.kind === "steps" ? "miter" : "round";
          ctx.lineWidth = 1.25;
          ctx.strokeStyle = `rgba(${ink}, ${0.42 * fade})`;
          ctx.beginPath();
          pts.forEach(([c, r], i) => {
            if (i > Math.ceil(drawn)) return;
            if (i === 0) ctx.moveTo(X(c), Y(r));
            else if (i > drawn) {
              const [pc, pr] = pts[i - 1];
              const k = drawn - (i - 1);
              ctx.lineTo(X(pc + (c - pc) * k), Y(pr + (r - pr) * k));
            } else ctx.lineTo(X(c), Y(r));
            if (i <= drawn && corner(i)) light(c, r, fade);
          });
          ctx.stroke();
          ctx.lineJoin = "round";
        } else if (s.kind === "bars") {
          // Bars rise one after another from a shared baseline, a soft stroke behind their lit dots.
          const bars = new Map<number, number[]>();
          pts.forEach(([c, r]) => bars.set(c, [...(bars.get(c) ?? []), r]));
          const list = [...bars.entries()];
          ctx.lineWidth = 3;
          ctx.strokeStyle = `rgba(${ink}, ${0.22 * fade})`;
          list.forEach(([c, rows], i) => {
            const grow = clamp(p * list.length - i * 0.7);
            if (grow <= 0) return;
            const base = rows[0];
            const top = base - (rows.length - 1) * grow;
            ctx.beginPath();
            ctx.moveTo(X(c), Y(base));
            ctx.lineTo(X(c), Y(top));
            ctx.stroke();
            rows.forEach((r) => r >= top - 0.01 && light(c, r, fade));
          });
        } else if (s.kind === "scatter") {
          // The dots light up one by one, then the line that fits them draws across.
          pts.forEach(([c, r], i) => p * 1.6 * pts.length > i && light(c, r, fade));
          const q = clamp(p * 1.6 - 0.6); // the line starts once most dots are in
          if (q > 0) {
            const [[c1, rr1], [c2, rr2]] = fitLine(pts);
            ctx.lineWidth = 1.25;
            ctx.strokeStyle = `rgba(${ink}, ${0.4 * fade})`;
            ctx.beginPath();
            ctx.moveTo(X(c1), Y(rr1));
            ctx.lineTo(X(c1 + (c2 - c1) * q), Y(rr1 + (rr2 - rr1) * q));
            ctx.stroke();
          }
        } else if (s.kind === "doses") {
          // A thin timeline draws across; each dose shows as the line reaches it, solid if taken, a ring if missed.
          const [first] = pts;
          const last = pts[pts.length - 1];
          const reach = first[0] + (last[0] - first[0]) * p;
          ctx.lineWidth = 1;
          ctx.strokeStyle = `rgba(${ink}, ${0.3 * fade})`;
          ctx.beginPath();
          ctx.moveTo(X(first[0]), Y(first[1]));
          ctx.lineTo(X(reach), Y(first[1]));
          ctx.stroke();
          pts.forEach(([c, r], i) => {
            if (c > reach + 0.01) return;
            if (s.missed?.includes(i)) {
              ctx.fillStyle = colors.bg; // hide the grid dot inside the ring
              ctx.beginPath();
              ctx.arc(X(c), Y(r), 4, 0, Math.PI * 2);
              ctx.fill();
              ctx.lineWidth = 1.25;
              ctx.strokeStyle = `rgba(${ink}, ${0.6 * fade})`;
              ctx.beginPath();
              ctx.arc(X(c), Y(r), 3.5, 0, Math.PI * 2);
              ctx.stroke();
              lit.set(`${c},${r}`, -1); // keep the grid from drawing a dot here
            } else {
              light(c, r, fade);
              ctx.fillStyle = `rgba(${ink}, ${0.75 * fade})`;
              ctx.beginPath();
              ctx.arc(X(c), Y(r), 3, 0, Math.PI * 2);
              ctx.fill();
            }
          });
        } else {
          // A dashed curve joins the two ends, then a pulse runs along it while it holds.
          const [a, b] = pts;
          ctx.lineWidth = 1.25;
          ctx.strokeStyle = `rgba(${ink}, ${0.45 * fade})`;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          for (let i = 0; i <= 24 * p; i++) {
            const [c, r] = linkPoint(a, b, i / 24);
            if (i === 0) ctx.moveTo(X(c), Y(r));
            else ctx.lineTo(X(c), Y(r));
          }
          ctx.stroke();
          ctx.setLineDash([]);
          for (const [end, at] of [[a, 0], [b, 1]] as const) {
            if (p < at) continue;
            light(end[0], end[1], fade);
            ctx.lineWidth = 1;
            ctx.strokeStyle = `rgba(${ink}, ${0.3 * fade})`;
            ctx.beginPath();
            ctx.arc(X(end[0]), Y(end[1]), 5.5, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (p >= 1) {
            const [c, r] = linkPoint(a, b, ((age - SHAPE_DRAW_MS) / 900) % 1);
            ctx.fillStyle = `rgba(${ink}, ${0.8 * fade})`;
            ctx.beginPath();
            ctx.arc(X(c), Y(r), 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      for (let c = 0; c < cols; c++) {
        for (let r = r0; r <= r1; r++) {
          const on = lit.get(`${c},${r}`);
          if (on === -1) continue;
          const a = dotAlpha(X(c), r * GAP, w, ms);
          if (a < 0.01 && on === undefined) continue;
          ctx.fillStyle = `rgba(${ink}, ${on !== undefined ? Math.max(a, 0.7 * on) : a})`;
          ctx.beginPath();
          ctx.arc(X(c), Y(r), on !== undefined ? 2.2 : 0.9 + a * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const tick = () => {
      if (!reduced) draw(performance.now() - start);
      else if (drawnAt !== scroll.current) {
        drawnAt = scroll.current;
        draw(BREATH_MS * 0.3);
      }
      frame = requestAnimationFrame(tick);
    };
    const run = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) frame = requestAnimationFrame(tick);
    };

    size();
    run();
    const resize = new ResizeObserver(size);
    resize.observe(el);
    document.addEventListener("visibilitychange", run);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      document.removeEventListener("visibilitychange", run);
    };
  }, [reduced, scroll]);

  return (
    <View pointerEvents="none" style={styles.layer} aria-hidden>
      <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block" }} />
    </View>
  );
}

const styles = themed(() => ({
  layer: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 },
}));
