// Blood pressure, weight, and temperature trackers (convex/lib/trackers.ts, convex/trackers.ts).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { cleanBp, cleanTemperature, cleanWeight, entryLine, trackersText } from "../convex/lib/trackers";
import { outcomes } from "../convex/lib/insights";
import { fmtTemp, tempToC, unitsOf, weightToKg } from "../convex/lib/units";
import { cortexCalls, createAppUser, drain, mockApis, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-02T21:00:00Z"); // 13:00 in Los Angeles
const US = unitsOf(null);
const METRIC = { glucose: "mmol/L", weight: "kg", temperature: "C" } as const;

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

const rows = (t: ReturnType<typeof setup>) => t.run((ctx) => ctx.db.query("trackerEntries").collect());

describe("vitals helpers", () => {
  test("cleaning checks plausible numbers and keeps readings exact", () => {
    expect(cleanBp({ systolic: 128.4, diastolic: 82, pulse: 71.6 })).toEqual({ systolic: 128, diastolic: 82, pulse: 72 });
    expect(cleanBp({ systolic: 80, diastolic: 120 })).toEqual({ error: "The top number (systolic) is the bigger one." });
    expect(cleanBp({ systolic: 120 })).toMatchObject({ error: expect.stringMatching(/both/) });
    expect(cleanBp({ systolic: 120, diastolic: 80, pulse: 900 })).toEqual({ systolic: 120, diastolic: 80, pulse: undefined });
    expect(cleanWeight({ kg: weightToKg(182.4, "lb") })).toEqual({ kg: 82.735 });
    expect(cleanWeight({ kg: 1 })).toMatchObject({ error: expect.any(String) });
    expect(cleanTemperature({ c: tempToC(100.4, "F") })).toEqual({ c: 38 });
    expect(cleanTemperature({ c: 99 })).toMatchObject({ error: expect.any(String) });
  });

  test("lines and summaries in the user's units", () => {
    const at = NOW;
    const bp = { date: "2026-11-01", at, tracker: "bp" as const, bp: { systolic: 142, diastolic: 91, pulse: 80 } };
    const bp2 = { date: "2026-11-02", at, tracker: "bp" as const, bp: { systolic: 120, diastolic: 79 } };
    const w1 = { date: "2026-11-01", at, tracker: "weight" as const, weight: { kg: 82.735 } };
    const w2 = { date: "2026-11-02", at, tracker: "weight" as const, weight: { kg: 81.9 } };
    const temp = { date: "2026-11-02", at, tracker: "temperature" as const, temperature: { c: 38.5 } };
    expect(entryLine(bp)).toBe("blood pressure 142/91 mmHg, pulse 80");
    expect(entryLine(w1)).toBe("weight 182.4 lb");
    expect(entryLine(w1, undefined, METRIC)).toBe("weight 82.7 kg");
    expect(entryLine(temp)).toBe("temperature 101.3 °F (fever)");
    expect(fmtTemp(37, METRIC)).toBe("37 °C");
    const text = trackersText([bp, w1, bp2, w2, temp]);
    expect(text).toContain("Blood pressure: 2 readings, average 131/85 mmHg, highest 142/91.");
    expect(text).toContain("Weight: 2 weigh-ins, from 182.4 lb to 180.6 lb.");
    expect(text).toContain("Temperature: 1 readings, highest 101.3 °F, fever on 1 days.");
  });

  test("a weight logged here counts before the phone's for that day", () => {
    const input = {
      entries: [],
      daily: [],
      weather: [],
      health: [{ date: "2026-11-01", metrics: { weightKg: 80 } }, { date: "2026-11-02", metrics: { weightKg: 80 } }],
      trackers: [{ date: "2026-11-02", at: NOW, tracker: "weight" as const, weight: { kg: 81 } }],
    };
    const weight = outcomes(input, ["2026-11-01", "2026-11-02"]).find((o) => o.key === "weight")!;
    expect([...weight.values]).toEqual([["2026-11-01", 80], ["2026-11-02", 81]]);
  });
});

describe("vitals", () => {
  test("logged, listed newest first, changed, and kept to their own type", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    await as.mutation(api.trackers.add, { tracker: "bp", bp: { systolic: 135, diastolic: 88 } });
    vi.advanceTimersByTime(60_000);
    await as.mutation(api.trackers.add, { tracker: "bp", bp: { systolic: 122, diastolic: 80, pulse: 66 } });
    await as.mutation(api.trackers.add, { tracker: "weight", weight: { kg: 70.5 } });
    await as.mutation(api.trackers.add, { tracker: "temperature", temperature: { c: 37.2 } });
    await expect(as.mutation(api.trackers.add, { tracker: "bp", bp: { systolic: 70, diastolic: 90 } })).rejects.toThrow(/top number/);
    await expect(as.mutation(api.trackers.add, { tracker: "temperature" })).rejects.toThrow(/temperature between/);

    const view = (await as.query(api.trackers.view, { since: "2026-10-01" }))!;
    expect(view.bp.map((b) => b.systolic)).toEqual([122, 135]);
    expect(view.weight[0]).toMatchObject({ kg: 70.5, date: "2026-11-02" });
    expect(view.temperature[0]).toMatchObject({ c: 37.2 });

    await as.mutation(api.trackers.update, { id: view.temperature[0]._id, date: "2026-11-01", at: NOW - 86_400_000, temperature: { c: 38.4 } });
    const changed = (await rows(t)).find((r) => r.tracker === "temperature")!;
    expect(changed).toMatchObject({ date: "2026-11-01", temperature: { c: 38.4 } });
    expect(changed.bp).toBeUndefined();
  });

  test("log_condition_event logs vitals from chat and works out the units", async () => {
    const t = setup();
    const call = (id: string, args: object) => ({ content: null, tool_calls: [{ id, type: "function", function: { name: "log_condition_event", arguments: JSON.stringify(args) } }] });
    mockApis({
      core: [
        call("b", { tracker: "bp", systolic: 142, diastolic: 91, pulse: 77 }),
        { content: "Logged." },
        call("w", { tracker: "weight", weight_value: 80, weight_unit: "kg" }),
        { content: "Logged." },
        call("f", { tracker: "temperature", temperature_value: 101.2 }),
        { content: "Logged." },
      ],
    });
    const { as } = await createAppUser(t);
    for (const text of ["bp 142 over 91, pulse 77", "weighed 80 kg", "I'm at 101.2"]) {
      await as.mutation(api.chat.send, { text });
      await drain(t);
    }
    const byType = Object.fromEntries((await rows(t)).map((r) => [r.tracker, r]));
    expect(byType.bp).toMatchObject({ source: "chat", bp: { systolic: 142, diastolic: 91, pulse: 77 } });
    expect(byType.weight.weight).toEqual({ kg: 80 });
    expect(byType.temperature.temperature!.c).toBeCloseTo(38.44, 2);
  });
});
