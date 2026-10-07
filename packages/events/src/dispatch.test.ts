import { describe, expect, it, jest } from "@jest/globals";
import {
  noopHandler,
  PermanentHandlerError,
  runBatches,
  type BusEvent,
  type BusPorts,
  type Handler,
  type HandlerRegistry,
  type RunOptions,
} from "./index";

function ev(n: number, handlerKey = "h.ok"): BusEvent {
  return {
    deliveryId: `d${n}`, leaseToken: `l${n}`, attempt: 1, eventId: `e${n}`, eventType: "observation.recorded", eventVersion: 1,
    organisationId: "o", patientId: "p", aggregateType: null, aggregateId: null, payload: { observation_id: `${n}` },
    priority: "normal", isTest: true, occurredAt: "2026-10-05T00:00:00Z", subscriberKey: "s.a", handlerKey,
  };
}

const OPTS: RunOptions = { urgentOnly: false, batchSize: 3, maxBatches: 5, budgetMs: 1000 };

function ports(batches: BusEvent[][], over: Partial<BusPorts> = {}): BusPorts & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { complete: [], fail: [], recordEffect: [], releaseEffect: [], claim: [] };
  const queue = [...batches];
  const base: BusPorts = {
    claim: async (...a) => { calls.claim.push(a); return queue.shift() ?? []; },
    complete: async (...a) => { calls.complete.push(a); return true; },
    fail: async (...a) => { calls.fail.push(a); return a[3] ? "dead" : "pending"; },
    recordEffect: async (...a) => { calls.recordEffect.push(a); return true; },
    releaseEffect: async (...a) => { calls.releaseEffect.push(a); return true; },
    now: () => 0,
  };
  return Object.assign({ ...base, ...over }, { calls });
}

const ok: Handler = async () => {};
const handlers: HandlerRegistry = { "h.ok": ok };

describe("runBatches", () => {
  it("runs the handler and completes each delivery once", async () => {
    const seen: string[] = [];
    const p = ports([[ev(1), ev(2)]]);
    const s = await runBatches(p, { "h.ok": async (e) => { seen.push(e.deliveryId); } }, OPTS);
    expect(seen).toEqual(["d1", "d2"]);
    expect(p.calls.complete).toEqual([["d1", "l1"], ["d2", "l2"]]);
    expect(s).toMatchObject({ batches: 1, claimed: 2, done: 2, retried: 0, dead: 0 });
  });

  it("does nothing when the queue is empty", async () => {
    const s = await runBatches(ports([]), handlers, OPTS);
    expect(s).toMatchObject({ batches: 0, claimed: 0, claimFailed: false });
  });

  it("keeps claiming while batches come back full, and stops on a short one", async () => {
    const p = ports([[ev(1), ev(2), ev(3)], [ev(4)], [ev(5)]]);
    const s = await runBatches(p, handlers, OPTS);
    expect(s.batches).toBe(2);
    expect(s.done).toBe(4);
    expect(p.calls.claim).toHaveLength(2);
  });

  it("stops at the batch cap", async () => {
    const full = () => [ev(1), ev(2), ev(3)];
    const p = ports([full(), full(), full()]);
    const s = await runBatches(p, handlers, { ...OPTS, maxBatches: 2 });
    expect(s.batches).toBe(2);
  });

  it("stops starting batches when the time budget is spent", async () => {
    let t = 0;
    const p = ports([[ev(1), ev(2), ev(3)], [ev(4), ev(5), ev(6)]], { now: () => (t += 600) });
    const s = await runBatches(p, handlers, OPTS);
    expect(s.batches).toBe(1);
  });

  it("passes urgent_only and the batch size to the claim", async () => {
    const p = ports([]);
    await runBatches(p, handlers, { ...OPTS, urgentOnly: true });
    expect(p.calls.claim[0]).toEqual([3, true]);
  });

  it("an ordinary error is reported as a retry, with the message and no payload", async () => {
    const p = ports([[ev(1)]]);
    const s = await runBatches(p, { "h.ok": async () => { throw new Error("db down"); } }, OPTS);
    expect(p.calls.fail[0]).toEqual(["d1", "l1", "Error: db down", false]);
    expect(s).toMatchObject({ retried: 1, dead: 0, done: 0 });
    expect(p.calls.complete).toHaveLength(0);
  });

  it("a PermanentHandlerError goes straight to the dead letter", async () => {
    const p = ports([[ev(1)]]);
    const s = await runBatches(p, { "h.ok": async () => { throw new PermanentHandlerError("bad payload"); } }, OPTS);
    expect(p.calls.fail[0]).toEqual(["d1", "l1", "PermanentHandlerError: bad payload", true]);
    expect(s.dead).toBe(1);
  });

  it("a non-Error throw is still recorded", async () => {
    const p = ports([[ev(1)]]);
    await runBatches(p, { "h.ok": async () => { throw "plain text"; } }, OPTS);
    expect(p.calls.fail[0][2]).toBe("plain text");
  });

  it("truncates a very long error", async () => {
    const p = ports([[ev(1)]]);
    await runBatches(p, { "h.ok": async () => { throw new Error("x".repeat(5000)); } }, OPTS);
    expect((p.calls.fail[0][2] as string).length).toBe(500);
  });

  it("a delivery with no registered handler is dead-lettered, not dropped", async () => {
    const p = ports([[ev(1, "h.missing")]]);
    const s = await runBatches(p, handlers, OPTS);
    expect(p.calls.fail[0]).toEqual(["d1", "l1", "no handler registered for h.missing", true]);
    expect(s.dead).toBe(1);
  });

  it("a handler key like constructor or toString is not a handler", async () => {
    const p = ports([[ev(1, "constructor"), ev(2, "toString")]]);
    const s = await runBatches(p, handlers, OPTS);
    expect(s.dead).toBe(2);
  });

  it("a lost lease on complete is counted, not an error", async () => {
    const p = ports([[ev(1)]], { complete: async () => false });
    const s = await runBatches(p, handlers, OPTS);
    expect(s).toMatchObject({ done: 0, lostLease: 1, errors: 0 });
  });

  it("a stale answer on fail is counted as a lost lease", async () => {
    const p = ports([[ev(1), ev(2, "h.missing")]], { fail: async () => "stale" });
    const s = await runBatches(p, { "h.ok": async () => { throw new Error("x"); } }, OPTS);
    expect(s.lostLease).toBe(2);
    expect(s.dead + s.retried).toBe(0);
  });

  it("a failure to report the outcome does not stop the batch", async () => {
    const log = jest.fn();
    let n = 0;
    const p = ports([[ev(1), ev(2)]], {
      complete: async () => { if (n++ === 0) throw new Error("network"); return true; },
      log,
    });
    const s = await runBatches(p, handlers, OPTS);
    expect(s).toMatchObject({ done: 1, errors: 1 });
    expect(log).toHaveBeenCalledWith("error", "could not record a delivery outcome", expect.objectContaining({ deliveryId: "d1" }));
  });

  it("a failed claim is reported and ends the run", async () => {
    const log = jest.fn();
    const s = await runBatches(ports([], { claim: async () => { throw new Error("rpc"); }, log }), handlers, OPTS);
    expect(s.claimFailed).toBe(true);
    expect(log).toHaveBeenCalledWith("error", "claim failed", { error: "Error: rpc" });
  });

  it("a failed claim with no logger does not throw", async () => {
    const s = await runBatches(ports([], { claim: async () => { throw new Error("rpc"); } }), handlers, OPTS);
    expect(s.claimFailed).toBe(true);
  });

  it("logs when anything went to the dead letter", async () => {
    const log = jest.fn();
    await runBatches(ports([[ev(1, "h.missing")]], { log }), handlers, OPTS);
    expect(log).toHaveBeenCalledWith("error", "deliveries went to the dead letter", { dead: 1 });
  });
});

describe("ctx.once", () => {
  it("runs the effect the first time and not on a repeat", async () => {
    const fn = jest.fn(async () => {});
    const results: boolean[] = [];
    let first = true;
    const asked: unknown[][] = [];
    const p = ports([[ev(1)]], { recordEffect: async (...a) => { asked.push(a); const r = first; first = false; return r; } });
    await runBatches(p, { "h.ok": async (_e, ctx) => { results.push(await ctx.once("notify", fn)); results.push(await ctx.once("notify", fn)); } }, OPTS);
    expect(results).toEqual([true, false]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(asked[0]).toEqual(["d1", "e1:s.a:notify"]);
  });

  it("releases the record when the effect throws, so the retry runs it again", async () => {
    const p = ports([[ev(1)]]);
    const s = await runBatches(p, { "h.ok": async (_e, ctx) => { await ctx.once("notify", async () => { throw new Error("provider"); }); } }, OPTS);
    expect(p.calls.releaseEffect[0]).toEqual(["d1", "e1:s.a:notify"]);
    expect(s.retried).toBe(1);
  });
});

describe("noopHandler", () => {
  it("resolves without doing anything", async () => {
    await expect(noopHandler(ev(1), { once: async () => true })).resolves.toBeUndefined();
  });
});
