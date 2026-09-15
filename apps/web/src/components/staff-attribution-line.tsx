function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Generic "Assigned to X" / "Resolved by X" line for support_tickets and
 * complaints — same null-gating discipline as ReviewedByDoctor
 * (docs/CLINICAL_TRUST_MODEL_SPEC.md §2/§9): renders nothing unless the
 * *_by/*_to id AND its matching timestamp are both set, and falls back to a
 * generic-but-true line rather than guessing a name if it can't be
 * resolved. Deliberately a presentational component (not its own DB query,
 * unlike ReviewedByDoctor) — every caller already has the row loaded
 * (support_tickets/complaints joined against profiles via the query
 * hooks), so a second round trip per instance would be redundant; the
 * load-bearing rule is the null-gating, not where the fetch happens.
 */
export function StaffAttributionLine({
  label,
  staffId,
  staffName,
  at,
}: {
  label: string;
  staffId: string | null;
  staffName: string | null | undefined;
  at: string | null;
}) {
  if (!staffId || !at) return null;

  return (
    <p className="text-sm text-charcoal-ink/70">
      {label} <span className="font-medium text-charcoal-ink">{staffName ?? "your care team"}</span> · {formatDate(at)}
    </p>
  );
}
