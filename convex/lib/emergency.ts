// Emergency plan validators, shared by the schema and convex/emergency.ts.
import { v } from "convex/values";

export const planSection = v.object({ title: v.string(), steps: v.array(v.string()) });
export const contact = v.object({ name: v.string(), relation: v.optional(v.string()), phone: v.string() });
export const asthmaPlan = v.object({
  preventer: v.optional(v.string()),
  reliever: v.optional(v.string()),
  green: v.optional(v.string()), // when well
  yellow: v.optional(v.string()), // when symptoms get worse
  red: v.optional(v.string()), // emergency
  best: v.optional(v.number()), // peak flow best, L/min
});
