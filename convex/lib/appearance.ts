// The app's look, chosen in Settings → Appearance: light, dark or the phone's setting, and a text size multiplier.
import { v } from "convex/values";

export const TEXT_SIZES = [0.9, 1, 1.15, 1.3];
export const appearance = v.object({
  theme: v.union(v.literal("system"), v.literal("light"), v.literal("dark")),
  textSize: v.number(),
});
