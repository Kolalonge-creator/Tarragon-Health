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
 * already saw for the real attempt.
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
  void client
    .rpc("log_denied_action", {
      p_action: params.action,
      p_entity_type: params.entityType,
      p_entity_id: params.entityId,
      p_organisation_id: params.organisationId,
      p_reason: params.reason,
    })
    .then(
      () => {
        // Nothing to do either way -- fire-and-forget, see the doc comment above.
      },
      () => {
        // Rejection handler, not a chained .catch() -- the Supabase query
        // builder's return type is PromiseLike, not a full Promise, so it has
        // no .catch(). Same fire-and-forget posture as generateCaseBriefAction's
        // own .catch(() => {}) in lib/queries/escalations.ts -- a
        // network-level rejection here must never surface as an unhandled
        // promise rejection on top of the real error the user already saw.
      }
    );
}
