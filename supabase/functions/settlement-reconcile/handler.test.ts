// Run: deno test --no-config .
import { assertEquals } from "jsr:@std/assert@1";
import { handleSettlementReconcile } from "./handler.ts";
import { createMockPayment } from "../_shared/integrations/payment-mock.ts";

const req = (secret?: string, method = "POST") => new Request("https://x.test/settlement-reconcile", { method, headers: secret ? { "x-settlement-reconcile-secret": secret } : {} });
const db = () => {
  const calls: string[] = [];
  return { calls, rpc: (fn: string) => { calls.push(fn); return Promise.resolve({ data: fn === "record_settlement_report" ? "r1" : fn === "reconcile_settlement_report" ? { open_breaks: 1 } : 0, error: null }); } };
};

Deno.test("fails closed: no secret configured, a wrong or missing secret, a wrong method, no payment provider", async () => {
  const d = db();
  const base = { secret: "s", payments: createMockPayment(), db: d, nowMs: () => Date.UTC(2026, 9, 13) };
  assertEquals((await handleSettlementReconcile(req("s", "GET"), base)).status, 405);
  assertEquals((await handleSettlementReconcile(req("s"), { ...base, secret: null })).status, 503);
  assertEquals((await handleSettlementReconcile(req("wrong"), base)).status, 401);
  assertEquals((await handleSettlementReconcile(req(), base)).status, 401);
  assertEquals((await handleSettlementReconcile(req("s"), { ...base, payments: null })).status, 503);
  assertEquals(d.calls.length, 0);
});

Deno.test("reads Paystack, stores and compares each settlement, and reports the pass; it never touches the ledger", async () => {
  const pay = createMockPayment();
  pay.addSettlement(1, 500_000, 7_500, [{ reference: "chg-edge-0001", amountKobo: 500_000 }]);
  const d = db();
  const res = await handleSettlementReconcile(req("s"), { secret: "s", payments: pay, db: d, nowMs: () => Date.UTC(2026, 9, 13), lookbackDays: 3 });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { settlements: 1, lines: 1, openBreaks: 1, incomplete: 0, unsettledChargesFlagged: 0 });
  assertEquals(d.calls, ["record_settlement_report", "reconcile_settlement_report", "reconcile_unsettled_charges"]);
});

Deno.test("a Paystack failure is a 502 with the retry hint, not a throw", async () => {
  const pay = createMockPayment();
  pay.failNextCall();
  const res = await handleSettlementReconcile(req("s"), { secret: "s", payments: pay, db: db(), nowMs: () => 0 });
  assertEquals(res.status, 502);
  assertEquals((await res.json()).retryable, true);
});
