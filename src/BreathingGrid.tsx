// The landing page's dot grid on a phone: one still frame of the web version (src/BreathingGrid.web.tsx), drawn with
// plain views so it needs no canvas. Only the visible dots are drawn.
import { useMemo, useState } from "react";
import { View } from "react-native";
import { colors, themed } from "./theme";
import { BREATH_MS, dotAlpha, GAP } from "./breathingWave";

export function BreathingGrid({ height }: { height: number; lane?: [number, number] }) {
  const [width, setWidth] = useState(0);
  const dots = useMemo(() => {
    const out: { x: number; y: number; a: number }[] = [];
    if (!width) return out;
    const cols = Math.ceil(width / GAP) + 1;
    const rows = Math.ceil(height / GAP) + 1;
    const ox = (width - (cols - 1) * GAP) / 2;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = ox + c * GAP;
        const y = r * GAP;
        const a = dotAlpha(x, y, width, height, BREATH_MS * 0.3);
        if (a >= 0.04) out.push({ x, y, a });
      }
    }
    return out;
  }, [width, height]);

  return (
    <View pointerEvents="none" style={[styles.layer, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {dots.map(({ x, y, a }) => {
        const size = 1.8 + a * 5.2;
        return (
          <View
            key={`${x},${y}`}
            style={[styles.dot, { left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, opacity: a }]}
          />
        );
      })}
    </View>
  );
}

const styles = themed(() => ({
  layer: { position: "absolute" as const, top: 0, left: 0, right: 0, overflow: "hidden" as const },
  dot: { position: "absolute" as const, backgroundColor: colors.primary },
}));
