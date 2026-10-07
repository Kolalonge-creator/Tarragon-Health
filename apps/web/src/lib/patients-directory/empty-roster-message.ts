export type PatientFilter = "mine" | "recent" | "high_risk" | "programme";

export const FILTER_TABS: { value: PatientFilter | undefined; label: string }[] = [
  { value: undefined, label: "Everyone" },
  { value: "mine", label: "Assigned to me" },
  { value: "recent", label: "Recent" },
  { value: "high_risk", label: "High-risk" },
  { value: "programme", label: "Programme" },
];

export const EMPTY_STATE: Record<PatientFilter, string> = {
  mine: "No patients are assigned to you on the care team yet. Switch to “Everyone” to see the full roster.",
  recent: "You haven't opened any patient charts yet. Charts you view will show up here.",
  high_risk: "No patient currently has a high or very-high prevention risk tier on file.",
  programme: "No patient is currently enrolled in a preventive programme.",
};

/**
 * The empty-roster message for `clinician/patients/page.tsx`, naming every
 * active narrowing dimension rather than picking just one to blame — `q`
 * and `condition` can each be the real reason a tab that genuinely has
 * patients comes back empty, and showing only the tab's own EMPTY_STATE
 * line in that case would falsely claim the tab itself has nobody on it.
 *
 * `filterAloneEmpty` is the one exception: it means the tab had zero
 * patients before `q`/`condition` were even evaluated (see the skip in the
 * page's own loader), so neither of them is the real cause and both are
 * left out of the message.
 *
 * Extracted out of page.tsx (a Next.js App Router page module, which can
 * only export a fixed set of reserved names) into its own file so this pure
 * function is actually importable by a Jest test — see
 * empty-roster-message.test.ts, the regression test for the bug this
 * function fixed (an empty result from a combined name+condition search
 * previously showed only the filter tab's own message, misattributing the
 * empty result to the tab itself).
 */
export function emptyRosterMessage({
  filter,
  filterAloneEmpty,
  condition,
  q,
}: {
  filter: PatientFilter | undefined;
  filterAloneEmpty: boolean;
  condition: string | undefined;
  q: string | undefined;
}): string {
  if (filterAloneEmpty && filter) return EMPTY_STATE[filter];

  const trimmedCondition = condition?.trim();
  const trimmedQ = q?.trim();
  const clauses: string[] = [];
  if (trimmedQ) clauses.push(`a name matching “${trimmedQ}”`);
  if (trimmedCondition) clauses.push(`a condition on file matching “${trimmedCondition}”`);

  if (clauses.length > 0) {
    const scope = filter ? `on the “${FILTER_TABS.find((t) => t.value === filter)?.label}” tab ` : "";
    return `No patients ${scope}have ${clauses.join(" and ")}.`;
  }
  if (filter) return EMPTY_STATE[filter];
  return "No patients enrolled yet.";
}
