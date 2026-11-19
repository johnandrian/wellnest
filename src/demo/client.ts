// What the example dashboard (/demo) gives Convex's React hooks instead of a ConvexReactClient: useQuery, useMutation,
// useAction, and useConvex().query all land here and run the app's own functions in the browser (./server.ts).
// Results are kept per query and refreshed after every change, so the screens update as they do when signed in.
import { convexToJson, type Value } from "convex/values";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { ConvexReactClient } from "convex/react";
import { NeedsAccount, type DemoServer } from "./server";

type AnyRef = FunctionReference<"query" | "mutation" | "action">;
type Args = Record<string, Value>;

type Watched = {
  name: string;
  args: Args;
  value: unknown;
  error?: Error;
  done: boolean;
  listeners: Set<() => void>;
  json: string;
};

const keyOf = (name: string, args: Args) => `${name}:${JSON.stringify(convexToJson(args ?? {}))}`;

export class DemoClient {
  private watched = new Map<string, Watched>();
  private dirty = false;

  // `blocked`: what to say when something needs a real account (an upload, the model, an outside service).
  constructor(
    private server: DemoServer,
    private blocked: () => string,
  ) {
    server.db.onChange = () => {
      if (this.dirty) return;
      this.dirty = true;
      // After the mutation (or the burst of writes) is done.
      setTimeout(() => {
        this.dirty = false;
        void this.refresh();
      }, 0);
    };
  }

  private async compute(w: Watched) {
    try {
      const value = await this.server.run(w.name, w.args, "query");
      const json = JSON.stringify(value ?? null);
      if (w.done && !w.error && json === w.json) return;
      w.value = value === undefined ? null : value;
      w.json = json;
      w.error = undefined;
    } catch (e) {
      // A query that needs something the demo can't do shows as empty rather than loading forever.
      if (!(e instanceof NeedsAccount)) console.warn("demo query failed", w.name, e);
      w.value = null;
      w.json = "null";
    }
    w.done = true;
    for (const l of [...w.listeners]) l();
  }

  private async refresh() {
    for (const [key, w] of this.watched) {
      if (!w.listeners.size) this.watched.delete(key);
      else await this.compute(w);
    }
  }

  watchQuery(query: AnyRef, args: Args = {}) {
    const name = getFunctionName(query);
    const key = keyOf(name, args);
    let w = this.watched.get(key);
    if (!w) {
      w = { name, args, value: undefined, done: false, listeners: new Set(), json: "" };
      this.watched.set(key, w);
      void this.compute(w);
    }
    const watch = w;
    return {
      onUpdate: (cb: () => void) => {
        watch.listeners.add(cb);
        // A query dropped while nobody watched it starts again for the new watcher.
        if (!this.watched.has(key)) {
          this.watched.set(key, watch);
          void this.compute(watch);
        }
        return () => watch.listeners.delete(cb);
      },
      localQueryResult: () => (watch.done ? watch.value : undefined),
      journal: () => undefined,
    };
  }

  async query(query: AnyRef, args: Args = {}) {
    return await this.call(query, args, "query");
  }

  async mutation(mutation: AnyRef, args: Args = {}) {
    return await this.call(mutation, args, "mutation");
  }

  async action(action: AnyRef, args: Args = {}) {
    return await this.call(action, args, "action");
  }

  private async call(ref: AnyRef, args: Args, kind: "query" | "mutation" | "action") {
    try {
      return await this.server.run(getFunctionName(ref), args, kind);
    } catch (e) {
      // The screen shows this the way it shows any error, and stops its spinner.
      if (e instanceof NeedsAccount) throw new Error(this.blocked());
      throw e;
    }
  }

  // Always "connected", so nothing waits for a connection or queues logs offline.
  connectionState() {
    return { hasInflightRequests: false, isWebSocketConnected: true, timeOfOldestInflightRequest: null, hasEverConnected: true, connectionCount: 1, connectionRetries: 0, inflightMutations: 0, inflightActions: 0 };
  }
  subscribeToConnectionState() {
    return () => {};
  }
  watchPaginatedQuery(): never {
    throw new Error("The example dashboard has no paginated queries.");
  }
  setAuth() {}
  clearAuth() {}
  async close() {}

  // ConvexProvider is typed for the real client; this one has the parts the hooks use.
  asClient() {
    return this as unknown as ConvexReactClient;
  }
}
