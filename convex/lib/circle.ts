// Care circle validators and wording (convex/circle.ts): which alerts a member gets, and the person's name as
// members see it.
import { v } from "convex/values";

// Urgent messages and quiet spells came later, so older rows don't have them (off).
export const circleAlerts = v.object({ missedDoses: v.boolean(), forecast: v.boolean(), urgent: v.optional(v.boolean()), quiet: v.optional(v.boolean()) });
export type CircleAlerts = { missedDoses: boolean; forecast: boolean; urgent?: boolean; quiet?: boolean };
export const ALERT_KINDS = ["missedDoses", "forecast", "urgent", "quiet"] as const;
export type CircleAlert = (typeof ALERT_KINDS)[number];
export const circleAlert = v.union(v.literal("missedDoses"), v.literal("forecast"), v.literal("urgent"), v.literal("quiet"));
// What a member turned off for themselves, on top of what the person picked for them.
export const circleMuted = circleAlerts;
// The alerts a member actually gets: picked by the person and not muted by the member.
export const alertsFor = (row: { alerts: CircleAlerts; muted?: CircleAlerts }): Required<CircleAlerts> => {
  const on = (k: CircleAlert) => !!row.alerts[k] && !row.muted?.[k];
  return { missedDoses: on("missedDoses"), forecast: on("forecast"), urgent: on("urgent"), quiet: on("quiet") };
};

// What a care circle sees the person called: the name from account setup, else the start of their email.
export function personName(user: { profile?: { name?: string }; name?: string; email?: string } | null): string {
  return user?.profile?.name?.trim() || user?.name?.trim() || user?.email?.split("@")[0] || "Wellnest user";
}
