import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { dateRange, esc, svgBars } from "../convex/lib/report";
import { createAppUser, mockApis, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-02T21:00:00Z");
const ALL = ["facts", "medications", "journal", "trackers", "exercises", "health", "appointments"] as const;

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

async function seeded(t: ReturnType<typeof setup>) {
  mockApis();
  const u = await createAppUser(t);
  const { as, userId } = u;
  await as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
  await as.mutation(api.me.addFact, { text: "Allergic to <penicillin>" });
  const med = (await as.mutation(api.reminders.add, { name: "Sertraline", dose: "50 mg", genericName: "sertraline", schedule: { kind: "daily", times: ["08:00"] } })) as Id<"medications">;
  await as.mutation(api.medications.addSideEffect, { id: med, effect: "nausea", severity: 3 });
  await as.mutation(api.journal.add, { symptom: "headache", severity: 7 });
  await as.mutation(api.daily.log, { mood: 2 });
  await as.mutation(api.trackers.add, { tracker: "asthma", asthma: { peakFlow: 320, reliever: 2, symptoms: ["wheeze"] } });
  await as.mutation(api.exercises.add, { name: "Bridges", sets: 3, reps: 10 });
  await as.mutation(api.health.sync, { days: [{ date: "2026-11-01", metrics: { sleepHours: 5.5, restingHeartRate: 62 } }] });
  await as.mutation(api.visits.addTeamMember, { name: "Dr. Lee", role: "GP", phone: "+15550100" });
  await as.mutation(api.visits.add, { title: "GP review", startsAt: NOW + 3 * 86_400_000, prep: "Ask about sleep" });
  await t.run((ctx) => ctx.db.patch(userId, { name: "Sam Rivera" }));
  return u;
}

describe("report helpers", () => {
  test("escaping, date ranges and charts", () => {
    expect(esc(`<b>"x" & y</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;");
    expect(dateRange("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    const svg = svgBars(["2026-11-01", "2026-11-02"], new Map([["2026-11-02", 5]]), 10, () => "#000", "Pain <x>");
    expect(svg).toContain('<rect x="320.5" y="37.0" width="319.0" height="33.0" fill="#000"/>');
    expect(svg).toContain("Pain &lt;x&gt;");
  });
});

describe("reports", () => {
  test("every section, with charts, escaped user text and the disclaimer", async () => {
    const t = setup();
    const { as } = await seeded(t);
    const html = await as.query(api.reports.html, { from: "2026-10-01", to: "2026-11-02", sections: [...ALL], generated: "Nov 2, 2026" });
    expect(html).toContain("<title>Health report</title>");
    expect(html).toContain("Sam Rivera · Period: 2026-10-01 – 2026-11-02 · Generated: Nov 2, 2026");
    expect(html).toContain("<li>Allergic to &lt;penicillin&gt;</li>");
    expect(html).not.toContain("<penicillin>");
    expect(html).toContain("<b>Sertraline</b><br><span class=\"muted\">sertraline</span>");
    expect(html).toContain("<b>Side effects:</b> 2026-11-02 nausea (3/10)");
    expect(html).toContain('aria-label="Headache (0-10)"');
    expect(html).toContain('aria-label="Mood (1-5)"');
    expect(html).toContain("2026-11-02: peak flow 320 L/min; 2 reliever puffs; wheeze");
    expect(html).toContain("• Bridges (3x10): done 0 of 1 scheduled days");
    expect(html).toContain("Sleep (hours)");
    expect(html).toContain("GP review");
    expect(html).toContain("<td>Dr. Lee</td><td>GP</td><td>+15550100</td>");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain("It isn't a diagnosis or a medical record.");
    expect(html).not.toContain("<script");
  });

  test("only the chosen sections; headings in the user's language", async () => {
    const t = setup();
    const { as } = await seeded(t);
    await as.mutation(api.chat.setLanguage, { language: "es" });
    const html = await as.query(api.reports.html, { from: "2026-10-01", to: "2026-11-02", sections: ["medications"], generated: "x" });
    expect(html).toContain("<h2>Medicamentos</h2>");
    expect(html).toContain("<title>Informe de salud</title>");
    expect(html).not.toContain("penicillin");
    expect(html).not.toContain("Headache");
  });

  test("needs sign-in, a valid range up to a year, and a section; others' data never shows", async () => {
    const t = setup();
    await seeded(t);
    const other = await createAppUser(t, "b@example.com");
    await expect(t.query(api.reports.html, { from: "2026-10-01", to: "2026-11-02", sections: ["facts"], generated: "x" })).rejects.toThrow(/Not signed in/);
    await expect(other.as.query(api.reports.html, { from: "2026-11-02", to: "2026-10-01", sections: ["facts"], generated: "x" })).rejects.toThrow(/start date/);
    await expect(other.as.query(api.reports.html, { from: "2024-01-01", to: "2026-11-02", sections: ["facts"], generated: "x" })).rejects.toThrow(/up to a year/);
    await expect(other.as.query(api.reports.html, { from: "2026-10-01", to: "2026-11-02", sections: [], generated: "x" })).rejects.toThrow(/at least one/);
    const html = await other.as.query(api.reports.html, { from: "2026-10-01", to: "2026-11-02", sections: [...ALL], generated: "x" });
    expect(html).not.toContain("Sertraline");
    expect(html).not.toContain("penicillin");
  });
});
