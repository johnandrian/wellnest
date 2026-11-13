// The agent's action queue (convex/agent.ts): what an action is, and what it's based on.
// The agent only ever proposes. Nothing runs until the user approves it in the Action Inbox (src/AgentPanel.tsx).
import { v } from "convex/values";
import { urgency } from "./telehealth";

// proposed -> approved -> running -> done | failed, or proposed -> dismissed.
export const actionStatus = v.union(
  v.literal("proposed"),
  v.literal("approved"),
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("dismissed"),
);
export type ActionStatus = "proposed" | "approved" | "running" | "done" | "failed" | "dismissed";

// What the action does, one shape per kind. Add a kind here and an executor in convex/agent.ts.
export const actionDetails = v.union(
  // A note to the care team, drafted for the user to read and send.
  v.object({ kind: v.literal("message_doctor"), to: v.string(), subject: v.string(), body: v.string() }),
  // A telehealth video visit: approving it looks for times (convex/telehealth.ts), and the user still picks one.
  v.object({ kind: v.literal("book_visit"), reason: v.string(), urgency }),
  // A one-off reminder.
  v.object({ kind: v.literal("set_reminder"), text: v.string(), at: v.number() }),
);
export type ActionKind = "message_doctor" | "book_visit" | "set_reminder";

// One fact the action rests on, taken from the user's own logs, shown on the card so nothing is unexplained.
export const evidence = v.object({ label: v.string(), value: v.string(), date: v.optional(v.string()) });

// Open proposals per user; the agent stops proposing past this until some are handled.
export const MAX_OPEN = 20;
export const OPEN: ActionStatus[] = ["proposed", "approved", "running"];
