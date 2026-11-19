// Care circle validators and wording (convex/circle.ts): which alerts a member gets, and the person's name as
// members see it.
import { v } from "convex/values";

export const circleAlerts = v.object({ missedDoses: v.boolean(), forecast: v.boolean() });
export type CircleAlerts = { missedDoses: boolean; forecast: boolean };
export type CircleAlert = keyof CircleAlerts;
// What a member turned off for themselves, on top of what the person picked for them.
export const circleMuted = v.object({ missedDoses: v.boolean(), forecast: v.boolean() });
const NONE: CircleAlerts = { missedDoses: false, forecast: false };
// The alerts a member actually gets: picked by the person and not muted by the member.
export const alertsFor = (row: { alerts: CircleAlerts; muted?: CircleAlerts }): CircleAlerts => {
  const muted = row.muted ?? NONE;
  return { missedDoses: row.alerts.missedDoses && !muted.missedDoses, forecast: row.alerts.forecast && !muted.forecast };
};

// What a care circle sees the person called: the name from account setup, else the start of their email.
export function personName(user: { profile?: { name?: string }; name?: string; email?: string } | null): string {
  return user?.profile?.name?.trim() || user?.name?.trim() || user?.email?.split("@")[0] || "Wellnest user";
}
