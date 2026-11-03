import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
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

const texts = (msgs: { role: string; text: string }[]) => msgs.filter((m) => m.role === "user").map((m) => m.text);

describe("chat history", () => {
  test("a new chat starts empty, the old one is listed by its first message, and either can be continued", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await createAppUser(t);
    expect(await as.query(api.chats.list)).toEqual([]);
    await as.mutation(api.chats.start, {}); // nothing to keep yet
    expect(await as.query(api.chats.list)).toEqual([]);

    await as.mutation(api.chat.send, { text: "My   knee hurts\nafter running" });
    await drain(t);
    expect(await as.query(api.chats.list)).toMatchObject([{ _id: null, title: "My knee hurts after running", current: true }]);

    await as.mutation(api.chats.start, {});
    await as.mutation(api.chats.start, {}); // still empty: no second new chat
    expect(await as.query(api.chat.list)).toEqual([]);
    vi.advanceTimersByTime(60_000);
    await as.mutation(api.chat.send, { text: "Sleep tips?" });
    await drain(t);
    expect(texts(await as.query(api.chat.list))).toEqual(["Sleep tips?"]);

    const list = await as.query(api.chats.list);
    expect(list.map((c) => [c.title, c.current])).toEqual([
      ["Sleep tips?", true],
      ["My knee hurts after running", false],
    ]);

    // Back to the first chat: the model only sees that chat, and the reply lands there.
    await as.mutation(api.chats.open, { chatId: list[1]._id! });
    expect(texts(await as.query(api.chat.list))).toEqual(["My   knee hurts\nafter running"]);
    const { calls } = mockApis();
    await as.mutation(api.chat.send, { text: "It's better now" });
    await drain(t);
    const sent = JSON.stringify(cortexCalls(calls)[0].body.messages);
    expect(sent).toContain("knee hurts");
    expect(sent).not.toContain("Sleep tips");
    expect(texts(await as.query(api.chat.list))).toEqual(["My   knee hurts\nafter running", "It's better now"]);
    expect((await as.query(api.chats.list))[0]).toMatchObject({ title: "My knee hurts after running", current: true });
    expect((await messagesOf(t, userId)).length).toBe(6);
  });

  test("reminders go into the current chat; an empty new chat isn't kept when you leave it", async () => {
    const t = setup();
    mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "hi" });
    await drain(t);
    await as.mutation(api.chats.start, {});
    const [, first] = await as.query(api.chats.list);
    await as.mutation(api.chats.open, { chatId: first._id! });
    expect(await as.query(api.chats.list)).toHaveLength(1);
  });

  test("deleting a chat removes its messages and moves to another; other users can't touch it", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await createAppUser(t);
    const other = await createAppUser(t, "other@example.com");
    await as.mutation(api.chat.send, { text: "first" });
    await drain(t);
    await as.mutation(api.chats.start, {});
    await as.mutation(api.chat.send, { text: "second" });
    await drain(t);
    const [current, old] = await as.query(api.chats.list);
    await expect(other.as.mutation(api.chats.remove, { chatId: current._id! })).rejects.toThrow(/Chat not found/);
    await expect(other.as.mutation(api.chats.open, { chatId: current._id! })).rejects.toThrow(/Chat not found/);

    await as.mutation(api.chats.remove, { chatId: current._id! });
    await drain(t);
    expect(await as.query(api.chats.list)).toMatchObject([{ _id: old._id, current: true }]);
    expect(texts(await messagesOf(t, userId))).toEqual(["first"]);

    // Deleting the last chat leaves a new empty one.
    await as.mutation(api.chats.remove, { chatId: old._id! });
    await drain(t);
    expect(await messagesOf(t, userId)).toEqual([]);
    expect(await as.query(api.chat.list)).toEqual([]);
    expect(await as.query(api.chats.list)).toMatchObject([{ title: "", current: true }]);
  });
});

describe("health tools home", () => {
  test("charts follow the setup focus first, then whatever has data, with this week against last", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    expect(await t.query(api.dashboard.view, { today: "2026-11-02", now: Date.now() })).toBeNull();
    await as.mutation(api.onboarding.setFocus, { focus: ["mood"] });
    for (let i = 0; i < 14; i++) {
      const date = new Date(Date.parse("2026-11-02") - i * 86_400_000).toISOString().slice(0, 10);
      await as.mutation(api.journal.add, { symptom: "headache", severity: i < 7 ? 3 : 7, date });
      if (i < 3) await as.mutation(api.daily.log, { mood: 4, date });
    }
    const view = (await as.query(api.dashboard.view, { today: "2026-11-02", now: Date.now() }))!;
    expect(view.charts.map((c) => c.metric)).toEqual(["mood", "symptom"]);
    expect(view.charts[1]).toMatchObject({ title: "Headache", week: 3, prevWeek: 7, worse: "high", latest: { date: "2026-11-02", value: 3 } });
    expect(view.charts[0]).toMatchObject({ week: 4, prevWeek: null });
    expect(view).toMatchObject({ logged: 7, meds: { count: 0, next: null }, visit: null });
  });
});
