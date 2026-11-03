// "Scan a label": the vision model reads a photo of a medication label (bottle, box, inhaler) into the add form's
// fields. The photo is the user's own upload (convex/chat.ts claimUpload) and is deleted once it has been read;
// nothing is saved until the user checks the form and taps Save.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { complete, imageDataUrl, VISION_MODEL } from "./lib/cortex";
import { LABEL_PROMPT, LabelScan, parseLabelScan } from "./lib/drugs";

// The upload, if it's this user's, an image, and not already sent in chat or kept for something else.
export const freshUpload = internalQuery({
  args: { userId: v.id("users"), storageId: v.id("_storage") },
  handler: async (ctx, { userId, storageId }) => {
    const upload = await ctx.db.query("photoUploads").withIndex("by_storage", (q) => q.eq("storageId", storageId)).unique();
    const file = await ctx.db.system.get("_storage", storageId);
    return !!upload && upload.userId === userId && !upload.messageId && !upload.usedFor && !!file?.contentType?.startsWith("image/");
  },
});

export const discard = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const upload = await ctx.db.query("photoUploads").withIndex("by_storage", (q) => q.eq("storageId", storageId)).unique();
    if (upload) await ctx.db.delete(upload._id);
    await ctx.storage.delete(storageId).catch(() => {});
  },
});

export const read = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<LabelScan | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    if (!(await ctx.runQuery(internal.medScan.freshUpload, { userId, storageId }))) throw new Error("That photo didn't upload. Please try again.");
    try {
      const blob = await ctx.storage.get(storageId);
      if (!blob) return null;
      const reply = await complete({
        model: VISION_MODEL(),
        messages: [{ role: "user", content: [{ type: "text", text: LABEL_PROMPT }, { type: "image_url", image_url: { url: await imageDataUrl(blob) } }] }],
        maxTokens: 400,
      });
      return parseLabelScan(reply.content ?? "");
    } finally {
      await ctx.runMutation(internal.medScan.discard, { storageId });
    }
  },
});
