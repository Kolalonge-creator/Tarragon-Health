// Paging the org's clinicians about an abnormal screening result, and what happens when that cannot happen.
//
// OQ-727 (founder decision 2026-10-27, on D3 and the CMO decision of 2026-10-07, S16-S20 decision 10): a page to a clinician goes
// by in-app, push and email only. SMS is for verification codes (sent by Supabase phone auth, never from here). The final fallback
// is an in-console alarm and a named ops person phoning the on-call clinician, which is what an ops_incidents row whose
// external_reference starts with `page_nobody_reachable:` sets in motion (an after-insert trigger on ops_incidents hands it to the
// ops desk primary, then the deputy, then both leadership contacts; see 20261020173800_ops_desk_expired_page_resilience.sql).
//
// Every outcome below ends in one of two places: a tracked critical notification on the governed ladder (private.enqueue_critical_
// notification, whose own last rung raises the exhausted-ladder admin alarm), or an open sev1 ops incident. Nothing ends in an
// audit row alone. This module has no Deno or network dependency so it can be tested with a fake client.

export type AlertLevel = "clinician_review" | "urgent_escalation" | "emergency" | "routine";

export interface ClinicianAlertRef {
  readonly id: string;
  readonly level: AlertLevel;
}

export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
}

/** Records an audit row. Its own failure must never stop the page, so callers get nothing back to branch on. */
export type AuditFn = (
  action: string,
  entityType: string,
  entityId: string | null,
  event: Record<string, unknown>,
) => PromiseLike<unknown>;

/** Opens (or refreshes) one sev1 ops incident for a reference and resolves true only when an incident now exists. */
export type OpenIncidentFn = (reference: string, title: string, summary: string) => Promise<boolean>;

export interface PageInput {
  readonly organisationId: string;
  readonly screeningResultId: string;
  readonly clinicianIds: readonly string[];
  /** The alert row the trigger wrote, or null when it is (impossibly) missing. */
  readonly alert: ClinicianAlertRef | null;
  readonly patientName: string;
  readonly conditionLabel: string;
}

export interface PageOutcome {
  readonly queued: number;
  readonly failed: number;
  /** True when a sev1 ops incident was opened or already open; false when none was needed. */
  readonly incidentOpened: boolean;
  /** True when an incident was needed and could not be opened: the caller must fail loudly. */
  readonly incidentFailed: boolean;
}

export const NO_ONE_PAGED_REFERENCE_PREFIX = "page_nobody_reachable:abnormal_result:";

/** The conservative ladder when the alert row is missing: the tighter of the two screening tiers. */
const FALLBACK_TIER: AlertLevel = "emergency";

export async function pageClinicians(
  client: RpcClient,
  openIncident: OpenIncidentFn,
  audit: AuditFn,
  input: PageInput,
): Promise<PageOutcome> {
  const { organisationId, screeningResultId, clinicianIds, alert, patientName, conditionLabel } = input;
  const reference = `${NO_ONE_PAGED_REFERENCE_PREFIX}${screeningResultId}`;

  // The page must reach somebody through a channel that exists. If it cannot, a person phones (the ops desk).
  const raiseIncident = async (why: string, detail: Record<string, unknown>): Promise<PageOutcome> => {
    const ok = await openIncident(
      reference,
      "An abnormal screening result could not be paged to any clinician",
      `${why} Screening result ${screeningResultId}. Phone the on-call clinician and the chief medical officer now and record the calls on the Ops desk page.`,
    );
    await audit(
      ok ? "abnormal_result.page_incident_opened" : "abnormal_result.page_incident_failed",
      "screening_results",
      screeningResultId,
      { reason: why, ...detail },
    );
    return { queued: 0, failed: clinicianIds.length, incidentOpened: ok, incidentFailed: !ok };
  };

  if (clinicianIds.length === 0) {
    await audit("abnormal_result.no_clinician_available", "screening_results", screeningResultId, {
      organisation_id: organisationId,
    });
    return raiseIncident("This organisation has no clinician profile to page.", { recipients: 0 });
  }

  // The trigger inserts the alert row in the same transaction that calls this function, so a missing row should be impossible.
  // If it ever happens the page still goes out on the tightest ladder (never a direct, untracked send), and says so in the audit.
  const tier = alert?.level ?? FALLBACK_TIER;
  const sourceTable = alert ? "clinician_alerts" : "screening_results";
  const sourceId = alert ? alert.id : screeningResultId;

  const results = await Promise.all(
    clinicianIds.map((clinicianId) =>
      client.rpc("enqueue_critical_notification", {
        p_organisation_id: organisationId,
        p_recipient_id: clinicianId,
        p_template: "abnormal_result_clinician_alert",
        p_payload: { patient_name: patientName, condition_label: conditionLabel },
        p_pathway: "screening_abnormal_result",
        p_alert_tier: tier,
        p_source_table: sourceTable,
        p_source_id: sourceId,
      })
    ),
  );
  const queued = results.filter((r) => !r.error).length;
  const failed = results.length - queued;

  await audit(
    alert ? "abnormal_result.clinician_alerts_queued" : "abnormal_result.clinician_alert_row_missing_tracked_fallback",
    "screening_results",
    screeningResultId,
    {
      queued,
      failed,
      recipients: clinicianIds.length,
      alert_level: tier,
      alert_row_missing: alert === null,
    },
  );

  if (queued === 0) {
    const firstError = results.find((r) => r.error)?.error?.message ?? "unknown error";
    return raiseIncident("Every clinician page failed to queue.", { recipients: clinicianIds.length, error: firstError });
  }

  return { queued, failed, incidentOpened: false, incidentFailed: false };
}
