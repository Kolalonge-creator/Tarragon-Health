"use client";

/**
 * Wrong-patient prevention (docs spec §89.4) — an active confirmation step
 * before a high-risk clinical write (finalizing an encounter note, resolving
 * an escalation). Deliberately a checkbox, not a pre-ticked default: the
 * clinician must read the name and date of birth and affirmatively agree
 * they match before the action they're gating can be taken. The server side
 * of this is a CHECK constraint (identity_confirmed) plus a trigger that
 * stamps who/when — this component is the UI half only, not the enforcement
 * boundary.
 */
export function PatientIdentityConfirm({
  patientName,
  patientDateOfBirth,
  confirmed,
  onConfirmedChange,
}: {
  patientName: string;
  /** ISO date string, or null when the patient has none on file. */
  patientDateOfBirth: string | null;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
}) {
  const dobLabel = patientDateOfBirth
    ? new Date(patientDateOfBirth).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "no date of birth on file";

  return (
    <label className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-3 py-2 text-sm text-charcoal-ink dark:text-night-ink">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={confirmed}
        onChange={(e) => onConfirmedChange(e.target.checked)}
      />
      <span>
        I have confirmed this is <span className="font-medium">{patientName}</span>, date of
        birth <span className="font-medium">{dobLabel}</span>.
      </span>
    </label>
  );
}
