/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as care from "../care.js";
import type * as chat from "../chat.js";
import type * as chats from "../chats.js";
import type * as checkins from "../checkins.js";
import type * as circle from "../circle.js";
import type * as creao from "../creao.js";
import type * as crons from "../crons.js";
import type * as daily from "../daily.js";
import type * as dashboard from "../dashboard.js";
import type * as drugs from "../drugs.js";
import type * as emergency from "../emergency.js";
import type * as exercises from "../exercises.js";
import type * as forecast from "../forecast.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as insights from "../insights.js";
import type * as journal from "../journal.js";
import type * as lib_appearance from "../lib/appearance.js";
import type * as lib_cartesia from "../lib/cartesia.js";
import type * as lib_chats from "../lib/chats.js";
import type * as lib_checkins from "../lib/checkins.js";
import type * as lib_circle from "../lib/circle.js";
import type * as lib_cortex from "../lib/cortex.js";
import type * as lib_creao from "../lib/creao.js";
import type * as lib_drugs from "../lib/drugs.js";
import type * as lib_emergency from "../lib/emergency.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_health from "../lib/health.js";
import type * as lib_insights from "../lib/insights.js";
import type * as lib_insightsText from "../lib/insightsText.js";
import type * as lib_jev from "../lib/jev.js";
import type * as lib_jina from "../lib/jina.js";
import type * as lib_journal from "../lib/journal.js";
import type * as lib_language from "../lib/language.js";
import type * as lib_links from "../lib/links.js";
import type * as lib_meds from "../lib/meds.js";
import type * as lib_onboarding from "../lib/onboarding.js";
import type * as lib_places from "../lib/places.js";
import type * as lib_push from "../lib/push.js";
import type * as lib_records from "../lib/records.js";
import type * as lib_reminders from "../lib/reminders.js";
import type * as lib_report from "../lib/report.js";
import type * as lib_shopping_airquality from "../lib/shopping/airquality.js";
import type * as lib_shopping_catalog from "../lib/shopping/catalog.js";
import type * as lib_shopping_data from "../lib/shopping/data.js";
import type * as lib_shopping_guardrails from "../lib/shopping/guardrails.js";
import type * as lib_shopping_intent from "../lib/shopping/intent.js";
import type * as lib_shopping_links from "../lib/shopping/links.js";
import type * as lib_shopping_messages from "../lib/shopping/messages.js";
import type * as lib_shopping_planner from "../lib/shopping/planner.js";
import type * as lib_shopping_understanding from "../lib/shopping/understanding.js";
import type * as lib_speech from "../lib/speech.js";
import type * as lib_telegram from "../lib/telegram.js";
import type * as lib_telehealth from "../lib/telehealth.js";
import type * as lib_tools from "../lib/tools.js";
import type * as lib_trackers from "../lib/trackers.js";
import type * as lib_units from "../lib/units.js";
import type * as lib_visit from "../lib/visit.js";
import type * as lib_weather from "../lib/weather.js";
import type * as me from "../me.js";
import type * as medScan from "../medScan.js";
import type * as medications from "../medications.js";
import type * as onboarding from "../onboarding.js";
import type * as pipeline from "../pipeline.js";
import type * as push from "../push.js";
import type * as questions from "../questions.js";
import type * as records from "../records.js";
import type * as recordsPdf from "../recordsPdf.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as share from "../share.js";
import type * as shop from "../shop.js";
import type * as telegram from "../telegram.js";
import type * as telehealth from "../telehealth.js";
import type * as trackers from "../trackers.js";
import type * as visit from "../visit.js";
import type * as visits from "../visits.js";
import type * as voice from "../voice.js";
import type * as weather from "../weather.js";
import type * as weekly from "../weekly.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  care: typeof care;
  chat: typeof chat;
  chats: typeof chats;
  checkins: typeof checkins;
  circle: typeof circle;
  creao: typeof creao;
  crons: typeof crons;
  daily: typeof daily;
  dashboard: typeof dashboard;
  drugs: typeof drugs;
  emergency: typeof emergency;
  exercises: typeof exercises;
  forecast: typeof forecast;
  health: typeof health;
  http: typeof http;
  insights: typeof insights;
  journal: typeof journal;
  "lib/appearance": typeof lib_appearance;
  "lib/cartesia": typeof lib_cartesia;
  "lib/chats": typeof lib_chats;
  "lib/checkins": typeof lib_checkins;
  "lib/circle": typeof lib_circle;
  "lib/cortex": typeof lib_cortex;
  "lib/creao": typeof lib_creao;
  "lib/drugs": typeof lib_drugs;
  "lib/emergency": typeof lib_emergency;
  "lib/env": typeof lib_env;
  "lib/health": typeof lib_health;
  "lib/insights": typeof lib_insights;
  "lib/insightsText": typeof lib_insightsText;
  "lib/jev": typeof lib_jev;
  "lib/jina": typeof lib_jina;
  "lib/journal": typeof lib_journal;
  "lib/language": typeof lib_language;
  "lib/links": typeof lib_links;
  "lib/meds": typeof lib_meds;
  "lib/onboarding": typeof lib_onboarding;
  "lib/places": typeof lib_places;
  "lib/push": typeof lib_push;
  "lib/records": typeof lib_records;
  "lib/reminders": typeof lib_reminders;
  "lib/report": typeof lib_report;
  "lib/shopping/airquality": typeof lib_shopping_airquality;
  "lib/shopping/catalog": typeof lib_shopping_catalog;
  "lib/shopping/data": typeof lib_shopping_data;
  "lib/shopping/guardrails": typeof lib_shopping_guardrails;
  "lib/shopping/intent": typeof lib_shopping_intent;
  "lib/shopping/links": typeof lib_shopping_links;
  "lib/shopping/messages": typeof lib_shopping_messages;
  "lib/shopping/planner": typeof lib_shopping_planner;
  "lib/shopping/understanding": typeof lib_shopping_understanding;
  "lib/speech": typeof lib_speech;
  "lib/telegram": typeof lib_telegram;
  "lib/telehealth": typeof lib_telehealth;
  "lib/tools": typeof lib_tools;
  "lib/trackers": typeof lib_trackers;
  "lib/units": typeof lib_units;
  "lib/visit": typeof lib_visit;
  "lib/weather": typeof lib_weather;
  me: typeof me;
  medScan: typeof medScan;
  medications: typeof medications;
  onboarding: typeof onboarding;
  pipeline: typeof pipeline;
  push: typeof push;
  questions: typeof questions;
  records: typeof records;
  recordsPdf: typeof recordsPdf;
  reminders: typeof reminders;
  reports: typeof reports;
  share: typeof share;
  shop: typeof shop;
  telegram: typeof telegram;
  telehealth: typeof telehealth;
  trackers: typeof trackers;
  visit: typeof visit;
  visits: typeof visits;
  voice: typeof voice;
  weather: typeof weather;
  weekly: typeof weekly;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
