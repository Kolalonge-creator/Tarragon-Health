// S85: static conformance check of the event map against the real repository sources.
//
// Reads supabase/migrations/*.sql, supabase/functions/process-events/handlers.ts, its *-ports.ts files and the handler
// key constants under supabase/functions/_shared. Pure functions over a `Sources` value so a test can sabotage the sources
// (delete a handler registration, rename an event type) and prove the check notices.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EVENT_MAP, SPINE_SUBSCRIBERS, type Component, type EventMapRow } from "./event-map";

export interface Sources {
  readonly migrations: ReadonlyArray<{ readonly name: string; readonly text: string }>;
  /** supabase/functions/process-events/handlers.ts */
  readonly handlersTs: string;
  /** Concatenated process-events/*-ports.ts (where a handler's RPC calls live). */
  readonly portsTs: string;
  /** Concatenated supabase/functions/_shared/**.ts, for the handler key constants. */
  readonly sharedTs: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

export function loadSources(repoRoot: string): Sources {
  const migDir = join(repoRoot, "supabase", "migrations");
  const migrations = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(migDir, name), "utf8") }));
  const pe = join(repoRoot, "supabase", "functions", "process-events");
  const portsTs = readdirSync(pe)
    .filter((f) => /-ports\.ts$/.test(f))
    .map((f) => readFileSync(join(pe, f), "utf8"))
    .join("\n");
  const sharedTs = walk(join(repoRoot, "supabase", "functions", "_shared"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  return { migrations, handlersTs: readFileSync(join(pe, "handlers.ts"), "utf8"), portsTs, sharedTs };
}

export interface SubscriberRow {
  readonly subscriberKey: string;
  readonly eventType: string;
  readonly handlerKey: string;
  readonly migration: string;
}

/** Every event type a migration inserts into public.event_types. */
export function seededEventTypes(src: Sources): Set<string> {
  const out = new Set<string>();
  for (const m of src.migrations) {
    const re = /insert\s+into\s+public\.event_types\b[^;]*?;/gis;
    for (const stmt of m.text.match(re) ?? []) {
      for (const t of stmt.matchAll(/\(\s*'([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)'\s*,\s*'/g)) out.add(t[1]!);
    }
  }
  return out;
}

/** Every `private.emit_domain_event('<type>'` call. The type may be on the next line. */
export function emittedEventTypes(src: Sources): Set<string> {
  const out = new Set<string>();
  for (const m of src.migrations) {
    for (const t of m.text.matchAll(/emit_domain_event\(\s*'([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)'/g)) out.add(t[1]!);
  }
  return out;
}

/** Every subscriber a migration registers (subscriber_key, event_type, handler_key, ...). */
export function registeredSubscribers(src: Sources): SubscriberRow[] {
  const out: SubscriberRow[] = [];
  for (const m of src.migrations) {
    const re = /insert\s+into\s+public\.event_subscribers\s*\(([^)]*)\)\s*(values[\s\S]*?);/gi;
    for (const stmt of m.text.matchAll(re)) {
      const cols = stmt[1]!.split(",").map((c) => c.trim());
      if (cols[0] !== "subscriber_key" || cols[1] !== "event_type" || cols[2] !== "handler_key") continue;
      for (const t of stmt[2]!.matchAll(/\(\s*'([a-z][a-z0-9_.]*)'\s*,\s*'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'\s*,\s*'([a-z][a-z0-9_.]*)'/g)) {
        out.push({ subscriberKey: t[1]!, eventType: t[2]!, handlerKey: t[3]!, migration: m.name });
      }
    }
  }
  return out;
}

/** The handler keys registered in process-events/handlers.ts, with constants resolved from _shared. */
export function registeredHandlerKeys(src: Sources): Set<string> {
  const consts = new Map<string, string>();
  for (const c of src.sharedTs.matchAll(/export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"/g)) consts.set(c[1]!, c[2]!);
  const body = src.handlersTs.slice(src.handlersTs.indexOf("return {"));
  const out = new Set<string>();
  for (const k of body.matchAll(/^\s*(?:"([^"]+)"|\[([A-Z][A-Z0-9_]*)\])\s*:/gm)) {
    if (k[1]) out.add(k[1]);
    else if (k[2] && consts.has(k[2])) out.add(consts.get(k[2])!);
  }
  return out;
}

/** True when some migration defines `function (public|private).<name>`. */
export function rpcDefined(src: Sources, name: string): boolean {
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public|private)\\.${name}\\s*\\(`, "i");
  return src.migrations.some((m) => re.test(m.text));
}

export interface RowEvaluation {
  readonly row: EventMapRow;
  readonly missing: readonly Component[];
}

export function evaluateRow(row: EventMapRow, src: Sources): RowEvaluation {
  const missing: Component[] = [];
  const types = seededEventTypes(src);
  if (!types.has(row.eventType)) missing.push("event_type");
  if (!emittedEventTypes(src).has(row.eventType)) missing.push("emitter");

  const wanted = SPINE_SUBSCRIBERS[row.id];
  const subs = registeredSubscribers(src).filter(
    (s) => s.eventType === row.eventType && (wanted === undefined || s.subscriberKey === wanted),
  );
  const handlers = registeredHandlerKeys(src);
  const live = subs.filter((s) => handlers.has(s.handlerKey));
  if (live.length === 0) missing.push("subscriber");

  const effectOk =
    row.effectRpc !== undefined &&
    live.length > 0 &&
    rpcDefined(src, row.effectRpc) &&
    new RegExp(`["'\`]${row.effectRpc}["'\`]`).test(src.portsTs);
  if (!effectOk) missing.push("effect");
  return { row, missing };
}

export interface Finding {
  readonly rowId: string;
  readonly kind: "unexpected-gap" | "gap-closed" | "gap-changed" | "duplicate-row";
  readonly detail: string;
}

/**
 * Compare reality to the registry. The registry may only shrink, so:
 *   - a conformant row with a gap entry is a finding (the entry must be removed),
 *   - a row with fewer missing components than its entry says is a finding (shrink the entry),
 *   - a row with more or different missing components than its entry says is a finding (a regression).
 */
export function checkEventMap(src: Sources, rows: readonly EventMapRow[] = EVENT_MAP): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) findings.push({ rowId: row.id, kind: "duplicate-row", detail: "row id used twice" });
    seen.add(row.id);
    const { missing } = evaluateRow(row, src);
    const declared = [...(row.gap?.missing ?? [])].sort();
    const actual = [...missing].sort();
    if (JSON.stringify(declared) === JSON.stringify(actual)) continue;
    if (!row.gap) {
      findings.push({ rowId: row.id, kind: "unexpected-gap", detail: `missing ${actual.join(", ")} and no expected-gap entry names an owner` });
    } else if (actual.length === 0) {
      findings.push({ rowId: row.id, kind: "gap-closed", detail: `now conformant: remove its expected-gap entry (owner ${row.gap.owner})` });
    } else if (actual.every((c) => declared.includes(c))) {
      findings.push({ rowId: row.id, kind: "gap-closed", detail: `part of the gap closed: registry says ${declared.join(", ")}, found ${actual.join(", ")}; shrink the entry` });
    } else {
      findings.push({ rowId: row.id, kind: "gap-changed", detail: `registry says ${declared.join(", ")}, found ${actual.join(", ")}` });
    }
  }
  return findings;
}
