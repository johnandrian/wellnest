import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { emergencyText } from "../convex/emergency";
import { cortexCalls, createAppUser, drain, mockApis, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-02T21:00:00Z");
const SITE = "https://happy-otter-123.convex.site";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setEnv();
  vi.stubEnv("CONVEX_SITE_URL", SITE);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const PLAN = {
  sections: [
    { title: "During a seizure", steps: ["Time it", "  ", "Roll me on my side"] },
    { title: "", steps: [] },
  ],
  contacts: [
    { name: "Maria", relation: "sister", phone: "+1 555 0101" },
    { name: "No number", phone: "n/a" },
  ],
  asthma: { reliever: "Salbutamol 2 puffs", red: "Can't speak in sentences: call 911", best: 480 },
  notes: "Rescue meds in my bag",
};

describe("emergency plans", () => {
  test("save cleans the plan; get returns it to its owner only; saving again replaces it", async () => {
    const t = setup();
    await expect(t.mutation(api.emergency.save, PLAN)).rejects.toThrow(/Not signed in/);
    const { as } = await createAppUser(t);
    const other = await createAppUser(t, "b@example.com");
    expect(await as.query(api.emergency.get)).toEqual({ exists: false });
    await as.mutation(api.emergency.save, PLAN);
    const plan = (await as.query(api.emergency.get))!;
    expect(plan).toMatchObject({
      exists: true,
      sections: [{ title: "During a seizure", steps: ["Time it", "Roll me on my side"] }],
      contacts: [{ name: "Maria", relation: "sister", phone: "+1 555 0101" }],
      asthma: { reliever: "Salbutamol 2 puffs", best: 480 },
      notes: "Rescue meds in my bag",
    });
    expect(await other.as.query(api.emergency.get)).toEqual({ exists: false });
    await as.mutation(api.emergency.save, { sections: [], contacts: [] });
    expect(await t.run((ctx) => ctx.db.query("emergencyPlans").collect())).toHaveLength(1);
    await as.mutation(api.emergency.remove, {});
    expect(await as.query(api.emergency.get)).toEqual({ exists: false });
  });

  test("a carers' share link shows the plan with call links", async () => {
    const t = setup();
    mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.emergency.save, PLAN);
    const { url } = await as.mutation(api.share.create, { label: "Emergency plan", sections: ["emergency"], rangeDays: 1, expiresInDays: null });
    const html = await (await t.fetch(url.replace(SITE, ""))).text();
    expect(html).toContain("<h2>Emergency plan</h2><h3>During a seizure</h3><ol><li>Time it</li><li>Roll me on my side</li></ol>");
    expect(html).toContain('<a href="tel:+15550101">+1 555 0101</a>');
    expect(html).toContain(`<th class="red">Emergency</th><td>Can't speak in sentences: call 911</td>`);
  });

  test("urgent messages give the model the user's plan; others don't", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: (body: any) => ({ urgent: JSON.stringify(body).includes("seizure") ? 0.95 : 0.05 }), core: [{ content: "Call 911." }, { content: "ok" }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.emergency.save, PLAN);
    await as.mutation(api.chat.send, { text: "my brother is having a seizure right now" });
    await drain(t);
    expect(cortexCalls(calls)[0].body.messages[0].content).toContain("The user's own emergency plan (written with their doctors; point them to the relevant steps):\nDuring a seizure:\n1. Time it");
    await as.mutation(api.chat.send, { text: "what's a good breakfast" });
    await drain(t);
    expect(cortexCalls(calls).at(-1)!.body.messages[0].content).not.toContain("emergency plan");
  });

  test("text for the model", () => {
    expect(emergencyText({ sections: [{ title: "Flare", steps: ["Rest"] }], contacts: [{ name: "Jo", phone: "123" }], asthma: { red: "Call 911" } })).toBe(
      "Flare:\n1. Rest\nAsthma action plan, emergency: Call 911\nEmergency contacts: Jo 123",
    );
  });
});
