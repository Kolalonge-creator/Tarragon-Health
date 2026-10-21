// Run: deno test --no-config .
import { assertEquals } from "jsr:@std/assert@1";
import { handleRefundReconcile, parseProviderRefund, sameSecret, type ReconcileRow, type ReconcileStore } from "./handler.ts";

const req = (secret?: string) => new Request("https://x.test/refund-reconcile", { method: "POST", headers: secret ? { "x-refund-reconcile-secret": secret } : {} });

const row = (id: string, charge: string | null, state = "completed", amount = 500_000): ReconcileRow => ({ id, state, amount_kobo: amount, provider_reference: "r1", charge_reference: charge });

function store(rows: ReconcileRow[], verdict: (state: string, status: string | null, ours: number, theirs: number | null) => string) {
  const recorded: { id: string; status: string | null; amount: number | null }[] = [];
  const s: ReconcileStore = {
    list: () => Promise.resolve({ ok: true, rows }),
    record: (id, status, amount) => {
      recorded.push({ id, status, amount });
      const r = rows.find((x) => x.id === id)!;
      return Promise.resolve(verdict(r.state, status, r.amount_kobo, amount));
    },
    flagDelays: () => Promise.resolve(2),
    catchUp: () => Promise.resolve(1),
  };
  return { s, recorded };
}

const verdict = (state: string, status: string | null, ours: number, theirs: number | null) =>
  status === "not_found" ? "not_found" : theirs !== null && theirs !== ours ? "mismatch" : state === "completed" && status === "processed" ? "matched" : "mismatch";

Deno.test("fails closed without a secret and refuses a wrong or missing one", async () => {
  const { s } = store([], verdict);
  const fetchRefund = () => Promise.resolve({ status: "processed", amountKobo: 1 });
  assertEquals((await handleRefundReconcile(req("s"), { secret: null, store: s, fetchRefund })).status, 503);
  assertEquals((await handleRefundReconcile(req("wrong"), { secret: "s", store: s, fetchRefund })).status, 401);
  assertEquals((await handleRefundReconcile(req(), { secret: "s", store: s, fetchRefund })).status, 401);
  assertEquals((await handleRefundReconcile(req("s"), { secret: "s", store: null, fetchRefund })).status, 503);
  assertEquals(sameSecret("a", "ab"), false);
});

Deno.test("a matching refund is counted matched and a differing amount is flagged", async () => {
  const rows = [row("a", "tho_a"), row("b", "tho_b")];
  const { s, recorded } = store(rows, verdict);
  const fetchRefund = (c: string) => Promise.resolve(c === "tho_a" ? { status: "processed", amountKobo: 500_000 } : { status: "processed", amountKobo: 400_000 });
  const r = await handleRefundReconcile(req("s"), { secret: "s", store: s, fetchRefund });
  assertEquals(await r.json(), { checked: 2, matched: 1, flagged: 1, unreachable: 0, errors: 0, delaysFlagged: 2, caughtUp: 1 });
  assertEquals(recorded.map((x) => x.id), ["a", "b"]);
});

Deno.test("when Paystack cannot be reached nothing is recorded (a network failure is not a verdict)", async () => {
  const { s, recorded } = store([row("a", "tho_a")], verdict);
  const r = await handleRefundReconcile(req("s"), { secret: "s", store: s, fetchRefund: () => Promise.resolve({ status: null, amountKobo: null }) });
  assertEquals((await r.json()).unreachable, 1);
  assertEquals(recorded.length, 0);
});

Deno.test("a refund with no charge reference is recorded as not found so the database raises it", async () => {
  const { s, recorded } = store([row("a", null)], verdict);
  const r = await handleRefundReconcile(req("s"), { secret: "s", store: s, fetchRefund: () => Promise.resolve({ status: "processed", amountKobo: 1 }) });
  assertEquals((await r.json()).flagged, 1);
  assertEquals(recorded[0]?.status, "not_found");
});

Deno.test("a database failure listing refunds answers 500", async () => {
  const s: ReconcileStore = { list: () => Promise.resolve({ ok: false }), record: () => Promise.resolve(null), flagDelays: () => Promise.resolve(0), catchUp: () => Promise.resolve(0) };
  const r = await handleRefundReconcile(req("s"), { secret: "s", store: s, fetchRefund: () => Promise.resolve({ status: "processed", amountKobo: 1 }) });
  assertEquals(r.status, 500);
});

Deno.test("parseProviderRefund reads an object, a list, a 404 and garbage", () => {
  assertEquals(parseProviderRefund(200, { data: { status: "Processed", amount: 500000 } }), { status: "processed", amountKobo: 500000 });
  assertEquals(parseProviderRefund(200, { data: [{ status: "pending", amount: 1 }] }), { status: "pending", amountKobo: 1 });
  assertEquals(parseProviderRefund(200, { data: [] }), { status: "not_found", amountKobo: null });
  assertEquals(parseProviderRefund(404, null), { status: "not_found", amountKobo: null });
  assertEquals(parseProviderRefund(500, null), { status: null, amountKobo: null });
  assertEquals(parseProviderRefund(200, "x"), { status: null, amountKobo: null });
});
