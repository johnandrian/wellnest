import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { createAppUser, drain, mockApis, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-13T18:00:00Z");

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

const draft = {
  title: "Message your doctor",
  reason: "Glucose has been high.",
  evidence: [{ label: "Fasting glucose", value: "170 mg/dL" }],
  details: { kind: "message_doctor" as const, to: "Dr. Chen", subject: "High glucose", body: "Hi" },
  urgent: false,
};

describe("agent action inbox", () => {
  test("nothing runs until the user approves, and only their own actions", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await createAppUser(t);
    const other = await createAppUser(t, "b@example.com");
    const id = await t.mutation(internal.agent.propose, { userId, ...draft });
    await drain(t);
    expect(await as.query(api.agent.list, {})).toMatchObject([{ _id: id, status: "proposed" }]);
    expect(await other.as.query(api.agent.list, {})).toEqual([]);
    await expect(other.as.mutation(api.agent.approve, { id: id! })).rejects.toThrow("Action not found");

    await as.mutation(api.agent.approve, { id: id! });
    await drain(t);
    expect(await as.query(api.agent.list, {})).toMatchObject([{ status: "done", result: expect.stringContaining("Draft saved") }]);
    await expect(as.mutation(api.agent.approve, { id: id! })).rejects.toThrow("already handled");
  });

  test("dismissed actions never run, and unbuilt kinds fail honestly", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await createAppUser(t);
    const a = await t.mutation(internal.agent.propose, { userId, ...draft });
    const b = await t.mutation(internal.agent.propose, {
      userId,
      ...draft,
      details: { kind: "set_reminder", text: "Inhaler", at: NOW + 3_600_000 },
    });
    await as.mutation(api.agent.dismiss, { id: a! });
    await as.mutation(api.agent.approve, { id: b! });
    await drain(t);
    const rows = await as.query(api.agent.list, {});
    expect(rows.find((r) => r._id === a)).toMatchObject({ status: "dismissed" });
    expect(rows.find((r) => r._id === b)).toMatchObject({ status: "failed", error: expect.stringContaining("aren't ready") });
  });

  test("stops proposing past the open limit", async () => {
    const t = setup();
    const { userId } = await createAppUser(t);
    for (let i = 0; i < 20; i++) expect(await t.mutation(internal.agent.propose, { userId, ...draft })).not.toBeNull();
    expect(await t.mutation(internal.agent.propose, { userId, ...draft })).toBeNull();
  });
});
