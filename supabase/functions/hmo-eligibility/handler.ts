// S71 (19.6): POST /functions/v1/hmo-eligibility. The signed-in patient asks whether their HMO membership is active.
//
// 1. request_hmo_eligibility runs AS THE PATIENT: the database checks the HMO has a Tarragon programme, rate limits, validates the number's shape
//    and stores only a keyed hash (the Vault pepper). 2. The adapter for that HMO is asked, with the number held in memory for this call only.
// 3. The answer is recorded with the service role (record_hmo_eligibility_result). An adapter that is missing or fails leaves the check
//    "pending_manual" for operations, who verify by typing the number again (ops_verify_hmo_eligibility). The reply never contains the number.
import { adapterFor, askAdapter, type AdapterAnswer, type HmoAdapter } from "./adapter.ts";

export interface HmoDeps {
  readonly whoami: (authorization: string) => Promise<{ readonly id: string } | null>;
  readonly rpcAsUser: (authorization: string, fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  readonly rpcAsService: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  /** `<hmo org id>=<adapter id>,...`; absent means every HMO uses the stub. */
  readonly adaptersConfig: string | null;
  /** Test seam: replaces the adapter lookup. */
  readonly adapterOverride?: (hmoOrgId: string) => HmoAdapter;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// the shape only; the database normalises and applies the length rules from configuration
const MEMBER = /^[A-Za-z0-9][A-Za-z0-9 /-]{2,59}$/;

const CODES: Record<string, number> = {
  hmo_not_available: 404, hmo_check_rate_limited: 429, sponsor_payment_not_open: 409, member_number_invalid: 422, hmo_not_configured: 503, order_not_authorised: 403,
};
function code(message: string): string {
  for (const c of Object.keys(CODES)) if (message.includes(c)) return c;
  return "unknown";
}

export async function handleHmoEligibility(req: Request, deps: HmoDeps): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "unauthorised" }, { status: 401 });
  if (!(await deps.whoami(auth))) return Response.json({ error: "unauthorised" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b["hmo_id"] !== "string" || !UUID.test(b["hmo_id"]) || typeof b["member_number"] !== "string" || !MEMBER.test(b["member_number"])) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const hmoId = b["hmo_id"];
  const memberNumber = b["member_number"];

  const created = await deps.rpcAsUser(auth, "request_hmo_eligibility", { p_hmo: hmoId, p_member_number: memberNumber });
  if (created.error) {
    const c = code(created.error.message);
    return Response.json({ error: c }, { status: CODES[c] ?? 500 });
  }
  const d = created.data as Record<string, unknown> | null;
  const checkId = d && typeof d["check_id"] === "string" ? d["check_id"] : null;
  if (!checkId) return Response.json({ error: "unknown" }, { status: 500 });
  // a replay of a check that is already decided, or still waiting, is answered without asking the HMO again
  if (d && d["result"] !== "pending_manual") return Response.json({ check_id: checkId, result: d["result"] });
  if (d && d["replay"] === true) return Response.json({ check_id: checkId, result: "pending_manual" });

  const adapter = deps.adapterOverride ? deps.adapterOverride(hmoId) : adapterFor(hmoId, deps.adaptersConfig);
  const answer: AdapterAnswer = await askAdapter(adapter, { hmoOrgId: hmoId, memberNumber });
  if (answer === "unavailable") {
    // nothing to record: the check stays pending for operations. (record is still called so the adapter that tried is visible to nobody but the log of this call)
    return Response.json({ check_id: checkId, result: "pending_manual" });
  }
  const rec = await deps.rpcAsService("record_hmo_eligibility_result", { p_check: checkId, p_result: answer, p_adapter: adapter.id });
  if (rec.error) return Response.json({ check_id: checkId, result: "pending_manual" });
  return Response.json({ check_id: checkId, result: answer });
}
