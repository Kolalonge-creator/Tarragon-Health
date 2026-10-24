// Run with: node --test scripts/provider-sandbox-check/checkout-channels.test.mjs
// Against the repo's fake vendor only: a PASS proves the harness logic, not Paystack. The real run is NOT RUN (no test key supplied).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFakePaystack } from "../../packages/integrations/src/support/fake-paystack.ts";
import { makeRedactor, renderResults, runChecks } from "./checks.mjs";
import { CHECKOUT_CHANNELS, MANUAL_STEPS } from "./checkout-channels.mjs";

const DOC = readFileSync(new URL("../../docs/design/S71-checkout-test-run.md", import.meta.url), "utf8");

test("the channels checked are the channels the checkout really asks for", () => {
  const src = readFileSync(new URL("../../supabase/functions/_shared/commerce/checkout.ts", import.meta.url), "utf8");
  const m = /DEFAULT_CHECKOUT_CHANNELS[^=]*=\s*\[([^\]]*)\]/.exec(src);
  assert.ok(m, "DEFAULT_CHECKOUT_CHANNELS not found");
  assert.deepEqual([...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]), CHECKOUT_CHANNELS);
});

test("the document has a heading for every manual step and is marked NOT RUN", () => {
  for (const s of MANUAL_STEPS) assert.ok(DOC.includes(`## ${s.id} ${s.title}`), `missing heading ${s.id}`);
  assert.match(DOC, /NOT RUN/);
  assert.ok(!/sk_(test|live)_[A-Za-z0-9]{6,}/.test(DOC), "a key-shaped string is in the document");
});

test("opt-in only: the default run does not include the checkout channels", async () => {
  const fake = createFakePaystack("sk_test_chan");
  const out = await runChecks({ env: { PAYSTACK_TEST_SECRET_KEY: "sk_test_chan" }, fetch: fake.fetch });
  assert.ok(!out.results.some((r) => r.provider === "paystack-checkout"));
});

test("each channel is initialised unpaid and the manual steps are listed as SKIP, never PASS", async () => {
  const fake = createFakePaystack("sk_test_chan");
  const env = { PAYSTACK_TEST_SECRET_KEY: "sk_test_chan" };
  const out = await runChecks({ env, fetch: fake.fetch, only: ["paystack-checkout"] });
  const mine = out.results.filter((r) => r.provider === "paystack-checkout");
  assert.deepEqual(mine.filter((r) => r.status === "FAIL"), []);
  assert.equal(mine.filter((r) => r.status === "PASS").length, CHECKOUT_CHANNELS.length);
  const manual = mine.filter((r) => /^M\d /.test(r.capability));
  assert.equal(manual.length, MANUAL_STEPS.length);
  assert.ok(manual.every((r) => r.status === "SKIP" && /NOT RUN/.test(r.detail)));
  assert.ok(!renderResults(out.results, makeRedactor(env)).includes("sk_test_chan"));
});

test("a live key still stops the run before any request, and no key means SKIP", async () => {
  let calls = 0;
  const f = async () => { calls += 1; return { status: 200, ok: true, text: async () => "{}" }; };
  const out = await runChecks({ env: { PAYSTACK_SECRET_KEY: ["sk", "live_abcdef123456"].join("_") }, fetch: f, only: ["paystack-checkout"] });
  assert.match(out.refused, /live/);
  assert.equal(calls, 0);
  const none = await runChecks({ env: {}, fetch: f, only: ["paystack-checkout"] });
  assert.equal(none.results[0].status, "SKIP");
  assert.equal(calls, 0);
});
