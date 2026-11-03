import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { drugKey, findInteractions, parseLabelScan } from "../convex/lib/drugs";
import { cortexCalls, createAppUser, FakeDrug, messagesOf, mockApis, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-02T18:00:00Z");
const H = 3_600_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const DRUGS: Record<string, FakeDrug> = {
  warfarin: {
    ingredient: "warfarin",
    brands: ["Jantoven"],
    classes: ["Vitamin K Antagonist [EPC]"],
    label: "Drug interactions. Concomitant use of NSAIDs and aspirin with warfarin may increase the risk of bleeding. Monitor INR closely.",
    boxed: "WARNING: BLEEDING RISK. Warfarin can cause major or fatal bleeding.",
  },
  ibuprofen: {
    ingredient: "ibuprofen",
    brands: ["Advil", "Motrin"],
    classes: ["Nonsteroidal Anti-inflammatory Drug [EPC]"],
    label: "Ask a doctor or pharmacist before use if you are taking a prescription drug for anticoagulation (thinning the blood).",
  },
  advil: { ingredient: "ibuprofen", brands: ["Advil"], classes: ["Nonsteroidal Anti-inflammatory Drug [EPC]"], label: "Ask a doctor before use." },
  albuterol: { ingredient: "albuterol", brands: ["Ventolin"], classes: ["beta2-Adrenergic Agonist [EPC]"], label: "Do not use with other inhalers unless told." },
};

const settle = (t: ReturnType<typeof setup>) => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
const daily = { kind: "daily" as const, times: ["08:00"] };
const info = (key: string) => ({ key, ingredients: [DRUGS[key].ingredient], brands: (DRUGS[key].brands ?? []).map((b) => b.toLowerCase()), classes: DRUGS[key].classes ?? [], interactions: DRUGS[key].label });

describe("finding interactions on labels", () => {
  test("a medication name becomes its lookup key without strength or form", () => {
    expect(drugKey("Ibuprofen 200 mg tablets")).toBe("ibuprofen");
    expect(drugKey("Metformin ER 500mg")).toBe("metformin");
    expect(drugKey("Ventolin (albuterol) inhaler")).toBe("ventolin");
  });

  test("a label naming the other drug's class counts, once per pair; a brand and its generic don't", () => {
    const found = findInteractions([
      { name: "Warfarin", info: info("warfarin") },
      { name: "Ibuprofen", info: info("ibuprofen") },
      { name: "Advil", info: info("advil") },
      { name: "Albuterol", info: info("albuterol") },
      { name: "Mystery pill", info: null },
    ]);
    expect(found.map((i) => [i.a, i.b, i.term])).toEqual([
      ["Warfarin", "Ibuprofen", "nsaid"],
      ["Warfarin", "Advil", "nsaid"],
    ]);
    expect(found[0].excerpt).toBe("Concomitant use of NSAIDs and aspirin with warfarin may increase the risk of bleeding.");
  });

  test("a label photo's reply is read into form fields; anything odd is dropped", () => {
    expect(parseLabelScan('```json\n{"name":"Advil","genericName":"ibuprofen","dose":"200 mg","form":"Tablet","timesPerDay":"3","everyHours":500}\n```')).toEqual({
      name: "Advil",
      genericName: "ibuprofen",
      dose: "200 mg",
      form: "tablet",
      timesPerDay: 3,
      everyHours: undefined,
      prescriber: undefined,
      instructions: undefined,
    });
    expect(parseLabelScan('{"error":"no label"}')).toBeNull();
    expect(parseLabelScan("I can't see a label")).toBeNull();
  });
});

describe("medication safety", () => {
  test("adding a second medication looks both up, says the interaction in chat once, and tells the model", async () => {
    const t = setup();
    const { calls } = mockApis({ drugs: DRUGS });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.reminders.add, { name: "Warfarin 5 mg", schedule: daily });
    await settle(t);
    expect((await as.query(api.drugs.view))?.interactions).toEqual([]);

    await as.mutation(api.reminders.add, { name: "Ibuprofen", schedule: daily });
    await settle(t);
    const view = (await as.query(api.drugs.view))!;
    expect(view.interactions.map((i) => [i.a, i.b])).toEqual([["Warfarin 5 mg", "Ibuprofen"]]);
    expect(view.boxed).toEqual([{ name: "Warfarin 5 mg", text: "WARNING: BLEEDING RISK. Warfarin can cause major or fatal bleeding." }]);
    expect(view).toMatchObject({ checked: 2, total: 2, pending: false, unknown: [] });

    const alerts = (await messagesOf(t, userId)).filter((m) => m.text.includes("Possible interaction"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].text).toContain("the FDA label for Warfarin 5 mg mentions nsaid, and you also take Ibuprofen");

    // Opening the tab again doesn't look them up again or repeat the message.
    const lookups = calls.filter((c) => c.url.includes("api.fda.gov")).length;
    await as.mutation(api.drugs.ensure, {});
    await settle(t);
    expect(calls.filter((c) => c.url.includes("api.fda.gov")).length).toBe(lookups);
    expect((await messagesOf(t, userId)).filter((m) => m.text.includes("Possible interaction"))).toHaveLength(1);

    const context = await t.query(internal.reminders.activeText, { userId, now: Date.now() });
    expect(context).toContain('- Warfarin 5 mg label mentions nsaid (Ibuprofen): "Concomitant use of NSAIDs');
  });

  test("a name neither service knows is listed as not found; the alert is in the user's language", async () => {
    const t = setup();
    mockApis({ drugs: DRUGS });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.setLanguage, { language: "es" });
    await as.mutation(api.reminders.add, { name: "Ibuprofen", schedule: daily });
    await as.mutation(api.reminders.add, { name: "Warfarin", schedule: daily });
    await as.mutation(api.reminders.add, { name: "Grandma's tonic", schedule: daily });
    await settle(t);
    expect((await as.query(api.drugs.view))?.unknown).toEqual(["Grandma's tonic"]);
    expect((await messagesOf(t, userId)).filter((m) => m.text.includes("Posible interacción"))).toHaveLength(1);
  });

  test("scanning a label fills the form from the photo and deletes it; someone else's photo is refused", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: '{"name":"Advil","genericName":"ibuprofen","dose":"200 mg","form":"tablet","timesPerDay":2,"instructions":"Take 1 tablet twice a day"}' }] });
    const { as } = await createAppUser(t);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" })));
    const other = await createAppUser(t, "b@example.com");
    await as.mutation(api.chat.claimUpload, { storageId });
    await expect(other.as.action(api.medScan.read, { storageId })).rejects.toThrow(/didn't upload/);

    expect(await as.action(api.medScan.read, { storageId })).toMatchObject({ name: "Advil", genericName: "ibuprofen", dose: "200 mg", form: "tablet", timesPerDay: 2 });
    const [call] = cortexCalls(calls);
    expect(call.body.messages[0].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("photoUploads").collect())).toEqual([]);
  });
});

describe("missed doses", () => {
  test("three unanswered or skipped doses in a week bring one kind nudge, not again for a week", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.reminders.add, { name: "Metformin", schedule: { kind: "interval", everyHours: 12, firstAt: NOW + 12 * H } });
    const nudges = async () => (await messagesOf(t, userId)).filter((m) => m.text.includes("You've missed"));
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(12 * H);
      await settle(t);
    }
    // Doses 1 to 3 went unanswered; the 4th reminder notices.
    expect((await nudges()).map((m) => m.text)).toEqual([expect.stringContaining("You've missed 3 doses of **Metformin** this week")]);
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(12 * H);
      await settle(t);
    }
    expect(await nudges()).toHaveLength(1);
  });

  test("doses answered Taken don't count", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.reminders.add, { name: "Metformin", schedule: { kind: "interval", everyHours: 12, firstAt: NOW + 12 * H } });
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(12 * H);
      await settle(t);
      const latest = (await messagesOf(t, userId)).filter((m) => m.kind === "reminder").at(-1)!;
      await as.mutation(api.reminders.log, { messageId: latest._id, status: "taken" });
    }
    expect((await messagesOf(t, userId)).filter((m) => m.text.includes("You've missed"))).toEqual([]);
  });
});
