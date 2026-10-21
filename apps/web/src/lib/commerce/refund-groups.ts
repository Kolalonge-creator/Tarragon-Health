/**
 * A refund of a partly paid order is one refund row per paid part (S25b), all in one group: the group's first row has the group's id as its
 * own id and speaks for it. The patient and the admin both think of it as ONE refund of the whole amount, so the lists collapse a group
 * into its first row, with the amount summed and the state taken from ALL of the rows: a group is only "completed" when every part is, and a
 * part that failed or is still being sent is never hidden behind a part that succeeded. A refund that is not in a group passes through unchanged.
 */
export interface GroupedRefund {
  readonly id: string;
  readonly amount_kobo: number;
  readonly refund_group?: string | null;
  readonly state?: string;
}

/** The state a group shows: the least finished of its rows (a failed part outranks a sending one, which outranks one only approved). */
const STATE_RANK: Readonly<Record<string, number>> = { failed: 6, processing: 5, approved: 4, pending: 3, rejected: 2, completed: 1 };

export function collapseRefundGroups<T extends GroupedRefund>(rows: readonly T[]): T[] {
  const sums = new Map<string, number>();
  const states = new Map<string, string>();
  for (const r of rows) {
    if (!r.refund_group) continue;
    sums.set(r.refund_group, (sums.get(r.refund_group) ?? 0) + r.amount_kobo);
    if (r.state !== undefined) {
      const seen = states.get(r.refund_group);
      if (seen === undefined || (STATE_RANK[r.state] ?? 0) > (STATE_RANK[seen] ?? 0)) states.set(r.refund_group, r.state);
    }
  }
  return rows
    .filter((r) => !r.refund_group || r.refund_group === r.id)
    .map((r) => {
      if (!r.refund_group) return r;
      const state = states.get(r.refund_group);
      return { ...r, amount_kobo: sums.get(r.refund_group) ?? r.amount_kobo, ...(state !== undefined ? { state } : {}) };
    });
}
