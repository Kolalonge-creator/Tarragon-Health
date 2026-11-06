"use client";

import { useRouter } from "next/navigation";
import { useAssignEscalation } from "@/lib/queries/escalations";
import { useAssignableDoctors } from "@/lib/queries/clinical-staff";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";

/**
 * The Chief Medical Officer's "Assign to…" control for one escalation (DW-15: also offered on the CMO's team table).
 * Goes through public.reassign_escalation() via useAssignEscalation, so an optional reason lands on the audit row and the
 * CMO-only gate (private.enforce_escalation_reassignment_authority) is the real boundary; render it only when canAssignCases.
 */
export function AssignEscalationSelect({
  escalationId,
  organisationId,
  assignedProfileId,
  refreshOnSuccess = false,
}: {
  escalationId: string;
  organisationId: string;
  assignedProfileId: string | null;
  /** Server-rendered lists (the clinician home) re-read after a reassignment; the React Query worklist invalidates itself. */
  refreshOnSuccess?: boolean;
}) {
  const router = useRouter();
  const assign = useAssignEscalation();
  const { data: assignableDoctors } = useAssignableDoctors();

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <select
        aria-label="Assign this case to a doctor"
        className="rounded border border-charcoal-ink/20 bg-white px-1.5 py-0.5 text-xs text-charcoal-ink/70"
        disabled={assign.isPending}
        value=""
        onChange={(e) => {
          const doctorProfileId = e.target.value;
          if (!doctorProfileId) return;
          // Optional; it lands in audit_log.reason. Never a patient name or clinical detail. Cancel aborts the reassignment
          // (and resets the native select, which already shows the picked doctor before this handler runs).
          const reason = window.prompt("Reason for this reassignment? (optional, no clinical detail)");
          if (reason === null) {
            e.target.value = "";
            return;
          }
          assign.mutate(
            { escalationId, doctorProfileId, organisationId, reason: reason.trim() || undefined },
            { onSuccess: () => (refreshOnSuccess ? router.refresh() : undefined) },
          );
        }}
      >
        <option value="">Assign to…</option>
        {(assignableDoctors ?? [])
          // public.reassign_escalation() refuses a same-doctor "reassignment" (it would drop the reason); offer only others.
          .filter((d) => d.profile_id !== assignedProfileId)
          .map((d) => (
            <option key={d.profile_id} value={d.profile_id ?? ""}>
              {d.full_name} — {d.doctor_tier ? DOCTOR_TIER_LABEL[d.doctor_tier] : "Unassigned tier"}
            </option>
          ))}
      </select>
      {assign.isError && (
        // reassign_escalation can refuse a long reason (22001), a same-doctor no-op (22023) or an authority denial (42501):
        // the CMO must see that it did not go through.
        <span className="max-w-[14rem] text-right text-xs text-red-600">
          {(assign.error as { message?: string } | null)?.message ?? "Could not reassign this case."}
        </span>
      )}
    </span>
  );
}
