import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { runBatches, type BusEvent, type BusPorts, type Handler, type HandlerRegistry } from "../../../supabase/functions/_shared/event-bus/dispatch";
import { buildHandlers } from "../../../supabase/functions/process-events/handlers";

// The bus delivers at least once. A delivery can be repeated after a lost lease, a crash between the effect and the report, or an
// operator replay, and two copies can run at the same time. This runs EVERY handler in the real registry (buildHandlers) through the real
// processor (runBatches) with the same event delivered twice, in sequence and concurrently, at different clock times, and after a failure.
// What it proves: each repeat makes exactly the same database calls with exactly the same arguments, so the database function's own
// idempotency key (the event id, the triage event id, the delivery id) is stable. A handler that put a timestamp, a counter or a random
// value into an argument would pass its single-run unit test and break dedupe on replay; this catches that.
// What it does not prove: that each database function really dedupes on its key. That is the job of the database proofs
// (s10_event_bus.sql, the points and paging proofs) and needs a real database.

type Call = { name: string; args: Record<string, unknown> };

class FakeClient {
  calls: Call[] = [];
  failNext = 0;
  rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.resolve({ data: null, error: { message: "boom" } });
    }
    // Benign answers: a number for the counting functions, an id for create_red_page, nothing found for the context readers.
    const data = name === "create_red_page" ? "page-1" : name === "therapy_run_progress" ? { flagged: false, task_failed: false } : name.startsWith("triage_") ? null : 1;
    return Promise.resolve({ data, error: null });
  }
}

const base = (over: Partial<BusEvent>): BusEvent => ({
  deliveryId: "del-1", leaseToken: "lease-1", attempt: 1, eventId: "ev-1", eventType: "x", eventVersion: 1, organisationId: "org-1", patientId: "pat-1",
  aggregateType: null, aggregateId: null, payload: {}, priority: "normal", isTest: true, occurredAt: "2026-10-27T10:00:00Z",
  subscriberKey: "sub", handlerKey: "k", ...over,
});

// One representative event per handler key. A handler added to the registry with no case here fails the coverage test below.
const CASES: Record<string, BusEvent> = {
  "bus.noop": base({ handlerKey: "bus.noop" }),
  "triage.grade_observation": base({ handlerKey: "triage.grade_observation", eventType: "observation.recorded", aggregateId: "obs-1", payload: { observation_id: "obs-1", kind: "blood_pressure" } }),
  "triage.grade_coverage": base({ handlerKey: "triage.grade_coverage", eventType: "silence.detected", payload: { day: "2026-10-27", days: 7 } }),
  "queue.create_from_triage": base({ handlerKey: "queue.create_from_triage", eventType: "triage.graded", payload: { triage_event_id: "tri-1" } }),
  "lead.clinician_event": base({ handlerKey: "lead.clinician_event", eventType: "clinician.activated", payload: { clinical_staff_id: "staff-1" } }),
  "lead.assign_on_order_paid": base({ handlerKey: "lead.assign_on_order_paid", eventType: "order.paid", payload: { care_pack: true, order_id: "ord-1" } }),
  "paging.create_from_triage": base({ handlerKey: "paging.create_from_triage", eventType: "triage.graded", payload: { triage_event_id: "tri-1" } }),
  "partner.webhook": base({ handlerKey: "partner.webhook", eventType: "lab_result.released", deliveryId: "del-9" }),
  "programme.assess_progress": base({ handlerKey: "programme.assess_progress", eventType: "programme.session_completed", payload: { enrolment_id: "enr-1" } }),
  "points.award": base({ handlerKey: "points.award", eventType: "lesson.completed" }),
};

class MemoryBus implements BusPorts {
  batches: BusEvent[][];
  effects = new Set<string>();
  completed: string[] = [];
  failed: { id: string; permanent: boolean }[] = [];
  constructor(batches: BusEvent[][]) { this.batches = batches; }
  async claim() { return this.batches.shift() ?? []; }
  async complete(id: string) { this.completed.push(id); return true; }
  async fail(id: string, _l: string, _m: string, permanent: boolean) { this.failed.push({ id, permanent }); return permanent ? "dead" : "retry"; }
  async recordEffect(_d: string, key: string) { if (this.effects.has(key)) return false; this.effects.add(key); return true; }
  async releaseEffect(_d: string, key: string) { return this.effects.delete(key); }
  now() { return Date.now(); }
}

const OPTS = { urgentOnly: false, batchSize: 10, maxBatches: 5, budgetMs: 60_000 };
const again = (ev: BusEvent, n: number): BusEvent => ({ ...ev, leaseToken: `${ev.leaseToken}-r${n}`, attempt: ev.attempt + n });
const sig = (calls: Call[]) => JSON.stringify(calls);

afterEach(() => { jest.useRealTimers(); });

describe("every registered handler is safe to deliver twice", () => {
  it("has a redelivery case for every handler in the real registry (a new handler cannot ship without one)", () => {
    const registered = Object.keys(buildHandlers(new FakeClient())).sort();
    expect(Object.keys(CASES).sort()).toEqual(registered);
  });

  for (const [key, ev] of Object.entries(CASES)) {
    describe(key, () => {
      it("sequential repeat: the second delivery makes the same calls with the same arguments, even at a different clock time", async () => {
        const client = new FakeClient();
        const registry = buildHandlers(client);
        jest.useFakeTimers({ now: new Date("2026-10-27T10:00:00Z") });
        await runBatches(new MemoryBus([[ev]]), registry, OPTS);
        const first = client.calls.slice();
        client.calls = [];
        jest.setSystemTime(new Date("2026-10-28T03:17:41Z"));
        await runBatches(new MemoryBus([[again(ev, 1)]]), registry, OPTS);
        expect(sig(client.calls)).toBe(sig(first));
      });

      it("concurrent duplicate in one batch: both copies make the same calls and neither is dead-lettered", async () => {
        const client = new FakeClient();
        const bus = new MemoryBus([[ev, again(ev, 1)]]);
        await runBatches(bus, buildHandlers(client), OPTS);
        expect(bus.failed).toEqual([]);
        expect(bus.completed).toHaveLength(2);
        const half = client.calls.length / 2;
        expect(Number.isInteger(half)).toBe(true);
        expect(sig(client.calls.slice(0, half))).toBe(sig(client.calls.slice(half)));
      });

      it("retry after a database failure: a transient error is retried, never dead-lettered, and the retry repeats the same call", async () => {
        if (key === "bus.noop") return; // makes no call, nothing to fail
        const client = new FakeClient();
        const registry = buildHandlers(client);
        client.failNext = 1;
        const bus = new MemoryBus([[ev]]);
        await runBatches(bus, registry, OPTS);
        const attempted = client.calls.slice();
        expect(attempted.length).toBeGreaterThan(0);
        expect(bus.failed.every((f) => !f.permanent)).toBe(true);
        client.calls = [];
        const bus2 = new MemoryBus([[again(ev, 1)]]);
        await runBatches(bus2, registry, OPTS);
        expect(bus2.completed).toHaveLength(1);
        expect(sig(client.calls.slice(0, attempted.length))).toBe(sig(attempted));
      });
    });
  }

  it("out of order: page and queue requests for one triage event, each delivered twice and mixed, make one distinct call each", async () => {
    const client = new FakeClient();
    const registry = buildHandlers(client);
    const page = CASES["paging.create_from_triage"]!;
    const queue = CASES["queue.create_from_triage"]!;
    await runBatches(new MemoryBus([[page, queue, again(page, 1), again(queue, 1)]]), registry, OPTS);
    const byName = (n: string) => client.calls.filter((c) => c.name === n);
    expect(byName("create_red_page")).toHaveLength(2);
    expect(byName("create_tasks_from_triage_event")).toHaveLength(2);
    expect(new Set(byName("create_red_page").map((c) => sig([c]))).size).toBe(1);
    expect(new Set(byName("create_tasks_from_triage_event").map((c) => sig([c]))).size).toBe(1);
  });
});

describe("the check can fail (sabotage)", () => {
  it("a handler that puts the clock into its database call is caught by the same comparison", async () => {
    const client = new FakeClient();
    const leaky: Handler = async (e) => { await client.rpc("do_thing", { p_event: e.eventId, p_at: Date.now() }); };
    const registry: HandlerRegistry = { leaky };
    const ev = base({ handlerKey: "leaky" });
    jest.useFakeTimers({ now: new Date("2026-10-27T10:00:00Z") });
    await runBatches(new MemoryBus([[ev]]), registry, OPTS);
    const first = client.calls.slice();
    client.calls = [];
    jest.setSystemTime(new Date("2026-10-28T03:17:41Z"));
    await runBatches(new MemoryBus([[again(ev, 1)]]), registry, OPTS);
    expect(sig(client.calls)).not.toBe(sig(first));
  });
});
