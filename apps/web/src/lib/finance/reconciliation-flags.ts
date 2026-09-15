import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";

export type CurrencyCode = Database["public"]["Enums"]["currency"];
export type ReconciliationFlagType = "missing_locally" | "amount_mismatch" | "status_mismatch";

export interface ReconciliationFlag {
  organisation_id: string | null;
  provider: "paystack";
  flag_type: ReconciliationFlagType;
  provider_reference: string;
  payment_transaction_id: string | null;
  local_amount_minor: number | null;
  provider_amount_minor: number | null;
  local_status: string | null;
  provider_status: string | null;
  currency: CurrencyCode | null;
  detail: Json;
}

/**
 * The one way this codebase writes a payment_reconciliation_flags row.
 *
 * WHY IT IS NOT AN UPSERT. The table's uniqueness lives in
 * `payment_reconciliation_flags_open_unique`, which is PARTIAL:
 *
 *     unique (provider, provider_reference, flag_type) where status = 'open'
 *
 * Postgres will only infer an index for ON CONFLICT when the conflict target
 * carries the index's predicate too. PostgREST's `onConflict` option emits
 * bare column names, so `.upsert(..., { onConflict:
 * "provider,provider_reference,flag_type" })` is rejected with 42P10, "there
 * is no unique or exclusion constraint matching the ON CONFLICT
 * specification" — verified directly against the live database on 2026-09-05.
 *
 * runReconciliationSweep used exactly that call and swallowed the failure in
 * a console.error, returning "0 flags written". That is why
 * payment_reconciliation_flags has zero rows despite the sweep running daily:
 * the detection half of the payment safety net has never been able to record
 * anything it detected.
 *
 * A read-then-write is correct here without needing the index at all. The
 * writers are two daily cron passes, single-threaded, so the race an upsert
 * would be protecting against does not arise; and if two ever did collide,
 * the partial index itself still refuses the duplicate rather than letting it
 * through.
 *
 * Only OPEN flags are matched, which is the same semantics the partial index
 * encodes: a flag a human already resolved stays resolved, and a recurrence
 * raises a fresh row rather than silently reopening a closed one.
 */
export async function writeReconciliationFlag(
  supabase: SupabaseClient<Database>,
  flag: ReconciliationFlag,
): Promise<{ written: boolean; error: string | null }> {
  const { data: existing, error: readError } = await supabase
    .from("payment_reconciliation_flags")
    .select("id")
    .eq("provider", flag.provider)
    .eq("provider_reference", flag.provider_reference)
    .eq("flag_type", flag.flag_type)
    .eq("status", "open")
    .maybeSingle();
  if (readError) return { written: false, error: readError.message };

  if (existing) {
    const { error } = await supabase
      .from("payment_reconciliation_flags")
      .update({
        payment_transaction_id: flag.payment_transaction_id,
        local_amount_minor: flag.local_amount_minor,
        provider_amount_minor: flag.provider_amount_minor,
        local_status: flag.local_status,
        provider_status: flag.provider_status,
        currency: flag.currency,
        detail: flag.detail,
        detected_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return { written: error === null, error: error?.message ?? null };
  }

  const { error } = await supabase.from("payment_reconciliation_flags").insert(flag);
  return { written: error === null, error: error?.message ?? null };
}

export async function writeReconciliationFlags(
  supabase: SupabaseClient<Database>,
  flags: ReconciliationFlag[],
): Promise<number> {
  let written = 0;
  for (const flag of flags) {
    const result = await writeReconciliationFlag(supabase, flag);
    if (result.written) written += 1;
    else console.error("reconciliation flag not written", flag.provider_reference, result.error);
  }
  return written;
}

/**
 * The other half of what was missing: somebody being told.
 *
 * runReconciliationSweep wrote (or rather, tried to write) a flag and stopped
 * there. Nothing read the table on a schedule, nothing emailed, nothing
 * appeared in the notification bell — a discrepancy between what Paystack
 * says happened and what this platform recorded sat in a table until somebody
 * happened to open /finance/reconciliation.
 *
 * One in_app notification per admin per sweep, only when there is something
 * open, and only once a day per admin so a persistent unresolved flag does
 * not re-announce itself every run. in_app only and non-clinical: this is an
 * internal money-and-records matter carrying no patient content.
 */
export async function alertAdminsOfOpenFlags(
  supabase: SupabaseClient<Database>,
): Promise<{ openFlags: number; adminsNotified: number }> {
  const { data: open } = await supabase
    .from("payment_reconciliation_flags")
    .select("id, organisation_id, flag_type")
    .eq("status", "open");

  const openFlags = open?.length ?? 0;
  if (openFlags === 0) return { openFlags: 0, adminsNotified: 0 };

  const { data: admins } = await supabase.from("profiles").select("id").eq("role", "admin");
  if (!admins?.length) return { openFlags, adminsNotified: 0 };

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: alreadyTold } = await supabase
    .from("notifications")
    .select("recipient_id")
    .eq("template", "payment_reconciliation_flags_open")
    .gte("created_at", since);
  const told = new Set((alreadyTold ?? []).map((n) => n.recipient_id));

  const organisationId = open?.find((f) => f.organisation_id)?.organisation_id ?? null;
  const rows = admins
    .filter((a) => !told.has(a.id))
    .map((a) => ({
      organisation_id: organisationId,
      recipient_id: a.id,
      channel: "in_app" as const,
      template: "payment_reconciliation_flags_open",
      content_class: "non_clinical" as const,
      priority: "routine" as const,
      payload: { open_count: openFlags } as Json,
    }));
  if (rows.length === 0) return { openFlags, adminsNotified: 0 };

  const { error } = await supabase.from("notifications").insert(rows);
  if (error) {
    console.error("reconciliation: could not alert admins", error);
    return { openFlags, adminsNotified: 0 };
  }
  return { openFlags, adminsNotified: rows.length };
}
