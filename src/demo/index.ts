// The example dashboard's data, loaded with import() from src/DemoPage.tsx so it ships as its own bundle: a fake
// Convex client over the app's own functions and a made-up person, all in the browser.
import type { ConvexReactClient } from "convex/react";
import type { Lang } from "../i18n";
import { DemoClient } from "./client";
import { DemoServer } from "./server";

// `blocked`: what to say when something needs a real account.
export function createDemoClient(lang: Lang, blocked: () => string): ConvexReactClient {
  return new DemoClient(new DemoServer(lang, Date.now()), blocked).asClient();
}
