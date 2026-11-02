// Medication details beyond the reminder schedule: form, per-time doses, refill supply and history.
// Shared by convex/medications.ts, convex/reminders.ts and reports.
import { v } from "convex/values";
import type { Schedule } from "./reminders";

export const medForm = v.union(
  v.literal("tablet"),
  v.literal("capsule"),
  v.literal("liquid"),
  v.literal("inhaler"),
  v.literal("patch"),
  v.literal("injection"),
  v.literal("cream"),
  v.literal("drops"),
  v.literal("other"),
);

export const timeDose = v.object({ time: v.string(), dose: v.string() });

// Units left, units per dose, and how many days ahead to warn.
export const supply = v.object({
  left: v.number(),
  perDose: v.number(),
  warnDays: v.number(),
  warnedAt: v.optional(v.number()),
  refilledAt: v.optional(v.number()),
});
export type Supply = { left: number; perDose: number; warnDays: number; warnedAt?: number; refilledAt?: number };

export const medEventKind = v.union(
  v.literal("started"),
  v.literal("paused"),
  v.literal("resumed"),
  v.literal("stopped"),
  v.literal("dose_changed"),
  v.literal("refilled"),
);

export function dosesPerDay(s: Schedule): number {
  return s.kind === "daily" ? s.times.length : 24 / s.everyHours;
}

// Whole days the supply lasts at this schedule, or null without a supply set.
export function daysLeft(s: Schedule, supply?: Supply): number | null {
  if (!supply || supply.perDose <= 0) return null;
  return Math.floor(supply.left / (supply.perDose * dosesPerDay(s)));
}

// The dose for a reminder at this local "HH:MM": a per-time dose if set, otherwise the usual dose.
export function doseAt(time: string, dose?: string, timeDoses?: { time: string; dose: string }[]): string | undefined {
  return timeDoses?.find((t) => t.time === time)?.dose ?? dose;
}

export type MedStatus = "active" | "paused" | "stopped";
export function statusOf(m: { active: boolean; pausedAt?: number; stoppedAt?: number }): MedStatus {
  return m.active ? "active" : m.pausedAt && !m.stoppedAt ? "paused" : "stopped";
}
