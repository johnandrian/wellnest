import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { aboutUserText, welcomeText } from "../convex/lib/onboarding";
import { cortexCalls, createAppUser, drain, messagesOf, mockApis, setEnv, setup } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-02T18:00:00Z"));
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("account setup", () => {
  test("a new account isn't set up; what it already has is prefilled", async () => {
    const t = setup();
    const { userId, as } = await createAppUser(t);
    expect(await t.query(api.onboarding.state)).toBeNull();
    expect((await as.query(api.chat.me))!).toMatchObject({ onboarded: false, name: null, focus: [] });
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { location: "Berkeley, CA" });
      await ctx.db.insert("memoryFacts", { userId, text: "Allergy: penicillin", source: "user" });
    });
    expect(await as.query(api.onboarding.state)).toMatchObject({ done: false, location: "Berkeley, CA", facts: ["Allergy: penicillin"], contacts: [], checkins: true, weeklySummary: true });
  });

  test("profile and focus are saved, cleared with null, and need a signed-in user", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    await expect(t.mutation(api.onboarding.setFocus, { focus: ["pain"] })).rejects.toThrow(/Not signed in/);
    await as.mutation(api.onboarding.saveProfile, { name: "  Maria   Lopez ", ageRange: "30_44", sex: "female" });
    await as.mutation(api.onboarding.setFocus, { focus: ["pain", "asthma", "pain"] });
    expect(await as.query(api.onboarding.state)).toMatchObject({ name: "Maria Lopez", ageRange: "30_44", sex: "female", focus: ["pain", "asthma"] });
    await as.mutation(api.onboarding.saveProfile, { sex: null });
    expect(await as.query(api.onboarding.state)).toMatchObject({ name: "Maria Lopez", sex: null });
    await expect(as.mutation(api.onboarding.setFocus, { focus: ["skydiving" as "pain"] })).rejects.toThrow();
  });

  test("conditions and allergies become facts in the user's language, without repeats", async () => {
    const t = setup();
    const { userId, as } = await createAppUser(t);
    await t.run((ctx) => ctx.db.patch(userId, { language: "es" }));
    await as.mutation(api.onboarding.addFacts, { conditions: ["Asma", " "], allergies: ["Penicilina"] });
    await as.mutation(api.onboarding.addFacts, { conditions: ["asma"], allergies: [] });
    expect((await as.query(api.onboarding.state))!.facts).toEqual(["Afección: Asma", "Alergia: Penicilina"]);
  });

  test("emergency contacts are the emergency plan's contacts, in order, made if needed", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    expect((await as.query(api.onboarding.state))!.contacts).toEqual([]);
    await expect(as.mutation(api.onboarding.setContacts, { contacts: [{ name: "Jo", phone: "call me" }] })).rejects.toThrow(/phone number for Jo/);
    await expect(as.mutation(api.onboarding.setContacts, { contacts: [{ name: " ", phone: "555 0101" }] })).rejects.toThrow(/name/);
    await as.mutation(api.onboarding.setContacts, {
      contacts: [
        { name: " Jo ", phone: "+1 555 0101", relation: "sister" },
        { name: "", phone: " ", relation: " " },
        { name: "Sam", phone: "555 0202" },
      ],
    });
    expect((await as.query(api.onboarding.state))!.contacts).toEqual([
      { name: "Jo", phone: "+1 555 0101", relation: "sister" },
      { name: "Sam", phone: "555 0202" },
    ]);

    // The plan's own steps are kept; the contact list is replaced by what setup shows.
    await as.mutation(api.emergency.save, { sections: [{ title: "Seizure", steps: ["Time it"] }], contacts: [{ name: "Jo", phone: "+1 555 0101" }, { name: "Sam", phone: "555 0202" }] });
    await as.mutation(api.onboarding.setContacts, { contacts: [{ name: "Sam", phone: "555 0202", relation: "partner" }, { name: "Ana", phone: "555 0303" }] });
    expect(await as.query(api.emergency.get)).toMatchObject({ exists: true, sections: [{ title: "Seizure" }], contacts: [{ name: "Sam", relation: "partner" }, { name: "Ana" }] });

    const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `P${i}`, phone: `555 01${i}` }));
    await expect(as.mutation(api.onboarding.setContacts, { contacts: eleven })).rejects.toThrow(/up to 10/);
  });

  test("finishing marks the account set up and welcomes them once, by name, with tips for their focus", async () => {
    const t = setup();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.onboarding.saveProfile, { name: "Maria" });
    await as.mutation(api.onboarding.setFocus, { focus: ["asthma"] });
    await as.mutation(api.onboarding.finish, {});
    await as.mutation(api.onboarding.finish, {}); // "Redo setup" later: no second welcome
    expect((await as.query(api.chat.me))!.onboarded).toBe(true);
    const welcome = (await messagesOf(t, userId)).filter((m) => m.role === "assistant");
    expect(welcome).toHaveLength(1);
    expect(welcome[0].text).toBe(welcomeText("en", "Maria", ["asthma"]));
    expect(welcome[0].text).toContain("Welcome, Maria! You're all set.\n\n• Log peak flow and reliever puffs");
    expect(welcomeText("zh", "小明", ["medications"])).toBe(
      "👋 欢迎，小明！一切都设置好了。\n\n• 你的提醒带有“已服用 / 跳过”按钮；有任何副作用随时告诉我。\n\n你可以随时在设置中修改这些内容。你今天感觉怎么样？",
    );
  });

  test("the model is told who the user is and what they use Wellnest for", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.onboarding.saveProfile, { name: "Maria", ageRange: "45_64", sex: "unspecified" });
    await as.mutation(api.onboarding.setFocus, { focus: ["pain", "caregiver"] });
    await as.mutation(api.chat.send, { text: "hi" });
    await drain(t);
    expect(cortexCalls(calls)[0].body.messages[0].content).toContain(
      "About the user (from their account setup):\nTheir name is Maria; use it now and then, not in every reply. Age range: 45-64. " +
        "They use Wellnest mainly for: chronic pain / CRPS, caring for someone else. They may be asking about someone they care for",
    );
    expect(aboutUserText(undefined, [])).toBe("");
  });
});
