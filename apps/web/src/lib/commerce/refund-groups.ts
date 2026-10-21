/**
 * A refund of a partly paid order is one refund row per paid part (S25b), all in one group: the group's first row has the group's id as its
 * own id and speaks for it. The patient and the admin both think of it as ONE refund of the whole amount, so the lists collapse a group
 * into its first row, with the amount summed and the state taken from ALL of the rows: a failed part always shows (it needs attention),
 * otherwise the group is only as far along as its LEAST finished part, so it is "completed" only when every part is. A part that failed or is
 * still being sent is never hidden behind a part that succeeded. A refund that is not in a group passes through unchanged.
 */
export interface GroupedRefund {
  readonly id: string;
  readonly amount_kobo: number;
  readonly refund_group?: string | null;
  readonly state?: string;
}

/** How far along a refund is; lower is less finished. A state this build does not know counts as least finished so it can never mask a real one. */
const PROGRESS: Readonly<Record<string, number>> = { pending: 1, approved: 2, processing: 3, completed: 4 };

function groupState(states: readonly string[]): string | undefined {
  if (states.length === 0) return undefined;
  if (states.includes("failed")) return "failed";
  if (states.includes("rejected")) return "rejected";
  return states.reduce((least, s) => ((PROGRESS[s] ?? 0) < (PROGRESS[least] ?? 0) ? s : least));
}

export function collapseRefundGroups<T extends GroupedRefund>(rows: readonly T[]): T[] {
  const sums = new Map<string, number>();
  const states = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.refund_group) continue;
    sums.set(r.refund_group, (sums.get(r.refund_group) ?? 0) + r.amount_kobo);
    if (r.state !== undefined) states.set(r.refund_group, [...(states.get(r.refund_group) ?? []), r.state]);
  }
  return rows
    .filter((r) => !r.refund_group || r.refund_group === r.id)
    .map((r) => {
      if (!r.refund_group) return r;
      const state = groupState(states.get(r.refund_group) ?? []);
      const out = { ...r, amount_kobo: sums.get(r.refund_group) ?? r.amount_kobo } as unknown as Record<string, unknown>;
      if (state !== undefined) {
        out["state"] = state;
        // a date that says "done" belongs to a group that is done; the first part's date must not stand in for the others
        if (state !== "completed" && "completed_at" in out) out["completed_at"] = null;
      }
      return out as unknown as T;
    });
}
