// Care circle validators and wording (convex/circle.ts): which alerts a member gets, and the person's name as
// members see it.
import { v } from "convex/values";

export const circleAlerts = v.object({ missedDoses: v.boolean(), forecast: v.boolean() });
export type CircleAlerts = { missedDoses: boolean; forecast: boolean };
export type CircleAlert = keyof CircleAlerts;

// What a care circle sees the person called: the name from account setup, else the start of their email.
export function personName(user: { profile?: { name?: string }; name?: string; email?: string } | null): string {
  return user?.profile?.name?.trim() || user?.name?.trim() || user?.email?.split("@")[0] || "Wellnest user";
}
