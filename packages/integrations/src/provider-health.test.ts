import { describe, expect, it } from "@jest/globals";
import {
  countsAsOutage, createMockEmail, createMockPayment, fail, guardedCall, ok, supabaseHealthStore, withEmailBreaker, withPaymentBreaker,
  type HealthStore,
} from "../../../supabase/functions/_shared/integrations/index.ts";
import { syncSettlements } from "../../../supabase/functions/_shared/integrations/index.ts";

/** The same rules as provider_call_allowed / provider_record_result in the database, in memory. */
function memoryHealth(threshold = 3): HealthStore & { state(): string; log: string[]; down: boolean } {
  let failures = 0;
  let open = false;
  const log: string[] = [];
  const self = {
    log,
    down: false,
    state: () => (open ? "open" : "closed"),
    async allowed() {
      if (self.down) return fail("network", "store down");
      return ok({ allowed: !open, state: open ? "open" : "closed" });
    },
    async record(_p: string, _o: string, succeeded: boolean, code?: string) {
      log.push(`${succeeded ? "ok" : "fail"}${code ? `:${code}` : ""}`);
      if (succeeded) { failures = 0; open = false; } else { failures += 1; if (failures >= threshold) open = true; }
      return ok(open ? "open" : "closed");
    },
  };
  return self;
}

describe("countsAsOutage", () => {
  it("counts outages and not a request that was simply wrong", () => {
    for (const c of ["network", "timeout", "vendor_error", "bad_response", "unauthorized"] as const) expect(countsAsOutage(c)).toBe(true);
    for (const c of ["invalid_input", "conflict", "not_found", "blocked_content", "suppressed", "consent_required", "not_configured", "circuit_open"] as const) expect(countsAsOutage(c)).toBe(false);
  });
});

describe("guardedCall", () => {
  it("calls straight through with no health store", async () => {
    expect(await guardedCall(null, "paystack", "initialize", async () => ok(1))).toEqual({ ok: true, data: 1 });
  });

  it("records a success, an outage and a plain rejection differently", async () => {
    const h = memoryHealth(99);
    await guardedCall(h, "paystack", "initialize", async () => ok(1));
    await guardedCall(h, "paystack", "initialize", async () => fail("timeout", "slow"));
    await guardedCall(h, "paystack", "initialize", async () => fail("invalid_input", "bad email"));
    expect(h.log).toEqual(["ok", "fail:timeout", "ok:invalid_input"]);
  });

  it("opens after the threshold and then does not call the provider at all", async () => {
    const h = memoryHealth(3);
    let called = 0;
    const down = async () => { called += 1; return fail("network", "down"); };
    for (let i = 0; i < 3; i++) await guardedCall(h, "resend", "send", down);
    expect(h.state()).toBe("open");
    const blocked = await guardedCall(h, "resend", "send", down);
    expect(called).toBe(3);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatchObject({ code: "circuit_open", retryable: true });
  });

  it("fails OPEN when the health store itself is unreachable: the call goes ahead", async () => {
    const h = memoryHealth();
    h.down = true;
    expect(await guardedCall(h, "paystack", "initialize", async () => ok("sent"))).toEqual({ ok: true, data: "sent" });
  });
});

describe("the wrappers", () => {
  it("guards checkout initialisation only: a refund, a verify and a transfer still pass through an open breaker", async () => {
    const pay = createMockPayment();
    const h = memoryHealth(1);
    const guarded = withPaymentBreaker(pay, h);
    pay.failNextCall();
    expect((await guarded.initializeTransaction({ reference: "chg-open-0001", email: "a@example.com", amountKobo: 100_000 })).ok).toBe(false);
    expect(h.state()).toBe("open");
    const blocked = await guarded.initializeTransaction({ reference: "chg-open-0002", email: "a@example.com", amountKobo: 100_000 });
    expect(!blocked.ok && blocked.error.code).toBe("circuit_open");
    // the mock never saw the second reference, so it can still be used afterwards
    expect((await pay.verifyTransaction("chg-open-0002")).ok).toBe(false);
    expect((await guarded.verifyTransaction("chg-open-0001")).ok).toBe(false); // passes through (not found at the provider), not circuit_open
    expect(withPaymentBreaker(pay, null)).toBe(pay);
  });

  it("guards email sends and leaves the rest alone", async () => {
    const mail = createMockEmail();
    const h = memoryHealth(1);
    const guarded = withEmailBreaker(mail, h);
    mail.failNextCall();
    const input = { to: "a@example.com", subject: "Hello", text: "Your visit is booked.", audience: "staff" as const, idempotencyKey: "k-1" };
    expect((await guarded.send(input)).ok).toBe(false);
    expect(h.state()).toBe("open");
    const blocked = await guarded.send({ ...input, idempotencyKey: "k-2" });
    expect(!blocked.ok && blocked.error.code).toBe("circuit_open");
    expect(mail.outbox).toHaveLength(0);
    expect(withEmailBreaker(mail, null)).toBe(mail);
  });
});

describe("supabaseHealthStore", () => {
  const client = (reply: (fn: string) => { data: unknown; error: { message: string } | null }) => ({ rpc: (fn: string) => Promise.resolve(reply(fn)) });
  it("reads the gate and records results", async () => {
    const s = supabaseHealthStore(client((fn) => (fn === "provider_call_allowed" ? { data: { allowed: false, state: "open" }, error: null } : { data: "open", error: null })));
    expect(await s.allowed("paystack", "initialize")).toEqual({ ok: true, data: { allowed: false, state: "open" } });
    expect(await s.record("paystack", "initialize", false, "timeout")).toEqual({ ok: true, data: "open" });
    expect(await supabaseHealthStore(client(() => ({ data: { allowed: true }, error: null }))).allowed("a", "b")).toEqual({ ok: true, data: { allowed: true, state: "closed" } });
    expect(await supabaseHealthStore(client(() => ({ data: 5, error: null }))).record("a", "b", true)).toEqual({ ok: true, data: "unknown" });
  });
  it("answers a failure value for an error, a bad reply and a throw", async () => {
    expect((await supabaseHealthStore(client(() => ({ data: null, error: { message: "x" } }))).allowed("a", "b")).ok).toBe(false);
    expect((await supabaseHealthStore(client(() => ({ data: "no", error: null }))).allowed("a", "b")).ok).toBe(false);
    expect((await supabaseHealthStore(client(() => ({ data: null, error: { message: "x" } }))).record("a", "b", true)).ok).toBe(false);
    const thrower = supabaseHealthStore({ rpc: () => { throw new Error("socket"); } });
    expect((await thrower.allowed("a", "b")).ok).toBe(false);
    expect((await thrower.record("a", "b", false)).ok).toBe(false);
  });
});

describe("syncSettlements (read only reconciliation)", () => {
  const db = () => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    return { calls, rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      const data = fn === "record_settlement_report" ? `report-${args?.["p_settlement_id"]}` : fn === "reconcile_settlement_report" ? { matched: 1, open_breaks: 2 } : 3;
      return Promise.resolve({ data, error: null });
    } };
  };

  it("stores every settlement with its lines, compares each, then looks for unsettled charges; it only reads from the provider", async () => {
    const pay = createMockPayment();
    pay.addSettlement(11, 500_000, 7_500, [{ reference: "chg-sync-0001", amountKobo: 500_000, feesKobo: 7_500 }]);
    pay.addSettlement(12, 300_000, 0, [{ reference: "chg-sync-0002", amountKobo: 200_000 }, { reference: "chg-sync-0003", amountKobo: 100_000 }]);
    const d = db();
    const r = await syncSettlements({ payments: pay, db: d }, { from: "2026-10-01", to: "2026-10-07" });
    expect(r).toEqual({ ok: true, data: { settlements: 2, lines: 3, openBreaks: 4, incomplete: 0, unsettledChargesFlagged: 3 } });
    expect(d.calls.map((c) => c.fn)).toEqual(["record_settlement_report", "reconcile_settlement_report", "record_settlement_report", "reconcile_settlement_report", "reconcile_unsettled_charges"]);
    const stored = d.calls.find((c) => c.args?.["p_settlement_id"] === "12");
    expect(stored?.args).toMatchObject({ p_total_kobo: 300_000, p_lines_complete: true });
    expect((stored?.args?.["p_lines"] as unknown[]).length).toBe(2);
    // nothing the sync calls can write to the ledger
    expect(d.calls.map((c) => c.fn).filter((f) => /post|journal|refund|transfer|payout/i.test(f))).toEqual([]);
  });

  it("pages through a long settlement and marks it incomplete when the line cap is reached", async () => {
    const pay = createMockPayment();
    const lines = Array.from({ length: 250 }, (_, i) => ({ reference: `chg-bulk-${String(i).padStart(4, "0")}`, amountKobo: 1_000 }));
    pay.addSettlement(21, 250_000, 0, lines);
    const full = db();
    expect(await syncSettlements({ payments: pay, db: full }, { from: "a", to: "b" })).toMatchObject({ ok: true, data: { lines: 250, incomplete: 0 } });
    const capped = db();
    expect(await syncSettlements({ payments: pay, db: capped, maxLinePages: 1 }, { from: "a", to: "b" })).toMatchObject({ ok: true, data: { lines: 100, incomplete: 1 } });
    expect(capped.calls[0]?.args).toMatchObject({ p_lines_complete: false });
  });

  it("stops at the settlement cap and pages the settlement list", async () => {
    const pay = createMockPayment();
    for (let i = 1; i <= 3; i++) pay.addSettlement(30 + i, 1_000, 0, [{ reference: `chg-cap-000${i}`, amountKobo: 1_000 }]);
    const r = await syncSettlements({ payments: pay, db: db(), maxSettlements: 2 }, { from: "a", to: "b" });
    expect(r).toMatchObject({ ok: true, data: { settlements: 2 } });
    const big = createMockPayment();
    for (let i = 1; i <= 101; i++) big.addSettlement(1000 + i, 1_000, 0, [{ reference: `chg-page-${String(i).padStart(4, "0")}`, amountKobo: 1_000 }]);
    expect(await syncSettlements({ payments: big, db: db(), maxSettlements: 500 }, { from: "a", to: "b" })).toMatchObject({ ok: true, data: { settlements: 101 } });
  });

  it("returns the provider's failure and the database's failure without throwing", async () => {
    const pay = createMockPayment();
    pay.failNextCall();
    expect((await syncSettlements({ payments: pay, db: db() }, { from: "a", to: "b" })).ok).toBe(false);
    pay.addSettlement(41, 1, 0, [{ reference: "chg-fail-0001", amountKobo: 1 }]);
    const brokenLines = { ...pay, listSettlementTransactions: async () => fail("timeout", "slow") };
    expect((await syncSettlements({ payments: brokenLines, db: db() }, { from: "a", to: "b" })).ok).toBe(false);
    const errDb = { rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
    expect((await syncSettlements({ payments: pay, db: errDb }, { from: "a", to: "b" })).ok).toBe(false);
    const throwDb = { rpc: () => { throw new Error("socket"); } };
    expect((await syncSettlements({ payments: pay, db: throwDb }, { from: "a", to: "b" })).ok).toBe(false);
    const badStore = { rpc: (fn: string) => Promise.resolve({ data: fn === "record_settlement_report" ? 5 : null, error: null }) };
    expect((await syncSettlements({ payments: pay, db: badStore }, { from: "a", to: "b" })).ok).toBe(false);
    const failCompare = { rpc: (fn: string) => Promise.resolve(fn === "reconcile_settlement_report" ? { data: null, error: { message: "x" } } : { data: "r", error: null }) };
    expect((await syncSettlements({ payments: pay, db: failCompare }, { from: "a", to: "b" })).ok).toBe(false);
    const failUnsettled = { rpc: (fn: string) => Promise.resolve(fn === "reconcile_unsettled_charges" ? { data: null, error: { message: "x" } } : { data: fn === "reconcile_settlement_report" ? null : "r", error: null }) };
    expect((await syncSettlements({ payments: pay, db: failUnsettled }, { from: "a", to: "b" })).ok).toBe(false);
  });

  it("reads zero when the database does not return counts", async () => {
    const pay = createMockPayment();
    pay.addSettlement(51, 1, 0, [{ reference: "chg-zero-0001", amountKobo: 1 }]);
    const odd = { rpc: (fn: string) => Promise.resolve({ data: fn === "record_settlement_report" ? "r" : null, error: null }) };
    expect(await syncSettlements({ payments: pay, db: odd }, { from: "a", to: "b" })).toEqual({ ok: true, data: { settlements: 1, lines: 1, openBreaks: 0, incomplete: 0, unsettledChargesFlagged: 0 } });
  });
});
