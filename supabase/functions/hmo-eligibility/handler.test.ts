// Run: deno test --no-config .
import { assertEquals } from "jsr:@std/assert@1";
import { handleHmoEligibility, type HmoDeps } from "./handler.ts";
import { adapterFor, askAdapter, stubAdapter, type HmoAdapter } from "./adapter.ts";

const HMO = "11111111-2222-4333-8444-555555555555";
const CHECK = "99999999-2222-4333-8444-555555555555";

function deps(over: Partial<HmoDeps> & { user?: (fn: string, a: Record<string, unknown>) => { data: unknown; error: { message: string } | null } } = {}) {
  const calls: { fn: string; args: Record<string, unknown>; who: "user" | "service" }[] = [];
  const d: HmoDeps = {
    adaptersConfig: null,
    whoami: () => Promise.resolve({ id: "u1" }),
    rpcAsUser: (_a, fn, args) => {
      calls.push({ fn, args, who: "user" });
      return Promise.resolve(over.user ? over.user(fn, args) : { data: { check_id: CHECK, result: "pending_manual", replay: false }, error: null });
    },
    rpcAsService: (fn, args) => {
      calls.push({ fn, args, who: "service" });
      return Promise.resolve({ data: { result: "recorded" }, error: null });
    },
    ...over,
  };
  return { d, calls };
}
const req = (body: unknown, headers: Record<string, string> = { Authorization: "Bearer t" }, method = "POST") =>
  new Request("https://x.test/hmo-eligibility", { method, headers, ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
const ok = (r: string): HmoAdapter => ({ id: "fake", check: () => Promise.resolve(r as "eligible") });

Deno.test("the stub adapter connects to nothing: the check stays for operations and nothing is recorded", async () => {
  const { d, calls } = deps();
  const res = await handleHmoEligibility(req({ hmo_id: HMO, member_number: "REL/12345/67" }), d);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { check_id: CHECK, result: "pending_manual" });
  assertEquals(calls.map((c) => c.fn), ["request_hmo_eligibility"]);
});

Deno.test("the request runs AS THE PATIENT and the answer is recorded with the service role", async () => {
  const { d, calls } = deps({ adapterOverride: () => ok("eligible") });
  const res = await handleHmoEligibility(req({ hmo_id: HMO, member_number: "REL/12345/67" }), d);
  assertEquals((await res.json()).result, "eligible");
  assertEquals(calls.map((c) => [c.fn, c.who]), [["request_hmo_eligibility", "user"], ["record_hmo_eligibility_result", "service"]]);
  assertEquals(calls[1]!.args, { p_check: CHECK, p_result: "eligible", p_adapter: "fake" });
});

Deno.test("a not-eligible answer is recorded as such", async () => {
  const { d, calls } = deps({ adapterOverride: () => ok("not_eligible") });
  assertEquals((await (await handleHmoEligibility(req({ hmo_id: HMO, member_number: "REL/12345/67" }), d)).json()).result, "not_eligible");
  assertEquals(calls[1]!.args["p_result"], "not_eligible");
});

Deno.test("the member number is never in the reply and never reaches the service-role call", async () => {
  const { d, calls } = deps({ adapterOverride: () => ok("eligible") });
  const res = await handleHmoEligibility(req({ hmo_id: HMO, member_number: "REL/12345/67" }), d);
  const text = JSON.stringify(await res.json());
  assertEquals(text.includes("12345"), false);
  assertEquals(JSON.stringify(calls.filter((c) => c.who === "service")).includes("12345"), false);
});

Deno.test("an adapter that throws, hangs or returns rubbish is 'unavailable', never 'not eligible'", async () => {
  assertEquals(await askAdapter({ id: "x", check: () => Promise.reject(new Error("down")) }, { hmoOrgId: HMO, memberNumber: "ABCD" }), "unavailable");
  assertEquals(await askAdapter({ id: "x", check: () => new Promise(() => {}) }, { hmoOrgId: HMO, memberNumber: "ABCD" }, 20), "unavailable");
  assertEquals(await askAdapter({ id: "x", check: () => Promise.resolve("maybe" as never) }, { hmoOrgId: HMO, memberNumber: "ABCD" }), "unavailable");
  assertEquals(await askAdapter(stubAdapter, { hmoOrgId: HMO, memberNumber: "ABCD" }), "unavailable");
});

Deno.test("adapter config: a named adapter for one HMO, the stub for every other and for an unknown name", () => {
  assertEquals(adapterFor(HMO, null).id, "stub");
  assertEquals(adapterFor(HMO, `${HMO}=stub`).id, "stub");
  assertEquals(adapterFor(HMO, `${HMO}=nonesuch`).id, "stub");
  assertEquals(adapterFor(HMO, "other=stub").id, "stub");
});

Deno.test("a replay of a decided or waiting check does not ask the HMO again", async () => {
  let asked = 0;
  const adapter: HmoAdapter = { id: "fake", check: () => { asked++; return Promise.resolve("eligible"); } };
  const decided = deps({ adapterOverride: () => adapter, user: () => ({ data: { check_id: CHECK, result: "eligible", replay: true }, error: null }) });
  assertEquals((await (await handleHmoEligibility(req({ hmo_id: HMO, member_number: "REL/12345/67" }), decided.d)).json()).result, "eligible");
  const waiting = deps({ adapterOverride: () => adapter, user: () => ({ data: { check_id: CHECK, result: "pending_manual", replay: true }, error: null }) });
  assertEquals((await (await handleHmoEligibility(req({ hmo_id: HMO, member_number: "REL/12345/67" }), waiting.d)).json()).result, "pending_manual");
  assertEquals(asked, 0);
});

Deno.test("a failure to record leaves the check for operations rather than failing the patient", async () => {
  const { d } = deps({ adapterOverride: () => ok("eligible"), rpcAsService: () => Promise.resolve({ data: null, error: { message: "db down" } }) });
  assertEquals((await (await handleHmoEligibility(req({ hmo_id: HMO, member_number: "REL/12345/67" }), d)).json()).result, "pending_manual");
});

Deno.test("the database's refusals have stable codes and statuses", async () => {
  for (const [msg, status] of [["hmo_not_available", 404], ["hmo_check_rate_limited", 429], ["sponsor_payment_not_open", 409], ["member_number_invalid", 422], ["hmo_not_configured", 503]] as const) {
    const { d } = deps({ user: () => ({ data: null, error: { message: msg } }) });
    const res = await handleHmoEligibility(req({ hmo_id: HMO, member_number: "REL/12345/67" }), d);
    assertEquals([res.status, (await res.json()).error], [status, msg]);
  }
});

Deno.test("refuses without a token, a bad token, a wrong method, and bad input; nothing is created", async () => {
  const { d, calls } = deps();
  assertEquals((await handleHmoEligibility(req({}, {}), d)).status, 401);
  assertEquals((await handleHmoEligibility(req({ hmo_id: HMO, member_number: "ABCD" }), { ...d, whoami: () => Promise.resolve(null) })).status, 401);
  assertEquals((await handleHmoEligibility(req(null, {}, "GET"), d)).status, 405);
  assertEquals((await handleHmoEligibility(req("not json"), d)).status, 400);
  assertEquals((await handleHmoEligibility(req({ hmo_id: "nope", member_number: "ABCD" }), d)).status, 400);
  assertEquals((await handleHmoEligibility(req({ hmo_id: HMO, member_number: "a" }), d)).status, 400);
  assertEquals((await handleHmoEligibility(req({ hmo_id: HMO, member_number: "x".repeat(80) }), d)).status, 400);
  assertEquals((await handleHmoEligibility(req({ hmo_id: HMO, member_number: 12345 }), d)).status, 400);
  assertEquals(calls.length, 0);
});
