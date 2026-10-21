/**
 * A refund of a partly paid order is one refund row per paid part (S25b), all in one group: the group's first row has the group's id as its
 * own id and speaks for it. The patient and the admin both think of it as ONE refund of the whole amount, so the lists collapse a group
 * into its first row, with the amount summed. A refund that is not in a group passes through unchanged.
 */
export interface GroupedRefund {
  readonly id: string;
  readonly amount_kobo: number;
  readonly refund_group?: string | null;
}

export function collapseRefundGroups<T extends GroupedRefund>(rows: readonly T[]): T[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    if (r.refund_group) sums.set(r.refund_group, (sums.get(r.refund_group) ?? 0) + r.amount_kobo);
  }
  return rows
    .filter((r) => !r.refund_group || r.refund_group === r.id)
    .map((r) => (r.refund_group ? { ...r, amount_kobo: sums.get(r.refund_group) ?? r.amount_kobo } : r));
}
