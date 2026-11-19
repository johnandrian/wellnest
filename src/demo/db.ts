// A small in-memory stand-in for the Convex database, so the example dashboard (/demo) can run the app's own query
// and mutation code (convex/*.ts) in the browser on made-up data. It covers what that code uses: get, insert, patch,
// replace, delete, and queries with indexes, order, filter, take, first, unique, collect, and paginate. Nothing is
// sent anywhere; a reload starts over.

type Doc = Record<string, unknown> & { _id: string; _creationTime: number };
type Index = { indexDescriptor: string; fields: string[] };
type Tables = Record<string, { indexes?: Index[]; searchIndexes?: { indexDescriptor: string; searchField: string }[] }>;

// Convex's order across types: undefined, null, numbers, booleans, strings, then everything else.
function rank(x: unknown) {
  if (x === undefined) return 0;
  if (x === null) return 1;
  if (typeof x === "number" || typeof x === "bigint") return 2;
  if (typeof x === "boolean") return 3;
  if (typeof x === "string") return 4;
  return 5;
}

export function compare(a: unknown, b: unknown): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 2 || ra === 4) return a! < b! ? -1 : a! > b! ? 1 : 0;
  if (ra === 3) return Number(a) - Number(b);
  if (ra === 5) return JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;
  return 0;
}

const field = (doc: Doc, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], doc);
const copy = <T>(x: T): T => (x === null || x === undefined ? x : structuredClone(x));

// The builder passed to withIndex: equalities on the first fields, then at most one range on the next.
class IndexRange {
  checks: ((doc: Doc) => boolean)[] = [];
  private add(f: string, test: (c: number) => boolean, value: unknown) {
    this.checks.push((doc) => test(compare(field(doc, f), value)));
    return this;
  }
  eq(f: string, v: unknown) {
    return this.add(f, (c) => c === 0, v);
  }
  gt(f: string, v: unknown) {
    return this.add(f, (c) => c > 0, v);
  }
  gte(f: string, v: unknown) {
    return this.add(f, (c) => c >= 0, v);
  }
  lt(f: string, v: unknown) {
    return this.add(f, (c) => c < 0, v);
  }
  lte(f: string, v: unknown) {
    return this.add(f, (c) => c <= 0, v);
  }
}

// The builder passed to filter(): expressions are functions of the document.
type Expr = (doc: Doc) => unknown;
const ex = (x: unknown): Expr => (typeof x === "function" ? (x as Expr) : () => x);
const filterBuilder = {
  field: (f: string): Expr => (doc) => field(doc, f),
  eq: (a: unknown, b: unknown): Expr => (d) => compare(ex(a)(d), ex(b)(d)) === 0,
  neq: (a: unknown, b: unknown): Expr => (d) => compare(ex(a)(d), ex(b)(d)) !== 0,
  lt: (a: unknown, b: unknown): Expr => (d) => compare(ex(a)(d), ex(b)(d)) < 0,
  lte: (a: unknown, b: unknown): Expr => (d) => compare(ex(a)(d), ex(b)(d)) <= 0,
  gt: (a: unknown, b: unknown): Expr => (d) => compare(ex(a)(d), ex(b)(d)) > 0,
  gte: (a: unknown, b: unknown): Expr => (d) => compare(ex(a)(d), ex(b)(d)) >= 0,
  and: (...xs: unknown[]): Expr => (d) => xs.every((x) => ex(x)(d)),
  or: (...xs: unknown[]): Expr => (d) => xs.some((x) => ex(x)(d)),
  not: (x: unknown): Expr => (d) => !ex(x)(d),
};

class Query {
  private checks: ((doc: Doc) => boolean)[] = [];
  private sortFields = ["_creationTime"];
  private desc = false;
  private search: { field: string; text: string } | null = null;

  constructor(
    private db: MemoryDb,
    private table: string,
  ) {}

  withIndex(name: string, range?: (q: IndexRange) => IndexRange) {
    const index = this.db.index(this.table, name);
    this.sortFields = [...index, "_creationTime"];
    if (range) this.checks.push(...range(new IndexRange()).checks);
    return this;
  }

  withSearchIndex(name: string, build: (q: unknown) => unknown) {
    const searchField = this.db.searchField(this.table, name);
    const ranges: IndexRange & { search?: (f: string, text: string) => unknown } = new IndexRange();
    ranges.search = (f: string, text: string) => {
      this.search = { field: f || searchField, text: text.toLowerCase() };
      return ranges;
    };
    build(ranges);
    this.checks.push(...ranges.checks);
    return this;
  }

  order(dir: "asc" | "desc") {
    this.desc = dir === "desc";
    return this;
  }

  filter(build: (q: typeof filterBuilder) => unknown) {
    const e = ex(build(filterBuilder));
    this.checks.push((doc) => !!e(doc));
    return this;
  }

  private rows(): Doc[] {
    let rows = this.db.rows(this.table).filter((doc) => this.checks.every((c) => c(doc)));
    if (this.search) {
      const { field: f, text } = this.search;
      const words = text.split(/\s+/).filter(Boolean);
      rows = rows.filter((doc) => words.some((w) => String(field(doc, f) ?? "").toLowerCase().includes(w)));
    }
    rows.sort((a, b) => {
      for (const f of this.sortFields) {
        const c = compare(field(a, f), field(b, f));
        if (c) return this.desc ? -c : c;
      }
      return 0;
    });
    return rows.map(copy);
  }

  async collect() {
    return this.rows();
  }
  async take(n: number) {
    return this.rows().slice(0, n);
  }
  async first() {
    return this.rows()[0] ?? null;
  }
  async unique() {
    const rows = this.rows();
    if (rows.length > 1) throw new Error(`unique() found ${rows.length} documents in ${this.table}`);
    return rows[0] ?? null;
  }
  async paginate({ numItems, cursor }: { numItems: number; cursor: string | null }) {
    const rows = this.rows();
    const start = cursor ? Number(cursor) : 0;
    const page = rows.slice(start, start + numItems);
    const end = start + page.length;
    return { page, isDone: end >= rows.length, continueCursor: String(end) };
  }
  async *[Symbol.asyncIterator]() {
    for (const row of this.rows()) yield row;
  }
}

export class MemoryDb {
  private tables = new Map<string, Map<string, Doc>>();
  private tableOf = new Map<string, string>();
  private next = 1;
  private lastTime = 0;
  // Called after every write, so the demo client knows to refresh what's on screen.
  onChange: () => void = () => {};

  constructor(private schema: Tables) {}

  index(table: string, name: string): string[] {
    if (name === "by_creation_time") return [];
    if (name === "by_id") return ["_id"];
    const index = this.schema[table]?.indexes?.find((i) => i.indexDescriptor === name);
    if (!index) throw new Error(`No index ${name} on ${table}`);
    return index.fields;
  }

  searchField(table: string, name: string): string {
    return this.schema[table]?.searchIndexes?.find((i) => i.indexDescriptor === name)?.searchField ?? "text";
  }

  rows(table: string): Doc[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  }

  private stamp() {
    // Creation times only go up, so rows made in the same millisecond keep their order.
    this.lastTime = Math.max(Date.now(), this.lastTime + 0.001);
    return this.lastTime;
  }

  private find(id: string) {
    const table = this.tableOf.get(id);
    return table ? this.tables.get(table)?.get(id) : undefined;
  }

  // The documented forms: get(id) and the newer get(table, id) (same for patch, replace, delete).
  private idArg(args: unknown[]): [string, unknown[]] {
    if (typeof args[0] === "string" && this.schema[args[0]] && typeof args[1] === "string") return [args[1], args.slice(2)];
    return [args[0] as string, args.slice(1)];
  }

  // Seeding: rows at a chosen creation time, in the order given.
  seed(table: string, value: Record<string, unknown>, createdAt: number) {
    const _id = `${this.next++}${table}`;
    if (!this.tables.has(table)) this.tables.set(table, new Map());
    this.tables.get(table)!.set(_id, { ...copy(value), _id, _creationTime: createdAt });
    this.tableOf.set(_id, table);
    return _id;
  }

  readonly reader = {
    get: async (...args: unknown[]) => {
      const [id] = this.idArg(args);
      return copy(this.find(id) ?? null);
    },
    query: (table: string) => new Query(this, table),
    normalizeId: (table: string, id: string) => (this.tableOf.get(id) === table ? id : null),
    system: {
      get: async () => null,
      query: () => new Query(this, "_storage"),
    },
  };

  readonly writer = {
    ...this.reader,
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = this.seed(table, stripUndefined(value), this.stamp());
      this.onChange();
      return id;
    },
    patch: async (...args: unknown[]) => {
      const [id, [fields]] = this.idArg(args);
      const doc = this.find(id);
      if (!doc) throw new Error("Not found");
      for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
        if (k === "_id" || k === "_creationTime") continue;
        if (v === undefined) delete doc[k];
        else doc[k] = copy(v);
      }
      this.onChange();
    },
    replace: async (...args: unknown[]) => {
      const [id, [value]] = this.idArg(args);
      const doc = this.find(id);
      if (!doc) throw new Error("Not found");
      const table = this.tableOf.get(id)!;
      this.tables.get(table)!.set(id, { ...stripUndefined(copy(value as Record<string, unknown>)), _id: id, _creationTime: doc._creationTime });
      this.onChange();
    },
    delete: async (...args: unknown[]) => {
      const [id] = this.idArg(args);
      const table = this.tableOf.get(id);
      if (table) this.tables.get(table)?.delete(id);
      this.tableOf.delete(id);
      this.onChange();
    },
  };
}

function stripUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
