import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { parseRecord } from "../convex/lib/records";
import { cortexCalls, createAppUser, mockApis, setEnv, setup } from "./helpers";

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

const settle = (t: ReturnType<typeof setup>) => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));

const lab = (date: string, a1c: number) =>
  JSON.stringify({
    kind: "lab",
    title: "Blood test",
    date,
    source: "Quest Diagnostics",
    summary: "Your sugar average is a little above the usual range. Cholesterol is fine.",
    results: [
      { test: "Hemoglobin A1c", value: a1c, unit: "%", low: 4, high: 5.6, flag: a1c > 5.6 ? "high" : "normal", explanation: "Your average blood sugar over 3 months." },
      { test: "LDL cholesterol", value: "92", unit: "mg/dL", high: 100, flag: "normal", explanation: "The 'bad' cholesterol." },
      { test: "Urine glucose", text: "Negative", explanation: "No sugar in the urine." },
    ],
  });

async function upload(t: ReturnType<typeof setup>, as: any, type = "image/jpeg", bytes: BlobPart = new Uint8Array([1, 2, 3])) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type })));
  await as.mutation(api.chat.claimUpload, { storageId });
  return storageId as Id<"_storage">;
}

// A one-page PDF with a line of text, enough for pdf.js.
function tinyPdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("reading a record", () => {
  test("the model's reply is checked: numbers kept as printed, junk results dropped, bad dates ignored", () => {
    const r = parseRecord("```json\n" + lab("2026-10-20", 6.1).replace('"2026-10-20"', '"20/10/2026"') + "\n```")!;
    expect(r).toMatchObject({ kind: "lab", title: "Blood test", source: "Quest Diagnostics" });
    expect(r.date).toBeUndefined();
    expect(r.results.map((x) => [x.test, x.value ?? x.text, x.flag])).toEqual([
      ["Hemoglobin A1c", 6.1, "high"],
      ["LDL cholesterol", 92, "normal"],
      ["Urine glucose", "Negative", undefined],
    ]);
    expect(parseRecord('{"error":"not a record"}')).toBeNull();
    expect(parseRecord('{"title":"x"}')).toBeNull();
  });
});

describe("records", () => {
  test("a lab photo is read into a summary and results, follows a test across reports, and the model sees the latest", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: lab("2026-04-02", 5.9) }, { content: lab("2026-10-20", 6.1) }] });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.setLanguage, { language: "es" });

    const first = await as.mutation(api.records.add, { storageId: await upload(t, as) });
    expect((await as.query(api.records.list))[0]).toMatchObject({ _id: first, status: "reading" });
    await settle(t);
    await as.mutation(api.records.add, { storageId: await upload(t, as) });
    await settle(t);

    const [prompt] = cortexCalls(calls);
    expect(prompt.body.messages[0].content).toContain("in Spanish");
    expect(prompt.body.messages[1].content[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);

    const list = await as.query(api.records.list);
    expect(list.map((r) => [r.date, r.status, r.results, r.flagged])).toEqual([
      ["2026-10-20", "done", 3, 1],
      ["2026-04-02", "done", 3, 1],
    ]);
    const detail = await as.query(api.records.detail, { id: first });
    expect(detail.summary).toContain("sugar average");
    expect(detail.fileUrl).toBeTruthy();

    const trends = await as.query(api.records.trends);
    expect(trends.map((x) => [x.test, x.points.map((p) => p.value), x.flag])).toEqual([
      ["Hemoglobin A1c", [5.9, 6.1], "high"],
      ["LDL cholesterol", [92, 92], "normal"],
    ]);

    const context = await t.query(internal.records.forModel, { userId });
    expect(context).toContain("- 2026-10-20 Hemoglobin A1c: 6.1 % (range 4-5.6) [high]");
    expect(context.indexOf("Hemoglobin A1c")).toBeLessThan(context.indexOf("LDL cholesterol"));

    // Only the owner can open it; removing it deletes the file and its results.
    const other = await createAppUser(t, "b@example.com");
    await expect(other.as.query(api.records.detail, { id: first })).rejects.toThrow(/Not found/);
    await expect(other.as.mutation(api.records.remove, { id: first })).rejects.toThrow(/Not found/);
    const file = (await t.run((ctx) => ctx.db.get(first)))!.file!;
    await as.mutation(api.records.remove, { id: first });
    expect(await t.run((ctx) => ctx.storage.get(file))).toBeNull();
    // One result left per test: only the out-of-range one still shows as a trend.
    expect((await as.query(api.records.trends)).map((x) => [x.test, x.points.length])).toEqual([["Hemoglobin A1c", 1]]);
  });

  test("a PDF is read from its text; a PDF without text or a non-record fails with a reason", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: lab("2026-10-20", 6.1) }, { content: '{"error":"not a record"}' }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.records.add, { storageId: await upload(t, as, "application/pdf", tinyPdf("Hemoglobin A1c 6.1 % (4.0 - 5.6) HIGH")) });
    await settle(t);
    expect(cortexCalls(calls)[0].body.messages[1].content[0].text).toContain("Hemoglobin A1c 6.1 %");

    await as.mutation(api.records.add, { storageId: await upload(t, as, "application/pdf", tinyPdf("")) });
    await as.mutation(api.records.add, { storageId: await upload(t, as) });
    await settle(t);
    expect((await as.query(api.records.list)).map((r) => [r.status, r.error])).toEqual(
      expect.arrayContaining([
        ["done", null],
        ["failed", "noText"],
        ["failed", "notRecord"],
      ]),
    );
  });

  test("deleting health records in Settings removes them with their files and results, and is in the export", async () => {
    const t = setup();
    mockApis({ core: [{ content: lab("2026-10-20", 6.1) }] });
    const { as } = await createAppUser(t);
    const id = await as.mutation(api.records.add, { storageId: await upload(t, as) });
    await settle(t);
    const exported = JSON.parse(await as.action(api.me.exportData, {}));
    expect(exported.healthRecords).toMatchObject([{ title: "Blood test", hasFile: true }]);
    expect(exported.labResults).toHaveLength(3);
    expect((await as.query(api.me.overview))!.counts.records.n).toBe(1);

    const file = (await t.run((ctx) => ctx.db.get(id)))!.file!;
    await as.mutation(api.me.deleteData, { category: "records" });
    await settle(t);
    expect(await as.query(api.records.list)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("labResults").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.storage.get(file))).toBeNull();
  });

  test("only the user's own unused photo or PDF can be added", async () => {
    const t = setup();
    mockApis();
    const { as } = await createAppUser(t);
    const other = await createAppUser(t, "b@example.com");
    const mine = await upload(t, as);
    await expect(other.as.mutation(api.records.add, { storageId: mine })).rejects.toThrow(/didn't upload/);
    await expect(as.mutation(api.records.add, { storageId: await upload(t, as, "text/plain") })).rejects.toThrow(/didn't upload/);
    await as.mutation(api.records.add, { storageId: mine });
    await expect(as.mutation(api.records.add, { storageId: mine })).rejects.toThrow(/didn't upload/);
  });
});
