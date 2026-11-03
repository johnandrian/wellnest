"use node";
// A PDF record's text (convex/records.ts), with unpdf. A scanned PDF has no text layer, so this comes back empty
// and the app asks for a photo instead.
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { extractText, getDocumentProxy } from "unpdf";

export const text = internalAction({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<string> => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) return "";
    const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  },
});
