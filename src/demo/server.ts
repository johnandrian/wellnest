// The example dashboard's "server": the app's own Convex functions (convex/*.ts), run in the browser against the
// in-memory database in ./db.ts and the made-up person in ./seed.ts. Loaded only on /demo, as its own bundle
// (src/DemoPage.tsx imports it with import()), so the signed-in app never downloads it.
// First, so Convex knows the functions below are meant to run here.
import "./allowInBrowser";
import { getFunctionName, type FunctionReference } from "convex/server";
import schema from "../../convex/schema";
import * as agent from "../../convex/agent";
import * as chat from "../../convex/chat";
import * as circle from "../../convex/circle";
import * as daily from "../../convex/daily";
import * as dashboard from "../../convex/dashboard";
import * as drugs from "../../convex/drugs";
import * as emergency from "../../convex/emergency";
import * as exercises from "../../convex/exercises";
import * as health from "../../convex/health";
import * as insights from "../../convex/insights";
import * as journal from "../../convex/journal";
import * as me from "../../convex/me";
import * as medications from "../../convex/medications";
import * as onboarding from "../../convex/onboarding";
import * as pipeline from "../../convex/pipeline";
import * as questions from "../../convex/questions";
import * as records from "../../convex/records";
import * as reminders from "../../convex/reminders";
import * as reports from "../../convex/reports";
import * as share from "../../convex/share";
import * as telehealth from "../../convex/telehealth";
import * as trackers from "../../convex/trackers";
import * as visit from "../../convex/visit";
import * as visits from "../../convex/visits";
import * as weather from "../../convex/weather";
import { MemoryDb } from "./db";
import { seedDemo } from "./seed";
import { DEMO_CONTENT } from "./content";
import type { Lang } from "../i18n";

type Registered = {
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  _handler: (ctx: unknown, args: unknown) => unknown;
};

const MODULES: Record<string, Record<string, unknown>> = {
  agent,
  chat,
  circle,
  daily,
  dashboard,
  drugs,
  emergency,
  exercises,
  health,
  insights,
  journal,
  me,
  medications,
  onboarding,
  pipeline,
  questions,
  records,
  reminders,
  reports,
  share,
  telehealth,
  trackers,
  visit,
  visits,
  weather,
};

// Background work the demo can do on its own. Everything else scheduled (reminders, model calls, lookups) is
// skipped, since it would need the real server.
const SCHEDULED: Record<string, "run" | ((server: DemoServer, args: Record<string, unknown>) => Promise<void>)> = {
  // Approving an action finishes it the same way the server would.
  "agent:execute": "run",
  // A visit summary is written by the model on the server; the demo fills in a ready-made one after a moment.
  "visit:generate": async (server, args) => {
    await new Promise((r) => setTimeout(r, 1500));
    await server.run("visit:finish", { id: args.id, text: DEMO_CONTENT[server.lang].visitSummary }, "mutation");
  },
  // A journal note's symptoms are picked out by the model on the server; the demo looks for a few common English names
  // and the first number from 0 to 10.
  "journal:extractNote": async (server, args) => {
    const note = (await server.run("journal:noteFor", { id: args.id }, "query")) as { text: string } | null;
    if (!note) return;
    const text = note.text.toLowerCase();
    const n = text.match(/\b(10|[0-9])\b/);
    const symptoms = DEMO_SYMPTOMS.filter((x) => text.includes(x)).map((symptom) => (n ? { symptom, severity: Number(n[1]) } : { symptom }));
    await server.run("journal:logFromNote", { id: args.id, symptoms }, "mutation");
  },
};
const DEMO_SYMPTOMS = ["pain", "morning stiffness", "fatigue", "headache", "nausea", "dizziness", "tiredness"];

// Thrown for anything that needs a real account (uploads, the model, outside services); the page says so.
export class NeedsAccount extends Error {
  constructor(name: string) {
    super(`The example dashboard can't run ${name}.`);
    this.name = "NeedsAccount";
  }
}

const nameOf = (ref: FunctionReference<"query" | "mutation" | "action", "public" | "internal"> | string) =>
  typeof ref === "string" ? ref : getFunctionName(ref);

export class DemoServer {
  readonly db: MemoryDb;
  readonly userId: string;
  private jobs = 0;

  constructor(
    readonly lang: Lang,
    now: number,
  ) {
    const tables = (schema as unknown as { tables: Record<string, unknown> }).tables;
    this.db = new MemoryDb(tables as ConstructorParameters<typeof MemoryDb>[0]);
    this.userId = seedDemo(this.db, now, lang);
  }

  // Whether the demo has this function at all (tests check every screen's are here).
  has(name: string) {
    const [mod, fn] = name.split(":");
    return typeof (MODULES[mod]?.[fn] as Registered | undefined)?._handler === "function";
  }

  private find(name: string): Registered {
    const [mod, fn] = name.split(":");
    const f = MODULES[mod]?.[fn ?? "default"] as Registered | undefined;
    if (!f || typeof f._handler !== "function") throw new NeedsAccount(name);
    return f;
  }

  private ctx(kind: "query" | "mutation" | "action") {
    const auth = { getUserIdentity: async () => ({ subject: `${this.userId}|demo`, tokenIdentifier: `demo|${this.userId}`, issuer: "demo" }) };
    const storage = {
      getUrl: async () => null,
      get: async () => null,
      delete: async () => {},
      generateUploadUrl: async () => {
        throw new NeedsAccount("uploads");
      },
      store: async () => {
        throw new NeedsAccount("uploads");
      },
    };
    const runQuery = (ref: FunctionReference<"query", "public" | "internal">, args: Record<string, unknown> = {}) => this.run(nameOf(ref), args, "query");
    const runMutation = (ref: FunctionReference<"mutation", "public" | "internal">, args: Record<string, unknown> = {}) =>
      this.run(nameOf(ref), args, "mutation");
    const scheduler = {
      runAfter: async (delay: number, ref: FunctionReference<"mutation" | "action", "public" | "internal">, args: Record<string, unknown> = {}) =>
        this.schedule(delay, nameOf(ref), args),
      runAt: async () => `${++this.jobs}_scheduled_functions`,
      cancel: async () => {},
    };
    if (kind === "query") return { db: this.db.reader, auth, storage, runQuery };
    if (kind === "mutation") return { db: this.db.writer, auth, storage, runQuery, runMutation, scheduler };
    return { auth, storage, runQuery, runMutation, scheduler, runAction: (ref: FunctionReference<"action", "public" | "internal">, args = {}) => this.run(nameOf(ref), args, "action") };
  }

  private async schedule(delay: number, name: string, args: Record<string, unknown>) {
    const id = `${++this.jobs}_scheduled_functions`;
    const job = SCHEDULED[name];
    if (job && delay === 0) {
      // After the mutation that scheduled it has finished, as on the server.
      setTimeout(() => {
        void (job === "run" ? this.run(name, args, "action") : job(this, args)).catch((e) => console.warn("demo job failed", name, e));
      }, 0);
    }
    return id;
  }

  async run(name: string, args: Record<string, unknown>, kind: "query" | "mutation" | "action"): Promise<unknown> {
    const f = this.find(name);
    // Actions the app calls itself (the model, scanning, outside services) need the real server.
    if (f.isAction && kind === "action" && !SCHEDULED[name]) throw new NeedsAccount(name);
    return await f._handler(this.ctx(f.isQuery ? "query" : f.isMutation ? "mutation" : "action"), args);
  }
}
