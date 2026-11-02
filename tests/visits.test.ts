import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { cortexCalls, createAppUser, mockApis, pushSends, setEnv, setup } from "./helpers";

// Monday 2026-11-02, 10:00 in Los Angeles.
const NOW = Date.parse("2026-11-02T18:00:00Z");
const H = 3_600_000;
const TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";

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

const settle = (t: ReturnType<typeof setup>) => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
const advance = async (t: ReturnType<typeof setup>, ms: number) => {
  vi.advanceTimersByTime(ms);
  await settle(t);
};

async function user(t: ReturnType<typeof setup>) {
  const u = await createAppUser(t);
  await u.as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
  await u.as.mutation(api.push.register, { token: TOKEN, platform: "ios" });
  return u;
}

describe("care team", () => {
  test("add, edit, list and remove; only the owner", async () => {
    const t = setup();
    const { as } = await user(t);
    const other = await createAppUser(t, "b@example.com");
    const id = (await as.mutation(api.visits.addTeamMember, { name: " Dr. Lee ", role: "Rheumatologist", phone: "+1 555 0100" })) as Id<"careTeam">;
    await as.mutation(api.visits.updateTeamMember, { id, name: "Dr. Amy Lee", role: "Rheumatologist", clinic: "Bay Clinic" });
    expect(await as.query(api.visits.team)).toMatchObject([{ name: "Dr. Amy Lee", clinic: "Bay Clinic" }]);
    expect(await other.as.query(api.visits.team)).toEqual([]);
    await expect(other.as.mutation(api.visits.removeTeamMember, { id })).rejects.toThrow(/Not found/);
    await expect(as.mutation(api.visits.addTeamMember, { name: " " })).rejects.toThrow(/name/);
    await as.mutation(api.visits.removeTeamMember, { id });
    expect(await as.query(api.visits.team)).toEqual([]);
  });
});

describe("appointments", () => {
  test("a reminder pushes 2 hours before; moving the time moves the reminder; done or cancelled sends none", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await user(t);
    const lee = (await as.mutation(api.visits.addTeamMember, { name: "Dr. Lee", phone: "+15550100" })) as Id<"careTeam">;
    const id = (await as.mutation(api.visits.add, { title: "Rheumatology", startsAt: NOW + 5 * H, clinicianId: lee, location: "Bay Clinic", prep: "Ask about methotrexate" })) as Id<"visits">;
    await as.mutation(api.visits.update, { id, startsAt: NOW + 6 * H });
    await advance(t, 3 * H); // the old reminder time: nothing
    expect(pushSends(calls)).toHaveLength(0);
    await advance(t, 1 * H);
    expect(pushSends(calls)).toMatchObject([{ title: "Appointment soon: Rheumatology", body: "At 4:00 PM · Dr. Lee · Bay Clinic. Your questions are in the Visits tab.", channelId: "appointments" }]);

    const list = (await as.query(api.visits.list, { now: Date.now() }))!;
    expect(list.upcoming).toMatchObject([{ title: "Rheumatology", clinician: "Dr. Lee", phone: "+15550100", prep: "Ask about methotrexate", status: "upcoming" }]);

    const second = (await as.mutation(api.visits.add, { title: "Physio", startsAt: Date.now() + 4 * H })) as Id<"visits">;
    await as.mutation(api.visits.setStatus, { id: second, status: "cancelled" });
    await advance(t, 3 * H);
    expect(pushSends(calls)).toHaveLength(1);
    await as.mutation(api.visits.update, { id, notes: "Start methotrexate 10 mg weekly" });
    await as.mutation(api.visits.setStatus, { id, status: "done" });
    const after = (await as.query(api.visits.list, { now: Date.now() }))!;
    expect(after.past.map((p) => [p.title, p.status])).toEqual([
      ["Physio", "cancelled"],
      ["Rheumatology", "done"],
    ]);
  });

  test("others can't see or change them", async () => {
    const t = setup();
    mockApis();
    const { as } = await user(t);
    const other = await createAppUser(t, "b@example.com");
    const id = (await as.mutation(api.visits.add, { title: "GP", startsAt: NOW + 24 * H })) as Id<"visits">;
    expect((await other.as.query(api.visits.list, { now: NOW }))!.upcoming).toEqual([]);
    await expect(other.as.mutation(api.visits.remove, { id })).rejects.toThrow(/Not found/);
    const theirs = (await other.as.mutation(api.visits.addTeamMember, { name: "X" })) as Id<"careTeam">;
    await expect(as.mutation(api.visits.add, { title: "GP", startsAt: NOW, clinicianId: theirs })).rejects.toThrow(/Not found/);
  });

  test("booked telehealth visits show in the list", async () => {
    const t = setup();
    mockApis();
    const { as } = await user(t);
    const id = (await as.mutation(api.telehealth.request, { reason: "UTI symptoms", urgency: "today" })) as Id<"appointments">;
    await settle(t);
    const slot = (await t.run((ctx) => ctx.db.get(id)))!.slots[0];
    await as.mutation(api.telehealth.confirm, { id, slotId: slot.id });
    await settle(t);
    expect((await as.query(api.visits.list, { now: Date.now() }))!.upcoming).toMatchObject([
      { source: "telehealth", title: "UTI symptoms", kind: "video", clinician: "Dr. Rivera (test)", joinUrl: expect.stringContaining("https://") },
    ]);
  });
});

describe("appointments in chat", () => {
  const call = (id: string, name: string, args: object) => ({ content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  const result = (calls: any[], id: string) => cortexCalls(calls).flatMap((c) => c.body.messages).find((m: any) => m.tool_call_id === id)?.content;

  test("add_appointment uses the user's local time and adds the clinician to the care team; the model sees both", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [call("a1", "add_appointment", { title: "Rheumatology", date: "2026-11-05", time: "14:00", clinician: "Dr. Lee" }), { content: "Added." }, { content: "ok" }],
    });
    const { as } = await user(t);
    await as.mutation(api.chat.send, { text: "I have the rheumatologist Thursday at 2 with Dr. Lee" });
    await settle(t);
    expect(cortexCalls(calls)[0].body.messages[0].content).toContain("Today is 2026-11-02 (the user's local date).");
    expect(result(calls, "a1")).toBe('Added "Rheumatology" on 2026-11-05 at 14:00 to the user\'s appointments, with a reminder 2 hours before. They can add questions to ask, and notes afterwards, in the Visits tab.');
    const [visit] = (await as.query(api.visits.list, { now: NOW }))!.upcoming;
    expect(new Date(visit.startsAt).toISOString()).toBe("2026-11-05T22:00:00.000Z");
    expect(visit.clinician).toBe("Dr. Lee");
    await as.mutation(api.chat.send, { text: "when is it again?" });
    await settle(t);
    const system = cortexCalls(calls).at(-1)!.body.messages[0].content;
    expect(system).toContain("The user's upcoming appointments:\n- 2026-11-05, 14:00 Rheumatology with Dr. Lee");
    expect(system).toContain("The user's care team:\n- Dr. Lee");
  });

  test("bad dates are refused", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [call("a1", "add_appointment", { title: "GP", date: "Thursday", time: "2pm" }), { content: "?" }] });
    const { as } = await user(t);
    await as.mutation(api.chat.send, { text: "GP thursday 2pm" });
    await settle(t);
    expect(result(calls, "a1")).toMatch(/YYYY-MM-DD/);
  });

  test("visit summaries include appointment questions and notes", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "# Visit summary" }] });
    const { as } = await user(t);
    await as.mutation(api.visits.add, { title: "Neurology", startsAt: NOW + 48 * H, prep: "Ask about the new aura" });
    await as.mutation(api.visit.create, {});
    await settle(t);
    expect(cortexCalls(calls).at(-1)!.body.messages[1].content).toContain("Appointments, with the patient's questions and notes:\n- 2026-11-04, 10:00 Neurology\n  To ask: Ask about the new aura");
  });
});
