// The agent's Action Inbox. The agent (the morning check in convex/agentScan.ts; later the chat model and documents
// the user adds) proposes through `insertProposal`; the user approves or dismisses each action in the Health tools'
// Actions tab (src/AgentPanel.tsx); approving schedules `execute`, which runs that kind's executor and records what happened.
// Nothing outward-facing happens without the user's tap.
import { Infer, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, internalMutation, internalQuery, mutation, MutationCtx, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { actionDetails, evidence, MAX_OPEN, OPEN } from "./lib/agent";

const DAY_MS = 24 * 60 * 60 * 1000;

// The user's actions, newest first: the inbox splits them into "needs you" and "history".
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("agentActions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

async function ownProposal(ctx: MutationCtx, userId: Id<"users"> | null, id: Id<"agentActions">): Promise<Doc<"agentActions">> {
  if (!userId) throw new Error("Not signed in");
  const action = await ctx.db.get(id);
  if (!action || action.userId !== userId) throw new Error("Action not found");
  if (action.status !== "proposed") throw new Error("This action was already handled.");
  return action;
}

export const approve = mutation({
  args: { id: v.id("agentActions") },
  handler: async (ctx, { id }) => {
    await ownProposal(ctx, await getAuthUserId(ctx), id);
    await ctx.db.patch("agentActions", id, { status: "approved", decidedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.agent.execute, { id });
    return null;
  },
});

export const dismiss = mutation({
  args: { id: v.id("agentActions") },
  handler: async (ctx, { id }) => {
    await ownProposal(ctx, await getAuthUserId(ctx), id);
    await ctx.db.patch("agentActions", id, { status: "dismissed", decidedAt: Date.now() });
    return null;
  },
});

const proposalArgs = {
  userId: v.id("users"),
  title: v.string(),
  reason: v.string(),
  evidence: v.array(evidence),
  details: actionDetails,
  urgent: v.boolean(),
  rule: v.optional(v.string()),
  cooldownDays: v.optional(v.number()),
};
const proposal = v.object(proposalArgs);
export type ProposalArgs = Infer<typeof proposal>;

// Every action enters the inbox through here. Returns null, adding nothing, when the user already has MAX_OPEN
// open actions, or when the same rule proposed something (whatever became of it) within its cooldown.
export async function insertProposal(ctx: MutationCtx, { cooldownDays, ...args }: ProposalArgs): Promise<Id<"agentActions"> | null> {
  if (args.rule) {
    const last = await ctx.db
      .query("agentActions")
      .withIndex("by_user_and_rule", (q) => q.eq("userId", args.userId).eq("rule", args.rule))
      .order("desc")
      .first();
    if (last && last._creationTime > Date.now() - (cooldownDays ?? 14) * DAY_MS) return null;
  }
  let open = 0;
  for (const status of OPEN) {
    open += (await ctx.db.query("agentActions").withIndex("by_user_and_status", (q) => q.eq("userId", args.userId).eq("status", status)).take(MAX_OPEN)).length;
  }
  if (open >= MAX_OPEN) return null;
  return await ctx.db.insert("agentActions", {
    ...args,
    title: args.title.trim().slice(0, 120),
    reason: args.reason.trim().slice(0, 600),
    evidence: args.evidence.slice(0, 8),
    status: "proposed",
  });
}

export const propose = internalMutation({
  args: proposalArgs,
  handler: (ctx, args): Promise<Id<"agentActions"> | null> => insertProposal(ctx, args),
});

export const get = internalQuery({
  args: { id: v.id("agentActions") },
  handler: (ctx, { id }) => ctx.db.get(id),
});

export const finish = internalMutation({
  args: { id: v.id("agentActions"), ok: v.boolean(), text: v.string() },
  handler: async (ctx, { id, ok, text }) => {
    await ctx.db.patch("agentActions", id, ok ? { status: "done", result: text } : { status: "failed", error: text });
    return null;
  },
});

export const markRunning = internalMutation({
  args: { id: v.id("agentActions") },
  handler: async (ctx, { id }) => {
    const action = await ctx.db.get(id);
    if (!action || action.status !== "approved") return false;
    await ctx.db.patch("agentActions", id, { status: "running" });
    return true;
  },
});

// Runs an approved action. An action, so executors can call outside services (browser automation, calendars).
export const execute = internalAction({
  args: { id: v.id("agentActions") },
  handler: async (ctx, { id }) => {
    const started: boolean = await ctx.runMutation(internal.agent.markRunning, { id });
    if (!started) return null;
    const action: Doc<"agentActions"> | null = await ctx.runQuery(internal.agent.get, { id });
    if (!action) return null;
    let ok = true;
    let text: string;
    try {
      const d = action.details;
      switch (d.kind) {
        case "book_visit": {
          // Finds times and posts them in the chat; the user still picks one and confirms.
          const reply: string = await ctx.runMutation(internal.telehealth.suggestFromChat, { userId: action.userId, reason: d.reason, urgency: d.urgency });
          ok = !reply.startsWith("Tool error:");
          text = ok ? "Video visit times are in the chat. Pick one to book it." : reply.replace(/^Tool error: /, "");
          break;
        }
        case "message_doctor":
          // Sending through a patient portal comes later; for now the approved draft is kept for the user to copy.
          text = "Draft saved. Copy it into your patient portal to send it.";
          break;
        case "set_reminder":
          ok = false;
          text = "Reminders from the agent aren't ready yet.";
          break;
      }
    } catch (e) {
      console.error("agent action failed", id, e);
      ok = false;
      text = "Something went wrong. Nothing was sent.";
    }
    await ctx.runMutation(internal.agent.finish, { id, ok, text });
    return null;
  },
});

// Development: fill a user's inbox with one action of each kind (`npx convex run agent:proposeSamples '{"userId":"..."}'`).
export const proposeSamples = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const base = { userId, status: "proposed" as const, urgent: false };
    await ctx.db.insert("agentActions", {
      ...base,
      title: "Message your doctor about high glucose",
      reason: "Your fasting glucose has been above your target for three mornings since the metformin dose changed.",
      evidence: [
        { label: "Fasting glucose", value: "168 mg/dL", date: "Nov 11" },
        { label: "Fasting glucose", value: "174 mg/dL", date: "Nov 12" },
        { label: "Fasting glucose", value: "181 mg/dL", date: "Nov 13" },
      ],
      details: {
        kind: "message_doctor",
        to: "Primary care doctor",
        subject: "Higher fasting glucose since the dose change",
        body: "Hi, my fasting glucose has been 168 to 181 mg/dL for the last three mornings, since my metformin dose changed on Nov 8. Should I adjust anything before my next visit?",
      },
    });
    await ctx.db.insert("agentActions", {
      ...base,
      title: "Find a video visit this week",
      reason: "Pain has been higher and sleep shorter for two weeks, and you have no visit booked.",
      evidence: [
        { label: "Average pain", value: "6.1 (was 3.8)" },
        { label: "Average sleep", value: "5 h 40 m (was 7 h 10 m)" },
      ],
      details: { kind: "book_visit", reason: "Pain up and sleep down for two weeks", urgency: "soon" },
    });
    await ctx.db.insert("agentActions", {
      ...base,
      title: "Remind you about your inhaler tomorrow",
      reason: "Air quality is forecast to be unhealthy tomorrow afternoon.",
      evidence: [{ label: "Forecast AQI", value: "162", date: "Tomorrow" }],
      details: { kind: "set_reminder", text: "Carry your inhaler today: the air is unhealthy.", at: Date.now() + 18 * 3_600_000 },
    });
    return null;
  },
});
