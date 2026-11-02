// Doctor-visit summary: what goes to the model and how it's asked to write it (convex/visit.ts).

export const VISIT_PERIODS = [14, 30, 90] as const;
export const DEFAULT_VISIT_DAYS = 30;
const MAX_TRANSCRIPT = 24_000; // characters of chat; the oldest lines go first
const MAX_LINE = 800;

export const VISIT_PROMPT = `You prepare a one-page summary for a patient to bring to a doctor's appointment, written from the patient's own chats with Wellnest, an AI health assistant.
Write it in the first person as the patient ("I've had..."), in plain words a clinician can scan in a minute.
Use ONLY facts from the material below. Never invent symptoms, dates, doses or results; if something isn't there, leave it out. Dates: use the ones given (messages are dated); say "around" when unsure.
Ignore the assistant's general advice unless the patient said they followed it and what happened.
Format in simple Markdown (# for the title, ## for sections, bullets, **bold**). No tables. Skip any section with nothing to put in it.
Sections, in this order:
# Visit summary
(One line: the reason for the visit.)
## Main concerns
## Timeline (dated bullets, oldest first)
## Symptoms (for each: onset, how often, severity, triggers, what helps or doesn't)
## Medications and supplements (what, dose, how often, since when, as mentioned)
## Health data (only notable trends from the phone's health numbers, with the numbers)
## Earlier AI analyses (one or two lines each; label them as AI-generated, not a diagnosis)
## Questions to ask (3-6 short questions)
End with this line in italics: Prepared by Wellnest (AI) from my own notes and chats. Not a medical record.`;

export type VisitMessage = { role: "user" | "assistant"; text: string; at: number };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// The chat as dated lines, newest kept when it's too long.
export function transcript(messages: VisitMessage[]): string {
  const lines = messages.map((m) => {
    const text = m.text.replace(/\s+/g, " ").trim();
    return `[${day(m.at)}] ${m.role === "user" ? "Patient" : "Wellnest"}: ${text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text}`;
  });
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    size += lines[i].length + 1;
    if (size > MAX_TRANSCRIPT) break;
    kept.unshift(lines[i]);
  }
  return kept.join("\n");
}

export function visitMaterial(opts: {
  reason?: string;
  days: number;
  today: string;
  messages: VisitMessage[];
  analyses: { at: number; report: string }[];
  health?: string;
  medications?: string;
  facts?: string[];
  journal?: string;
  appointments?: string;
}): string {
  const parts = [
    `Today: ${opts.today}. Period covered: the last ${opts.days} days.`,
    `Reason for the visit: ${opts.reason?.trim() || "not given; infer it from the main concerns"}`,
  ];
  if (opts.facts?.length) parts.push(`Facts the patient saved in Wellnest:\n${opts.facts.map((f) => `- ${f}`).join("\n")}`);
  if (opts.medications) parts.push(`Medications and reminders the patient set up in Wellnest:\n${opts.medications}`);
  if (opts.appointments) parts.push(`Appointments, with the patient's questions and notes:\n${opts.appointments}`);
  if (opts.journal) parts.push(`Symptom journal:\n${opts.journal}`);
  if (opts.health) parts.push(`Health data from the phone (Apple Health or Health Connect):\n${opts.health}`);
  for (const a of opts.analyses) parts.push(`Earlier AI symptom analysis (${day(a.at)}):\n${a.report.slice(0, 3000)}`);
  parts.push(opts.messages.length ? `Chat:\n${transcript(opts.messages)}` : "Chat: (no messages in this period)");
  return parts.join("\n\n");
}
