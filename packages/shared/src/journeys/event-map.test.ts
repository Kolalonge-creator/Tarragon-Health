import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_MAP } from "./event-map";
import {
  checkEventMap,
  emittedEventTypes,
  evaluateRow,
  loadSources,
  registeredHandlerKeys,
  registeredSubscribers,
  seededEventTypes,
  type Sources,
} from "./event-map-check";
import { isValidOwner } from "./steps";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const src = loadSources(ROOT);

const byId = (id: string) => EVENT_MAP.find((r) => r.id === id)!;

describe("D.7.2 event map conformance (static, against the real migrations and process-events/handlers.ts)", () => {
  it("every row is either conformant or carries an expected-gap entry that matches reality exactly", () => {
    expect(checkEventMap(src)).toEqual([]);
  });

  it("covers every D.7.2 event (ten rows of the spec table) and the red path spine", () => {
    const specs = EVENT_MAP.map((r) => r.spec).join("\n");
    for (const needle of [
      "blood pressure or glucose",
      "dose confirmed or missed",
      "symptom check completed",
      "consultation completed",
      "lab result received",
      "wearable or device data synced",
      "mood or PHQ-9",
      "pregnancy recorded",
      "payment completed",
      "silence",
    ]) {
      expect(specs).toContain(needle);
    }
    expect(EVENT_MAP.filter((r) => r.spec.startsWith("spine")).length).toBe(2);
  });

  it("every expected gap names a valid owner session and a note, and at least one missing component", () => {
    for (const r of EVENT_MAP) {
      if (!r.gap) continue;
      expect(isValidOwner(r.gap.owner)).toBe(true);
      expect(r.gap.note.length).toBeGreaterThan(20);
      expect(r.gap.missing.length).toBeGreaterThan(0);
    }
  });

  it("the wired rows are really wired: the bus has the triage, queue, paging and lead subscribers with registered handlers", () => {
    const subs = registeredSubscribers(src);
    const handlers = registeredHandlerKeys(src);
    for (const key of ["triage.grade_observation", "queue.create_from_triage", "paging.on_red", "lead.on_order_paid"]) {
      const s = subs.find((x) => x.subscriberKey === key);
      expect(s).toBeDefined();
      expect(handlers.has(s!.handlerKey)).toBe(true);
    }
  });

  it("reads real data: the seeded event types and emitters are non-trivial (guards against a parser that finds nothing)", () => {
    expect(seededEventTypes(src).size).toBeGreaterThan(20);
    expect(emittedEventTypes(src).size).toBeGreaterThan(8);
    expect(registeredSubscribers(src).length).toBeGreaterThanOrEqual(7);
    expect(registeredHandlerKeys(src).size).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Sabotage: prove the check discriminates. Each case damages a copy of the sources and expects a specific finding.
// ---------------------------------------------------------------------------------------------------------------------
function without(s: Sources, patch: Partial<Sources>): Sources {
  return { ...s, ...patch };
}

describe("sabotage: the conformance check notices damage (it does not pass vacuously)", () => {
  it("a subscriber that exists in the migration but is missing from handlers.ts counts as broken", () => {
    const damaged = without(src, { handlersTs: src.handlersTs.replace(/^\s*\[TRIAGE_HANDLER_KEY\].*$/m, "") });
    const ev = evaluateRow(byId("bp-reading-logged"), damaged);
    expect(ev.missing).toContain("subscriber");
    expect(checkEventMap(damaged).map((f) => f.rowId)).toContain("bp-reading-logged");
  });

  it("removing the emitter of a wired event is a finding", () => {
    const damaged = without(src, {
      migrations: src.migrations.map((m) => ({ ...m, text: m.text.replace(/emit_domain_event\(\s*'order\.paid'/g, "emit_domain_event('order.paid_x'") })),
    });
    expect(evaluateRow(byId("payment-completed"), damaged).missing).toContain("emitter");
  });

  it("a handler whose RPC is no longer called from its port counts as having no effect", () => {
    const damaged = without(src, { portsTs: src.portsTs.replace(/create_red_page/g, "something_else") });
    expect(evaluateRow(byId("spine-triage-graded-to-page"), damaged).missing).toContain("effect");
  });

  it("a gap that starts passing must fail the test until the registry entry is removed (shrink only)", () => {
    // Give dose.recorded an emitter by adding a fake migration that emits it.
    const fake = {
      name: "99999999999999_fake.sql",
      text: "select private.emit_domain_event('dose.recorded', null, '{}'::jsonb, 'k');",
    };
    const damaged = without(src, { migrations: [...src.migrations, fake] });
    const findings = checkEventMap(damaged);
    const f = findings.find((x) => x.rowId === "dose-recorded");
    expect(f?.kind).toBe("gap-closed");
  });

  it("a gap that gets worse is a finding too", () => {
    const damaged = without(src, {
      migrations: src.migrations.map((m) => ({ ...m, text: m.text.replace(/emit_domain_event\(\s*'encounter\.completed'/g, "emit_domain_event('encounter.completed_x'") })),
    });
    const f = checkEventMap(damaged).find((x) => x.rowId === "consultation-completed");
    expect(f?.kind).toBe("gap-changed");
  });

  it("a row with no gap entry that is not conformant names no owner and is a finding", () => {
    const rows = EVENT_MAP.map((r) => (r.id === "dose-recorded" ? { ...r, gap: undefined } : r));
    const f = checkEventMap(src, rows).find((x) => x.rowId === "dose-recorded");
    expect(f?.kind).toBe("unexpected-gap");
  });

  it("a duplicate row id is a finding", () => {
    const f = checkEventMap(src, [...EVENT_MAP, EVENT_MAP[0]!]).find((x) => x.kind === "duplicate-row");
    expect(f).toBeDefined();
  });
});

describe("the SQL proof and this registry agree", () => {
  const sql = readFileSync(join(ROOT, "packages", "db", "tests", "s85_event_map_conformance.sql"), "utf8");
  const listed = (tag: string): string[] => {
    const line = sql.split("\n").find((l) => l.startsWith(`-- ${tag}:`));
    expect(line).toBeDefined();
    return line!.replace(`-- ${tag}:`, "").split(",").map((s) => s.trim()).filter(Boolean).sort();
  };
  const typesWhere = (c: "event_type" | "subscriber"): string[] =>
    [...new Set(EVENT_MAP.filter((r) => r.gap?.missing.includes(c)).map((r) => r.eventType))].sort();

  it("the gap types with no subscriber listed in packages/db/tests/s85_event_map_conformance.sql equal this registry's", () => {
    expect(listed("REGISTRY-GAP-TYPES-NO-SUBSCRIBER")).toEqual(typesWhere("subscriber"));
  });

  it("the gap types with no event type listed in the SQL proof equal this registry's", () => {
    expect(listed("REGISTRY-GAP-TYPES-NO-TYPE")).toEqual(typesWhere("event_type"));
  });
});
