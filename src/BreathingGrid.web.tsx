// The landing page's background on the web: a fine grid of teal dots that a slow wave swells and fades at the pace of
// calm breathing (one breath every 10 seconds), and now and then a few dots link up into a short trend line, the kind of
// pattern Wellnest finds in sleep, pain, and mood, before it dissolves back into the grid.
// Trend lines only appear where the page says there is room (`lane`, in points from the top), so never over words.
// It sits behind the page and ignores the pointer. It pauses when the tab is hidden or it scrolls out of view, and
// with reduced motion it draws one still frame. src/BreathingGrid.tsx is the still version for phones.
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { colors, themed } from "./theme";
import { useReducedMotion } from "./Motion";
import { BREATH_MS, dotAlpha, GAP, makeTrend, Trend, TREND_MS } from "./breathingWave";

function rgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export function BreathingGrid({ height, lane }: { height: number; lane?: [number, number] }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let w = 0;
    let h = 0;
    let frame = 0;
    let visible = true;
    let trend: Trend | null = null;
    let nextTrend = 2500; // the first line appears after a breath or so
    const start = performance.now();

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (ms: number) => {
      ctx.clearRect(0, 0, w, h);
      const ink = rgb(colors.primary); // read every frame, so a dark-mode switch shows at once
      const cols = Math.ceil(w / GAP) + 1;
      const rows = Math.ceil(h / GAP) + 1;
      const ox = (w - (cols - 1) * GAP) / 2;

      if (!reduced && lane && ms >= nextTrend && !trend) trend = makeTrend(cols, [Math.ceil(lane[0] / GAP), Math.floor(lane[1] / GAP)], ms);
      const lit = new Map<string, number>(); // dots on the trend line, and how lit each is

      // The trend line draws itself point by point, holds, then fades.
      if (trend) {
        const age = reduced ? TREND_MS * 0.5 : ms - trend.born;
        if (age > TREND_MS) {
          trend = null;
          nextTrend = ms + 4000 + Math.random() * 4000;
        } else {
          const drawn = Math.min(1, age / 1400) * (trend.points.length - 1);
          const fade = age > TREND_MS - 1200 ? (TREND_MS - age) / 1200 : 1;
          ctx.lineWidth = 1.25;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.strokeStyle = `rgba(${ink}, ${0.42 * fade})`;
          ctx.beginPath();
          trend.points.forEach(([c, r], i) => {
            if (i > Math.ceil(drawn)) return;
            const x = ox + c * GAP;
            const y = r * GAP;
            if (i === 0) ctx.moveTo(x, y);
            else if (i > drawn) {
              // the segment that is still being drawn
              const [pc, pr] = trend!.points[i - 1];
              const k = drawn - (i - 1);
              ctx.lineTo(ox + (pc + (c - pc) * k) * GAP, (pr + (r - pr) * k) * GAP);
            } else ctx.lineTo(x, y);
            if (i <= drawn) lit.set(`${c},${r}`, fade);
          });
          ctx.stroke();
        }
      }

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const x = ox + c * GAP;
          const y = r * GAP;
          const on = lit.get(`${c},${r}`);
          const a = dotAlpha(x, y, w, h, ms);
          if (a < 0.01 && on === undefined) continue;
          ctx.fillStyle = `rgba(${ink}, ${on !== undefined ? Math.max(a, 0.7 * on) : a})`;
          ctx.beginPath();
          ctx.arc(x, y, on !== undefined ? 2.2 : 0.9 + a * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const tick = () => {
      draw(performance.now() - start);
      frame = requestAnimationFrame(tick);
    };
    const run = () => {
      cancelAnimationFrame(frame);
      if (reduced) draw(BREATH_MS * 0.3);
      else if (visible && !document.hidden) frame = requestAnimationFrame(tick);
    };

    size();
    run();
    const resize = new ResizeObserver(() => {
      size();
      if (reduced) run();
    });
    resize.observe(el);
    const seen = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      run();
    });
    seen.observe(el);
    document.addEventListener("visibilitychange", run);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", run);
    };
  }, [reduced, lane?.[0], lane?.[1]]);

  return (
    <View pointerEvents="none" style={[styles.layer, { height }]} aria-hidden>
      <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block" }} />
    </View>
  );
}

const styles = themed(() => ({
  layer: { position: "absolute" as const, top: 0, left: 0, right: 0 },
}));
