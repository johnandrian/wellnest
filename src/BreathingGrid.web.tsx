// The welcome page's background on the web: a fine grid of teal dots behind the whole page that a wave swells and fades
// in a steady breathing rhythm, and now and then a few dots link up into a short trend line, the kind of pattern
// Wellnest finds in sleep, pain, and mood, before it dissolves back into the grid.
// The canvas only covers the screen and stays put; the dots move with `scroll` (the page's scroll offset, kept up to
// date by the page) so the grid looks like part of the page from top to bottom. Trend lines only appear where the page
// says there is room (`lane`, in page points), so never over words.
// It ignores the pointer, pauses when the tab is hidden, and with reduced motion holds one still frame (redrawn only
// when the page scrolls). src/BreathingGrid.tsx is the still version for phones.
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { colors, themed } from "./theme";
import { useReducedMotion } from "./Motion";
import { BREATH_MS, dotAlpha, GAP, makeTrend, Trend, TREND_DRAW_MS, TREND_FADE_MS, TREND_GAP_MS, TREND_MS } from "./breathingWave";

function rgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

const pause = () => TREND_GAP_MS[0] + Math.random() * (TREND_GAP_MS[1] - TREND_GAP_MS[0]);

export function BreathingGrid({ scroll, lane }: { scroll: { current: number }; lane?: [number, number] }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  const top = lane?.[0];
  const bottom = lane?.[1];

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let w = 0;
    let h = 0;
    let frame = 0;
    let trend: Trend | null = null;
    let nextTrend = pause() / 2;
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

    const draw = (ms: number) => {
      const sy = scroll.current;
      ctx.clearRect(0, 0, w, h);
      const ink = rgb(colors.primary); // read every frame, so a dark-mode switch shows at once
      const cols = Math.ceil(w / GAP) + 1;
      const ox = (w - (cols - 1) * GAP) / 2;
      const r0 = Math.floor(sy / GAP);
      const r1 = Math.ceil((sy + h) / GAP);

      // A new line only starts while its lane is on screen.
      const laneRows: [number, number] | null =
        top !== undefined && bottom !== undefined ? [Math.ceil(top / GAP), Math.floor(bottom / GAP)] : null;
      if (!reduced && laneRows && !trend && ms >= nextTrend && bottom! > sy) trend = makeTrend(cols, laneRows, ms);
      const lit = new Map<string, number>(); // dots on the trend line, and how lit each is

      // The trend line draws itself point by point, holds, then fades.
      if (trend) {
        const age = ms - trend.born;
        if (age > TREND_MS) {
          trend = null;
          nextTrend = ms + pause();
        } else {
          const pts = trend.points;
          const drawn = Math.min(1, age / TREND_DRAW_MS) * (pts.length - 1);
          const fade = age > TREND_MS - TREND_FADE_MS ? (TREND_MS - age) / TREND_FADE_MS : 1;
          ctx.lineWidth = 1.25;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.strokeStyle = `rgba(${ink}, ${0.42 * fade})`;
          ctx.beginPath();
          pts.forEach(([c, r], i) => {
            if (i > Math.ceil(drawn)) return;
            const x = ox + c * GAP;
            const y = r * GAP - sy;
            if (i === 0) ctx.moveTo(x, y);
            else if (i > drawn) {
              // the segment that is still being drawn
              const [pc, pr] = pts[i - 1];
              const k = drawn - (i - 1);
              ctx.lineTo(ox + (pc + (c - pc) * k) * GAP, (pr + (r - pr) * k) * GAP - sy);
            } else ctx.lineTo(x, y);
            if (i <= drawn) lit.set(`${c},${r}`, fade);
          });
          ctx.stroke();
        }
      }

      for (let c = 0; c < cols; c++) {
        const x = ox + c * GAP;
        for (let r = r0; r <= r1; r++) {
          const on = lit.get(`${c},${r}`);
          const a = dotAlpha(x, r * GAP, w, ms);
          if (a < 0.01 && on === undefined) continue;
          ctx.fillStyle = `rgba(${ink}, ${on !== undefined ? Math.max(a, 0.7 * on) : a})`;
          ctx.beginPath();
          ctx.arc(x, r * GAP - sy, on !== undefined ? 2.2 : 0.9 + a * 2.6, 0, Math.PI * 2);
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
  }, [reduced, scroll, top, bottom]);

  return (
    <View pointerEvents="none" style={styles.layer} aria-hidden>
      <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block" }} />
    </View>
  );
}

const styles = themed(() => ({
  layer: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 },
}));
