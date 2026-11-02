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
import type * as checkins from "../checkins.js";
import type * as creao from "../creao.js";
import type * as crons from "../crons.js";
import type * as daily from "../daily.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as journal from "../journal.js";
import type * as lib_cartesia from "../lib/cartesia.js";
import type * as lib_checkins from "../lib/checkins.js";
import type * as lib_cortex from "../lib/cortex.js";
import type * as lib_creao from "../lib/creao.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_health from "../lib/health.js";
import type * as lib_jev from "../lib/jev.js";
import type * as lib_jina from "../lib/jina.js";
import type * as lib_journal from "../lib/journal.js";
import type * as lib_language from "../lib/language.js";
import type * as lib_meds from "../lib/meds.js";
import type * as lib_places from "../lib/places.js";
import type * as lib_push from "../lib/push.js";
import type * as lib_reminders from "../lib/reminders.js";
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
import type * as lib_visit from "../lib/visit.js";
import type * as me from "../me.js";
import type * as medications from "../medications.js";
import type * as pipeline from "../pipeline.js";
import type * as push from "../push.js";
import type * as reminders from "../reminders.js";
import type * as shop from "../shop.js";
import type * as telegram from "../telegram.js";
import type * as telehealth from "../telehealth.js";
import type * as visit from "../visit.js";
import type * as visits from "../visits.js";
import type * as voice from "../voice.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  care: typeof care;
  chat: typeof chat;
  checkins: typeof checkins;
  creao: typeof creao;
  crons: typeof crons;
  daily: typeof daily;
  health: typeof health;
  http: typeof http;
  journal: typeof journal;
  "lib/cartesia": typeof lib_cartesia;
  "lib/checkins": typeof lib_checkins;
  "lib/cortex": typeof lib_cortex;
  "lib/creao": typeof lib_creao;
  "lib/env": typeof lib_env;
  "lib/health": typeof lib_health;
  "lib/jev": typeof lib_jev;
  "lib/jina": typeof lib_jina;
  "lib/journal": typeof lib_journal;
  "lib/language": typeof lib_language;
  "lib/meds": typeof lib_meds;
  "lib/places": typeof lib_places;
  "lib/push": typeof lib_push;
  "lib/reminders": typeof lib_reminders;
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
  "lib/visit": typeof lib_visit;
  me: typeof me;
  medications: typeof medications;
  pipeline: typeof pipeline;
  push: typeof push;
  reminders: typeof reminders;
  shop: typeof shop;
  telegram: typeof telegram;
  telehealth: typeof telehealth;
  visit: typeof visit;
  visits: typeof visits;
  voice: typeof voice;
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
