// Tools the core model can call. Each returns plain text for the model.
import { ToolDef } from "./cortex";
import { read, search } from "./jina";

export const toolDefs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web. Use for current info, local services (e.g. nearby urgent care), or anything you are unsure about.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search query" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_page",
      description: "Read the text of a web page by URL.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bio_research",
      description:
        "Research a medical/biology question in PubMed papers. Returns abstracts from the top sources to summarize and cite.",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
    },
  },
];

// Handled in the pipeline since it writes to the user's record.
export const saveLocationTool: ToolDef = {
  type: "function",
  function: {
    name: "save_location",
    description: "Remember the user's location (city, zip, or address) for finding nearby care later.",
    parameters: {
      type: "object",
      properties: { location: { type: "string", description: "e.g. 'Berkeley, CA 94704'" } },
      required: ["location"],
    },
  },
};

// Handled in the pipeline: reads the user's synced Apple Health summaries (convex/health.ts). Offered only once connected.
export const healthDataTool: ToolDef = {
  type: "function",
  function: {
    name: "get_health_data",
    description:
      "Read the user's daily health summaries from Apple Health or Health Connect (steps, resting heart rate, HRV, sleep, breathing rate, SpO2, wrist " +
      "temperature, weight, logged periods) with averages and recent changes. Use when their metrics could help answer, " +
      "e.g. tiredness, sleep, possible illness, heart rate, cycle questions.",
    parameters: {
      type: "object",
      properties: { days: { type: "integer", description: "How many days back, 1-90 (default 14; use 90 for cycle questions)" } },
    },
  },
};

// Handled in the pipeline: writes a doctor-visit summary in the background (convex/visit.ts).
export const visitSummaryTool: ToolDef = {
  type: "function",
  function: {
    name: "prepare_visit_summary",
    description:
      "Write a one-page summary for the user to bring to a doctor's appointment, from their recent chats, symptom " +
      "analyses, medications and phone health data. Use when they ask to prepare for an appointment or want a summary " +
      "for their doctor. It's ready in under a minute.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "What the visit is about, if the user said" },
        days: { type: "integer", description: "How far back to cover: 14, 30 (default) or 90" },
      },
    },
  },
};

// Handled in the pipeline: medication reminders (convex/reminders.ts).
export const reminderTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "set_medication_reminder",
      description:
        "Set a recurring reminder for a medication or supplement. Reminders appear in the Wellnest app chat with " +
        "Taken / Skip buttons. Use when the user asks to be reminded. Give either times (daily at those local times) or " +
        "every_hours. Confirm the name, dose and schedule back to the user.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "e.g. 'Ibuprofen'" },
          dose: { type: "string", description: "e.g. '400 mg' or '1 tablet'" },
          times: { type: "array", items: { type: "string" }, description: "Local 24h times, e.g. ['08:00', '20:00']" },
          every_hours: { type: "number", description: "Instead of times: every N hours (1-72), starting N hours from now" },
          days: { type: "integer", description: "How many days the course lasts, if it ends" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_medication_reminder",
      description: "Stop the reminders for a medication the user names.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  },
];

// Handled in the pipeline: saved facts the model sees on every turn (convex/me.ts).
export const factTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "remember_fact",
      description:
        "Save a lasting fact about the user's health that will matter in future chats: allergies, chronic conditions, " +
        "regular medications, pregnancy, age, surgeries. Not passing symptoms or moods. One short fact per call, in the " +
        "third person (e.g. 'Allergic to penicillin (hives)'). The user can see and edit saved facts.",
      parameters: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_fact",
      description: "Delete a saved fact when the user says it's wrong or no longer true, or asks you to forget it.",
      parameters: {
        type: "object",
        properties: { fact: { type: "string", description: "Key words of the saved fact, e.g. 'penicillin'" } },
        required: ["fact"],
      },
    },
  },
];

// Handled in the pipeline: the symptom journal (convex/journal.ts).
export const journalTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "log_symptom",
      description:
        "Add to the user's symptom journal whenever they report a symptom they have now or had on a recent day " +
        "(\"my headache's a 6 today\", \"cramps were bad yesterday\"). One call per symptom. Don't ask permission; " +
        "mention briefly that you logged it. Use a short common name (headache, nausea, cramps, fatigue).",
      parameters: {
        type: "object",
        properties: {
          symptom: { type: "string" },
          severity: { type: "integer", description: "0-10 if the user gave one or clearly implied it (mild ~3, bad ~7)" },
          note: { type: "string", description: "Short context: triggers, timing, what helped" },
          date: { type: "string", description: "YYYY-MM-DD if not today (e.g. yesterday)" },
        },
        required: ["symptom"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_symptom_journal",
      description:
        "Read the user's symptom journal: per-symptom trends, patterns against their health data (sleep, steps, periods) " +
        "and the entries. Use when they ask how a symptom has been, what triggers it, or whether it's improving.",
      parameters: { type: "object", properties: { days: { type: "integer", description: "1-180, default 30" } } },
    },
  },
];

// Handled in the pipeline: it starts a background CREAO run for this user (convex/creao.ts).
export const analyzeSymptomsTool: ToolDef = {
  type: "function",
  function: {
    name: "analyze_symptoms",
    description:
      "Start a detailed analysis of the user's symptoms by the CREAO symptom analyzer, which ranks the 1-3 most likely " +
      "conditions with reasoning and care guidance. Use only when the user asks what could be causing their symptoms " +
      "or asks for a detailed analysis. It runs in the background; the report arrives as a separate message in a few " +
      "minutes. Sends what the user told you to the analysis service. Pass only details the user actually gave.",
    parameters: {
      type: "object",
      properties: {
        symptoms: { type: "string", description: "Each symptom with onset, severity, pattern, triggers, and any negatives the user mentioned" },
        symptom_duration: { type: "string", description: "How long, and whether it's worsening, stable or improving" },
        age: { type: "integer" },
        sex: { type: "string", enum: ["female", "male", "other", "unspecified"] },
        chronic_conditions: { type: "string", description: "Existing long-term diagnoses and regular medications" },
        biosensor_data: { type: "string", description: "Health app metrics the user shared (heart rate, sleep, steps, etc.)" },
        cycle_data: { type: "string", description: "Menstrual cycle history the user shared" },
        last_period_start: { type: "string" },
      },
      required: ["symptoms"],
    },
  },
};

export async function runTool(name: string, rawArgs: string): Promise<string> {
  try {
    const args = JSON.parse(rawArgs || "{}");
    switch (name) {
      case "web_search":
        return format(await search(args.query));
      case "read_page":
        return await read(args.url);
      case "bio_research": {
        const results = await search(args.question, "pubmed.ncbi.nlm.nih.gov");
        const pages = await Promise.all(
          results.slice(0, 3).map(async (r) => {
            const text = await read(r.url, 2500).catch(() => r.content);
            return `## ${r.title}\n${r.url}\n${text}`;
          }),
        );
        return pages.join("\n\n") || "No papers found.";
      }
      default:
        return `Unknown tool ${name}`;
    }
  } catch (e) {
    return `Tool error: ${(e as Error).message}`;
  }
}

function format(results: { title: string; url: string; content: string }[]) {
  if (!results.length) return "No results.";
  return results.map((r) => `- ${r.title} (${r.url})\n  ${r.content}`).join("\n");
}
