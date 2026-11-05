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
      "temperature, weight, glucose from a sensor or meter, logged periods) with averages and recent changes. Use when their metrics could help answer, " +
      "e.g. tiredness, sleep, possible illness, heart rate, glucose, weight, or cycle questions.",
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
      name: "update_medication",
      description:
        "Record a change to one of the user's medications when they tell you about it: pausing, resuming or stopping it, " +
        "a new dose, a side effect they're having, or a refill. Each change is dated in the medication's history.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          action: { type: "string", enum: ["pause", "resume", "stop", "change_dose", "side_effect", "refilled"] },
          dose: { type: "string", description: "For change_dose: the new dose, e.g. '200 mg'" },
          side_effect: { type: "string", description: "For side_effect: what they noticed, e.g. 'nausea after the morning dose'" },
          severity: { type: "integer", description: "For side_effect: 0-10 if given" },
          amount: { type: "number", description: "For refilled: how many units they got, if said" },
        },
        required: ["name", "action"],
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
      name: "log_how_i_feel",
      description:
        "Log today's check-in when the user says how they feel overall: mood, energy and/or how well they slept, each " +
        "1-5 (1 awful, 3 okay, 5 great), e.g. \"I'm wiped out\" is energy 1, \"slept great\" is sleep_quality 5. " +
        "Only the parts they mentioned. Mention briefly that you logged it.",
      parameters: {
        type: "object",
        properties: {
          mood: { type: "integer" },
          energy: { type: "integer" },
          sleep_quality: { type: "integer" },
          note: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_condition_event",
      description:
        "Log a pain / CRPS episode, an asthma reading or attack, a seizure, or a blood glucose reading in the user's condition " +
        "trackers when they describe one. Fill in only what they said. Several entries a day are fine. Mention briefly that you logged it. " +
        "For a seizure that's happening now or lasted over 5 minutes, tell them to call emergency services first. For a glucose " +
        "reading under 70 mg/dL (3.9 mmol/L) with symptoms, or one they say is very high with vomiting or confusion, give the urgent advice first.",
      parameters: {
        type: "object",
        properties: {
          tracker: { type: "string", enum: ["pain", "asthma", "seizure", "glucose"] },
          date: { type: "string", description: "YYYY-MM-DD if not today" },
          note: { type: "string" },
          severity: { type: "integer", description: "pain: 0-10" },
          locations: {
            type: "array",
            items: { type: "string", enum: ["head", "neck", "shoulders", "chest", "upper_back", "lower_back", "abdomen", "hips", "left_arm", "right_arm", "left_hand", "right_hand", "left_leg", "right_leg", "left_foot", "right_foot", "whole_body"] },
          },
          types: { type: "array", items: { type: "string", enum: ["aching", "burning", "stabbing", "throbbing", "shooting", "tingling", "cramping", "pressure"] } },
          duration_min: { type: "number", description: "pain: how long it lasted, minutes" },
          flare: { type: "boolean" },
          swelling: { type: "boolean" },
          colour_change: { type: "boolean" },
          temperature_change: { type: "boolean" },
          touch_sensitive: { type: "boolean", description: "pain from light touch (allodynia)" },
          triggers: { type: "string" },
          helped: { type: "string", description: "pain: what helped" },
          peak_flow: { type: "number", description: "asthma: L/min" },
          reliever_puffs: { type: "number" },
          preventer_taken: { type: "boolean" },
          symptoms: { type: "array", items: { type: "string", enum: ["wheeze", "cough", "chest_tightness", "breathless"] } },
          night: { type: "boolean", description: "asthma symptoms at night" },
          attack: { type: "boolean", description: "an asthma attack" },
          seizure_type: { type: "string", enum: ["focal_aware", "focal_impaired", "tonic_clonic", "absence", "myoclonic", "atonic", "unknown"] },
          duration_seconds: { type: "number", description: "seizure length in seconds" },
          aura: { type: "string", description: "seizure warning signs" },
          rescue_med: { type: "boolean" },
          recovery_min: { type: "number" },
          witness: { type: "string", description: "what someone who saw it said" },
          glucose_value: { type: "number", description: "glucose: the reading as they said it" },
          glucose_unit: { type: "string", enum: ["mg/dL", "mmol/L"], description: "glucose: the reading's unit; values under 35 are almost always mmol/L" },
          glucose_context: { type: "string", enum: ["fasting", "before_meal", "after_meal", "bedtime", "other"] },
        },
        required: ["tracker"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_exercise",
      description: "Add an exercise or physical therapy routine the user is meant to do (e.g. from a physical therapist): name, sets/reps or minutes, and weekdays.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          sets: { type: "integer" },
          reps: { type: "integer" },
          minutes: { type: "integer" },
          days: { type: "array", items: { type: "integer" }, description: "Weekdays 0 (Sunday) to 6; leave out for every day" },
          notes: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_exercise_done",
      description: "Check off an exercise the user says they did (name, or \"all\" for the whole routine).",
      parameters: { type: "object", properties: { name: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD if not today" } }, required: ["name"] },
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

// Handled in the pipeline: appointments and the care team (convex/visits.ts).
export const visitTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "add_appointment",
      description:
        "Add an appointment the user tells you about (primary care, specialist, physical therapy, scan, blood test...) to their calendar, " +
        "with a reminder 2 hours before. Use their local date and 24h time. If a weekday is given, work out the date " +
        "from today's date.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "e.g. 'Rheumatology follow-up'" },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM, 24h" },
          kind: { type: "string", enum: ["in_person", "video", "phone"] },
          clinician: { type: "string", description: "Who it's with, if said" },
          location: { type: "string" },
        },
        required: ["title", "date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_care_team_member",
      description: "Save someone in the user's care team (a doctor, nurse, therapist, pharmacist) when they mention them with details worth keeping.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, role: { type: "string" }, phone: { type: "string" }, clinic: { type: "string" } },
        required: ["name"],
      },
    },
  },
];

// Handled in the pipeline: nearby care from OpenStreetMap (convex/care.ts).
export const findCareTool: ToolDef = {
  type: "function",
  function: {
    name: "find_care",
    description:
      "Find the nearest emergency rooms, urgent care, pharmacies or doctors to the user's saved location, with distance, " +
      "hours, a call link and a directions link. Use for anything urgent, and whenever the user asks where to go. Pass the " +
      "links on as they are.",
    parameters: {
      type: "object",
      properties: { kind: { type: "string", enum: ["er", "urgent_care", "pharmacy", "doctor"] } },
      required: ["kind"],
    },
  },
};

// Handled in the pipeline: offers telehealth video visit times (convex/telehealth.ts). Not offered for emergencies.
export const telehealthTool: ToolDef = {
  type: "function",
  function: {
    name: "suggest_telehealth",
    description:
      "Offer the user a video visit with a clinician when their problem needs one but isn't an emergency: likely needs " +
      "a prescription or test (UTI symptoms, possible strep, pink eye, a rash that's spreading or not improving), " +
      "symptoms lasting longer than they should (a cough over 3 weeks, sinus pain over 10 days, a fever over 3 days), " +
      "a medication question for a prescriber, or the user asks to talk to a doctor. Finds times and shows them as " +
      "buttons; nothing is booked until the user confirms. Never for emergencies (send them to 911 / the ER instead).",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One line for the clinician, e.g. 'Burning when urinating for 2 days, no fever'" },
        urgency: { type: "string", enum: ["today", "soon"], description: "today: should be seen today; soon: within a day or two" },
      },
      required: ["reason", "urgency"],
    },
  },
};

// Handled in the pipeline: patterns, medication before/after and charts (convex/insights.ts).
export const insightTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "find_patterns",
      description:
        "Find what goes with the user's worse days, from their own logs over the last 90 days: pain, symptoms, mood, " +
        "energy, peak flow, seizures, and glucose against sleep, activity, resting heart rate, HRV, periods, weight gain, glucose, " +
        "and local weather, air pressure, humidity, air quality, and pollen. Also how things (including weight) changed after they " +
        "started a medication or changed its dose, and today's and tomorrow's local weather. Use when they ask what triggers something, why " +
        "they feel worse, whether a medication is working, or what to watch out for. These are associations; say so.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "show_chart",
      description:
        "Draw a chart of one of the user's measures, shown under your reply in the app. Use when they ask to see or " +
        "compare a trend (\"show my pain this month\"). Returns the numbers so you can describe the trend in a sentence; " +
        "don't list every value.",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: ["pain", "symptom", "mood", "energy", "sleepQuality", "sleepHours", "steps", "restingHeartRate", "hrv", "weightKg", "glucose", "peakFlow", "reliever", "seizures", "tempMax", "aqi", "pollen"],
          },
          symptom: { type: "string", description: "For metric symptom: which one, e.g. 'headache'" },
          days: { type: "integer", description: "7-180, default 30" },
        },
        required: ["metric"],
      },
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
