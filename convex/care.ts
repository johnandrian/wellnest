// Find care nearby (convex/lib/places.ts): the Care tab and the model's find_care tool. Uses the phone's location
// when the app sends it, otherwise the user's saved location (geocoded once and kept on the user).
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, ActionCtx, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { CareKind, careKind, geocode, nearby, Place, placesText } from "./lib/places";

type Found = { places: Place[]; near: string } | { error: string };

async function find(ctx: ActionCtx, userId: Id<"users">, kind: CareKind, coords?: { lat: number; lon: number }): Promise<Found> {
  if (coords) return { places: await nearby(kind, coords.lat, coords.lon), near: "your current location" };
  const user: Doc<"users"> | null = await ctx.runQuery(internal.pipeline.getUser, { userId });
  const location = user?.location?.trim();
  if (!location) return { error: "No location yet. Share your location or save a city or zip in Settings." };
  let point = user?.locationPoint?.for === location ? user.locationPoint : null;
  if (!point) {
    const hit = await geocode(location);
    if (!hit) return { error: `Couldn't find "${location}" on the map. Try a city and zip.` };
    point = { lat: hit.lat, lon: hit.lon, for: location };
    await ctx.runMutation(internal.care.savePoint, { userId, point });
  }
  return { places: await nearby(kind, point.lat, point.lon), near: location };
}

export const savePoint = internalMutation({
  args: { userId: v.id("users"), point: v.object({ lat: v.number(), lon: v.number(), for: v.string() }) },
  handler: (ctx, { userId, point }) => ctx.db.patch(userId, { locationPoint: point }),
});

// The Care tab. `lat`/`lon` come from the phone or browser when the user taps "Use my location".
export const search = action({
  args: { kind: careKind, lat: v.optional(v.number()), lon: v.optional(v.number()) },
  handler: async (ctx, { kind, lat, lon }): Promise<Found> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const coords = lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
    try {
      return await find(ctx, userId, kind, coords);
    } catch (e) {
      console.error("care search failed", e);
      return { error: "The map service didn't answer. Please try again in a moment." };
    }
  },
});

// The model's find_care tool, called from the pipeline's action.
export async function careForModel(ctx: ActionCtx, userId: Id<"users">, kind: CareKind): Promise<string> {
  try {
    const found = await find(ctx, userId, kind);
    if ("error" in found) return `Tool error: ${found.error} Ask the user for their city or zip and call save_location.`;
    return placesText(kind, found.places, found.near);
  } catch (e) {
    return `Tool error: ${(e as Error).message}. Fall back to web_search.`;
  }
}
