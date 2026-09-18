import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/client";

type LogDeniedActionClient = Pick<ReturnType<typeof createClient>, "rpc">;

/**
 * True for a Postgres permission-denied error (errcode 42501) -- the class
 * every authority-gate trigger/RPC in this codebase raises with (see
 * private.enforce_escalation_reassignment_authority,
 * private.enforce_emergency_escalation_tier, public.amend_medication).
 * Only these are worth durably logging as a "denied" audit event; a network
 * error or an unrelated validation failure (e.g. a 22023/42704 from
 * amend_medication) is not an authority denial and should surface as a plain
 * error instead.
 */
export function isPermissionDeniedError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "42501"
  );
}

/**
 * A 42501 guard can raise more than one message from the same call site --
 * e.g. private.enforce_emergency_escalation_tier raises for a bystander
 * starting someone else's case AND, separately, for re-resolving an
 * already-terminal case; amend_medication raises for insufficient
 * prescribing authority AND, separately, for the target not being a
 * clinician-issued record. A single hardcoded guess at "the reason" for a
 * call site is wrong whenever the real cause was the other branch --
 * misleading in a trail this codebase treats as NDPR-relevant.
 *
 * Every 42501 message actually raised by the guard clauses this module logs
 * for (see log-denied-action.test.ts for the confirmed list) is plain,
 * generic English describing which authority was missing or which
 * transition was refused -- never a patient name, diagnosis, or other
 * clinical detail. So the caught error's own message is what gets logged,
 * not a per-call-site guess -- accurate by construction, for whichever
 * branch of the guard actually fired. `fallback` covers the case
 * error.message is missing or not a string, which should not happen for a
 * real PostgrestError but keeps this defensive. Capped at 300 chars to
 * match public.log_denied_action()'s own cap.
 */
export function denialReasonFromError(error: unknown, fallback: string): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : undefined;
  const reason = typeof message === "string" && message.trim() ? message.trim() : fallback;
  return reason.slice(0, 300);
}

/**
 * Durably records that an attempted action was just rejected by a DB-level
 * authority gate, via the public.log_denied_action() RPC (see
 * supabase/migrations/20260918085308_wire_audit_reason_and_denied_action_logging.sql).
 *
 * This MUST be its own request, separate from the failed attempt: a
 * permission-denied RAISE EXCEPTION rolls back everything done in that same
 * database transaction, including any audit_log insert the raising trigger
 * itself might attempt -- Postgres has no autonomous transactions without a
 * dblink/postgres_fdw loopback connection, which would need a hardcoded
 * credential (CLAUDE.md: never hardcode credentials). Calling this from here,
 * after the rejection, is what makes the denial row durable.
 *
 * Fire-and-forget by design (same posture as this file's neighbours'
 * `.catch(() => {})` fire-and-forget calls) -- a failure to log the denial
 * must never surface as a second, confusing error on top of the one the user
 * already saw for the real attempt. "Fire-and-forget" means never re-throwing
 * or blocking the caller, not "nobody ever finds out" -- a failure here means
 * this NDPR-relevant audit trail silently stopped recording, which is worth
 * knowing about even though nothing should interrupt the user over it. Both
 * failure paths report to Sentry (a no-op if NEXT_PUBLIC_SENTRY_DSN isn't
 * configured, see instrumentation-client.ts) with the RPC params as context
 * -- action/entityType/entityId/organisationId only, never `reason` (already
 * required to be non-PHI, but there's no reason to widen what Sentry sees).
 *
 * `reason` must never carry patient-identifying or clinical detail -- see
 * audit_log.reason's own column comment. Keep it generic (what kind of
 * authority was missing), never what the case/prescription/patient actually
 * involved.
 */
export function logDeniedAction(
  params: {
    action: string;
    entityType: string;
    entityId: string;
    organisationId: string;
    reason?: string;
  },
  // Injectable for testing (see log-denied-action.test.ts) -- defaults to the
  // real browser client for every actual call site, unchanged.
  client: LogDeniedActionClient = createClient()
): void {
  const context = {
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    organisationId: params.organisationId,
  };
  void client
    .rpc("log_denied_action", {
      p_action: params.action,
      p_entity_type: params.entityType,
      p_entity_id: params.entityId,
      p_organisation_id: params.organisationId,
      p_reason: params.reason,
    })
    .then(
      ({ error }) => {
        if (!error) return;
        // The RPC responded but rejected the write (e.g. an action string
        // not yet added to public.log_denied_action()'s allowlist, or an
        // is_org_staff failure for an edge-case caller) -- still
        // fire-and-forget for the user, but worth knowing this denial row
        // never got written.
        Sentry.captureException(error, { extra: context });
      },
      (error: unknown) => {
        // Rejection handler, not a chained .catch() -- the Supabase query
        // builder's return type is PromiseLike, not a full Promise, so it has
        // no .catch(). Same fire-and-forget posture as generateCaseBriefAction's
        // own .catch(() => {}) in lib/queries/escalations.ts -- a
        // network-level rejection here must never surface as an unhandled
        // promise rejection on top of the real error the user already saw.
        Sentry.captureException(error, { extra: context });
      }
    );
}

/**
 * The one shared "is this a denial, and if so log it" check every mutation
 * hook wired to logDeniedAction needs -- factored out so the three call
 * sites (useStartEscalationReview, useAssignEscalation in
 * lib/queries/escalations.ts, useAmendMedication in lib/queries/medications.ts)
 * can't silently diverge from each other (e.g. one forgetting the
 * isPermissionDeniedError guard and miscategorising an unrelated validation
 * failure as an authority denial). Callers still throw the original error
 * themselves afterward -- this only decides whether, and with what reason,
 * to log it first.
 */
export function handleIfPermissionDenied(
  error: unknown,
  params: {
    action: string;
    entityType: string;
    entityId: string;
    organisationId: string;
    fallbackReason: string;
  },
  client?: LogDeniedActionClient
): void {
  if (!isPermissionDeniedError(error)) return;
  logDeniedAction(
    {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      organisationId: params.organisationId,
      reason: denialReasonFromError(error, params.fallbackReason),
    },
    client
  );
}
