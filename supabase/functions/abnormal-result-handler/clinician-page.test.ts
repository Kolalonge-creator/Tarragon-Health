// OQ-727: a clinician page for an abnormal screening result is tracked on the governed ladder (in-app, push, email) and never
// ends in an audit row alone. Run: deno test --no-config .
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { NO_ONE_PAGED_REFERENCE_PREFIX, pageClinicians, type RpcClient } from "./clinician-page.ts";

interface RpcCall { fn: string; args: Record<string, unknown> }

function fakes(opts: { failFor?: ReadonlySet<string>; incidentOk?: boolean } = {}) {
  const calls: RpcCall[] = [];
  const audits: Array<{ action: string; event: Record<string, unknown> }> = [];
  const incidents: Array<{ reference: string; title: string; summary: string }> = [];
  const client: RpcClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      const failing = opts.failFor?.has(String(args["p_recipient_id"])) ?? false;
      return Promise.resolve({ error: failing ? { message: "boom" } : null });
    },
  };
  const openIncident = (reference: string, title: string, summary: string) => {
    incidents.push({ reference, title, summary });
    return Promise.resolve(opts.incidentOk !== false);
  };
  const audit = (action: string, _entityType: string, _entityId: string | null, event: Record<string, unknown>) => {
    audits.push({ action, event });
    return Promise.resolve();
  };
  return { client, calls, audits, incidents, openIncident, audit };
}

const base = {
  organisationId: "00000000-0000-4000-8000-000000000001",
  screeningResultId: "00000000-0000-4000-8000-000000000002",
  patientName: "A patient",
  conditionLabel: "hypertension",
};

Deno.test("a page is queued on the tracked ladder for every clinician and opens no incident", async () => {
  const f = fakes();
  const out = await pageClinicians(f.client, f.openIncident, f.audit, {
    ...base,
    clinicianIds: ["c1", "c2"],
    alert: { id: "a1", level: "urgent_escalation" },
  });
  assertEquals(out, { queued: 2, failed: 0, incidentOpened: false, incidentFailed: false });
  assertEquals(f.calls.length, 2);
  assert(f.calls.every((c) => c.fn === "enqueue_critical_notification"));
  assertEquals(f.calls[0].args["p_alert_tier"], "urgent_escalation");
  assertEquals(f.calls[0].args["p_source_table"], "clinician_alerts");
  assertEquals(f.calls[0].args["p_source_id"], "a1");
  assertEquals(f.incidents.length, 0);
  assertEquals(f.audits.map((a) => a.action), ["abnormal_result.clinician_alerts_queued"]);
});

Deno.test("one clinician failing to queue still pages the others and opens no incident", async () => {
  const f = fakes({ failFor: new Set(["c1"]) });
  const out = await pageClinicians(f.client, f.openIncident, f.audit, {
    ...base,
    clinicianIds: ["c1", "c2"],
    alert: { id: "a1", level: "emergency" },
  });
  assertEquals(out.queued, 1);
  assertEquals(out.failed, 1);
  assertEquals(out.incidentOpened, false);
  assertEquals(f.incidents.length, 0);
});

Deno.test("when every enqueue fails a sev1 ops incident opens so a named person phones (not an audit row alone)", async () => {
  const f = fakes({ failFor: new Set(["c1", "c2"]) });
  const out = await pageClinicians(f.client, f.openIncident, f.audit, {
    ...base,
    clinicianIds: ["c1", "c2"],
    alert: { id: "a1", level: "emergency" },
  });
  assertEquals(out.queued, 0);
  assertEquals(out.incidentOpened, true);
  assertEquals(out.incidentFailed, false);
  assertEquals(f.incidents.length, 1);
  // the ops desk assigns its primary on exactly this reference prefix (ops_incidents_assign_ops_desk)
  assert(f.incidents[0].reference.startsWith("page_nobody_reachable:"));
  assertEquals(f.incidents[0].reference, `${NO_ONE_PAGED_REFERENCE_PREFIX}${base.screeningResultId}`);
  assertStringIncludes(f.incidents[0].summary, "Phone the on-call clinician");
  assert(f.audits.some((a) => a.action === "abnormal_result.page_incident_opened"));
});

Deno.test("an organisation with no clinician at all opens the incident instead of only an audit row", async () => {
  const f = fakes();
  const out = await pageClinicians(f.client, f.openIncident, f.audit, {
    ...base,
    clinicianIds: [],
    alert: { id: "a1", level: "emergency" },
  });
  assertEquals(f.calls.length, 0);
  assertEquals(out.incidentOpened, true);
  assertEquals(f.incidents.length, 1);
  assertEquals(f.audits.map((a) => a.action), ["abnormal_result.no_clinician_available", "abnormal_result.page_incident_opened"]);
});

Deno.test("a missing alert row pages on the tightest tracked ladder, never a direct send", async () => {
  const f = fakes();
  const out = await pageClinicians(f.client, f.openIncident, f.audit, { ...base, clinicianIds: ["c1"], alert: null });
  assertEquals(out.queued, 1);
  assertEquals(f.calls[0].fn, "enqueue_critical_notification");
  assertEquals(f.calls[0].args["p_alert_tier"], "emergency");
  assertEquals(f.calls[0].args["p_source_table"], "screening_results");
  assertEquals(f.calls[0].args["p_source_id"], base.screeningResultId);
  assertEquals(f.audits[0].action, "abnormal_result.clinician_alert_row_missing_tracked_fallback");
  assertEquals(f.audits[0].event["alert_row_missing"], true);
});

Deno.test("if the incident cannot be opened either, the outcome says so and the caller must fail loudly", async () => {
  const f = fakes({ failFor: new Set(["c1"]), incidentOk: false });
  const out = await pageClinicians(f.client, f.openIncident, f.audit, { ...base, clinicianIds: ["c1"], alert: null });
  assertEquals(out.queued, 0);
  assertEquals(out.incidentOpened, false);
  assertEquals(out.incidentFailed, true);
  assert(f.audits.some((a) => a.action === "abnormal_result.page_incident_failed"));
});

Deno.test("no sms or voice path exists in this function's source", async () => {
  for (const file of ["./index.ts", "./clinician-page.ts"]) {
    const text = await Deno.readTextFile(new URL(file, import.meta.url));
    assert(!/termii|TERMII_API_KEY|channel:\s*["'](sms|voice)["']|\bsend\w*Sms\w*\(/i.test(text), `${file} still carries an SMS or voice sender`);
  }
});
