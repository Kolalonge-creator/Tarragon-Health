// Test-only in-memory stand-in for a SupabaseClient, covering exactly the
// query-builder surface paystack-webhook/index.ts actually calls: .from(t)
// .{insert,update,select}() chained with .eq/.in/.is/.or/.order/.limit, then
// either awaited directly or terminated with .maybeSingle(). Not imported by
// index.ts itself, so it never ships with the deployed function (Supabase
// bundles from index.ts's own import graph).
//
// This intentionally does NOT try to be a general Postgrest mock — it
// implements only what this one handler uses, and unique-constraint conflict
// simulation for exactly the (provider, provider_event_id) index that
// backs payment_transactions in production (see
// supabase/migrations/20260712201507_payment_transactions.sql), so the
// replay/idempotency tests exercise the same guarantee the real schema
// provides, not a looser one.

export type Row = Record<string, unknown>;

interface TableConfig {
  /** Column sets that must be unique together, mirroring a DB `unique(...)`. */
  uniqueOn?: string[][];
}

type Filter =
  | { type: "eq"; col: string; val: unknown }
  | { type: "in"; col: string; vals: unknown[] }
  | { type: "is"; col: string; val: unknown }
  | { type: "or"; expr: string };

export class FakeSupabaseClient {
  private tables = new Map<string, Row[]>();
  private configs = new Map<string, TableConfig>();

  constructor(configs: Record<string, TableConfig> = {}) {
    for (const [table, config] of Object.entries(configs)) {
      this.configs.set(table, config);
    }
  }

  /** Insert rows directly, bypassing unique-conflict checks — for test setup. */
  seed(table: string, rows: Row[]): void {
    this.ensure(table).push(...rows.map((r) => ({ ...r })));
  }

  /** Snapshot of a table's current rows, for assertions. */
  rows(table: string): Row[] {
    return [...this.ensure(table)];
  }

  private ensure(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  private config(table: string): TableConfig | undefined {
    return this.configs.get(table);
  }

  // deno-lint-ignore no-explicit-any
  from(table: string): any {
    return new FakeQueryBuilder(this.ensure(table), this.config(table));
  }
}

type QueryResult = { data: unknown; error: { code: string; message: string } | null };

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  private op: "select" | "insert" | "update" | null = null;
  private payload: Row | null = null;
  private filters: Filter[] = [];

  constructor(private store: Row[], private config: TableConfig | undefined) {}

  insert(payload: Row) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  select(_cols?: string) {
    if (!this.op) this.op = "select";
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push({ type: "eq", col, val });
    return this;
  }

  in(col: string, vals: unknown[]) {
    this.filters.push({ type: "in", col, vals });
    return this;
  }

  is(col: string, val: unknown) {
    this.filters.push({ type: "is", col, val });
    return this;
  }

  /** Supports Postgrest's "col.eq.value,col2.eq.value2" shape, matching ANY clause. */
  or(expr: string) {
    this.filters.push({ type: "or", expr });
    return this;
  }

  order(_col: string, _opts?: { ascending?: boolean }) {
    this._orderCol = _col;
    this._orderAsc = _opts?.ascending ?? true;
    return this;
  }
  private _orderCol: string | null = null;
  private _orderAsc = true;

  limit(n: number) {
    this._limit = n;
    return this;
  }
  private _limit: number | null = null;

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      switch (f.type) {
        case "eq":
          return row[f.col] === f.val;
        case "in":
          return f.vals.includes(row[f.col]);
        case "is":
          return f.val === null ? row[f.col] == null : row[f.col] === f.val;
        case "or":
          return f.expr.split(",").some((clause) => {
            const [col, , ...rest] = clause.split(".");
            return String(row[col] ?? "") === rest.join(".");
          });
      }
    });
  }

  private selected(): Row[] {
    let result = this.store.filter((r) => this.matches(r));
    if (this._orderCol) {
      const col = this._orderCol;
      result = [...result].sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return this._orderAsc ? cmp : -cmp;
      });
    }
    if (this._limit != null) result = result.slice(0, this._limit);
    return result;
  }

  private doInsert(): QueryResult {
    const row: Row = { id: crypto.randomUUID(), ...this.payload };
    for (const keyCols of this.config?.uniqueOn ?? []) {
      const conflict = this.store.some((r) => keyCols.every((c) => r[c] === row[c]));
      if (conflict) {
        return {
          data: null,
          error: {
            code: "23505",
            message: `duplicate key value violates unique constraint on (${keyCols.join(", ")})`,
          },
        };
      }
    }
    this.store.push(row);
    return { data: row, error: null };
  }

  private doUpdate(): QueryResult {
    const rows = this.selected();
    for (const row of rows) Object.assign(row, this.payload);
    return { data: rows, error: null };
  }

  private execute(): QueryResult {
    if (this.op === "insert") return this.doInsert();
    if (this.op === "update") return this.doUpdate();
    return { data: this.selected(), error: null };
  }

  maybeSingle(): Promise<QueryResult> {
    const result = this.execute();
    if (Array.isArray(result.data)) {
      return Promise.resolve({ data: result.data[0] ?? null, error: result.error });
    }
    return Promise.resolve(result);
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}
