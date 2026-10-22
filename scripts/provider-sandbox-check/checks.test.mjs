// Run with: node --test scripts/provider-sandbox-check/checks.test.mjs
// The harness is tested against the repo's fake vendors (no network, no credentials). The fakes answer with the vendors' published shapes,
// so a PASS here proves the harness logic, not the vendor: the vendor is what the founder's one command proves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakePaystack } from "../../packages/integrations/src/support/fake-paystack.ts";
import { createFakeZoom } from "../../packages/integrations/src/support/fake-zoom.ts";
import { makeRedactor, refusal, renderResults, runChecks, svixSignature, zoomChallenge, zoomSignature, paystackSignature } from "./checks.mjs";

const byName = (results, text) => results.find((r) => r.capability.includes(text));

test("a live Paystack key anywhere stops the run before any request is made", async () => {
  let calls = 0;
  const f = async () => { calls += 1; return { status: 200, ok: true, text: async () => "{}" }; };
  for (const env of [{ PAYSTACK_SECRET_KEY: "sk_live_abcdef123456" }, { PAYSTACK_TEST_SECRET_KEY: "sk_test_ok", SOMETHING_ELSE: "sk_live_zzzzzz" }, { PAYSTACK_SECRET_KEY: "pk_test_nope" }]) {
    const out = await runChecks({ env, fetch: f });
    assert.match(out.refused, /live|sk_test_/);
    assert.equal(out.results.length, 0);
  }
  assert.equal(calls, 0);
  assert.equal(refusal({ PAYSTACK_TEST_SECRET_KEY: "sk_test_ok" }), null);
  assert.equal(refusal({}), null);
});

test("redaction masks every secret value and its tail, longest first", () => {
  const redact = makeRedactor({ RESEND_API_KEY: "re_supersecretvalue", ZOOM_CLIENT_SECRET: "zoomsecret12345" });
  const shown = redact("key re_supersecretvalue and tail value and zoomsecret12345 / 12345");
  assert.ok(!shown.includes("supersecret") && !shown.includes("zoomsecret"));
  assert.equal(makeRedactor({})("nothing to hide"), "nothing to hide");
});

test("independent signature helpers match the documented algorithms", () => {
  assert.match(zoomSignature("s", "1", "b"), /^v0=[0-9a-f]{64}$/);
  assert.match(zoomChallenge("s", "tok"), /^[0-9a-f]{64}$/);
  assert.match(paystackSignature("s", "b"), /^[0-9a-f]{128}$/);
  assert.match(svixSignature("whsec_" + Buffer.from("k").toString("base64"), "id", "1", "b"), /^v1,[A-Za-z0-9+/=]+$/);
});

test("Paystack: every capability passes against a faithful fake, and the secret never appears in the report", async () => {
  const fake = createFakePaystack("sk_test_harness_secret_value");
  const env = { PAYSTACK_TEST_SECRET_KEY: "sk_test_harness_secret_value" };
  const out = await runChecks({ env, fetch: fake.fetch, only: ["paystack"] });
  assert.deepEqual(out.results.filter((r) => r.status === "FAIL"), []);
  assert.ok(out.results.filter((r) => r.status === "PASS").length >= 8);
  assert.ok(!renderResults(out.results, makeRedactor(env)).includes("harness_secret_value"));
});

test("Paystack sabotage: a vendor that pays twice for one reference, or accepts a forged webhook, makes the right check FAIL", async () => {
  const fake = createFakePaystack("sk_test_sab");
  const env = { PAYSTACK_TEST_SECRET_KEY: "sk_test_sab" };
  let transfers = 0;
  const lax = async (url, init) => {
    if (new URL(url).pathname === "/transfer") {
      transfers += 1;
      const body = JSON.parse(init.body);
      return { status: 200, ok: true, text: async () => JSON.stringify({ status: true, data: { reference: body.reference, transfer_code: `TRF_${transfers}`, amount: body.amount, status: "pending" } }) };
    }
    return fake.fetch(url, init);
  };
  const out = await runChecks({ env, fetch: lax, only: ["paystack"] });
  assert.equal(byName(out.results, "never pays twice").status, "FAIL");
  assert.equal(byName(out.results, "initiate a transfer").status, "PASS");
});

test("Paystack: a wrong key shows FAIL on the calls that need it, not a crash", async () => {
  const fake = createFakePaystack("sk_test_right");
  const out = await runChecks({ env: { PAYSTACK_TEST_SECRET_KEY: "sk_test_wrong" }, fetch: fake.fetch, only: ["paystack"] });
  assert.ok(out.results.some((r) => r.status === "FAIL"));
  assert.equal(byName(out.results, "webhook signature").status, "PASS");
});

test("Zoom: passes against a faithful fake only with the flag, skips without it, and fails when no host user is named", async () => {
  const env = { ZOOM_ACCOUNT_ID: "a", ZOOM_CLIENT_ID: "c", ZOOM_CLIENT_SECRET: "zoom_client_secret_x", ZOOM_HOST_USER_ID: "consult-host@example.test", ZOOM_SDK_KEY: "k", ZOOM_SDK_SECRET: "x", ZOOM_WEBHOOK_SECRET_TOKEN: "zoom-secret-token" };
  const fake = createFakeZoom({ now: Date.now() });
  const full = await runChecks({ env, fetch: fake.fetch, only: ["zoom"], allowZoomMeeting: true });
  assert.deepEqual(full.results.filter((r) => r.status === "FAIL"), []);
  assert.ok(byName(full.results, "create a room").status === "PASS");
  assert.ok(byName(full.results, "end and delete").status === "PASS");
  const dry = await runChecks({ env, fetch: createFakeZoom({ now: Date.now() }).fetch, only: ["zoom"] });
  assert.equal(byName(dry.results, "create / join").status, "SKIP");
  const noHost = await runChecks({ env: { ...env, ZOOM_HOST_USER_ID: "" }, fetch: createFakeZoom({ now: Date.now() }).fetch, only: ["zoom"] });
  assert.equal(byName(noHost.results, "host user is named").status, "FAIL");
});

test("Resend: sends only to resend.dev inboxes, repeats are idempotent, the webhook checks pass", async () => {
  const seen = new Map();
  const sent = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body.to[0]);
    const key = init.headers["Idempotency-Key"];
    if (!seen.has(key)) seen.set(key, `em_${seen.size + 1}_aaaaaaaa`);
    return { status: 200, ok: true, text: async () => JSON.stringify({ id: seen.get(key) }) };
  };
  const env = { RESEND_API_KEY: "re_test_key_value", RESEND_FROM: "T <care@example.com>" };
  const out = await runChecks({ env, fetch: f, only: ["resend"] });
  assert.deepEqual(out.results.filter((r) => r.status === "FAIL"), []);
  assert.ok(sent.every((a) => a.endsWith("@resend.dev")));
  // sabotage: a vendor that mints a new id for a repeated key
  let n = 0;
  const bad = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ id: `em_${(n += 1)}_aaaaaaaa` }) });
  const sab = await runChecks({ env, fetch: bad, only: ["resend"] });
  assert.equal(byName(sab.results, "same Idempotency-Key").status, "FAIL");
});

test("Termii: read only (GET), never a send, and a missing approved sender is a SKIP with the reason", async () => {
  const seen = [];
  const f = async (url, init) => {
    seen.push(`${init.method} ${new URL(url).pathname}`);
    return { status: 200, ok: true, text: async () => (url.includes("balance") ? '{"user":"x","balance":10,"currency":"NGN"}' : '{"data":[{"sender_id":"Tarragon","status":"pending"}]}') };
  };
  const out = await runChecks({ env: { TERMII_API_KEY: "termii_key_value" }, fetch: f, only: ["termii"] });
  assert.deepEqual(out.results.map((r) => r.status), ["PASS", "SKIP"]);
  assert.ok(seen.every((s) => s.startsWith("GET ")) && !seen.some((s) => s.includes("/sms/")));
});

test("with no credentials at all every provider is SKIP, not PASS", async () => {
  const out = await runChecks({ env: {}, fetch: async () => { throw new Error("must not be called"); } });
  assert.ok(out.results.length === 4 && out.results.every((r) => r.status === "SKIP"));
});
