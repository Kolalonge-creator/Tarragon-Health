/**
 * Duplicate-investigation CDS (module 57.7/57.8): "This investigation may
 * have already been performed recently." Advisory only, same architecture as
 * ./drug-safety.ts — a pure app-layer function, never a DB trigger, because
 * this is soft clinical advice the ordering clinician can act on or dismiss,
 * not a hard safety gate. The clinician remains responsible for the final
 * decision (57.8) — this never blocks an order, it only surfaces a finding.
 */

export type LabOrderSafetySeverity = "info" | "caution";

export interface RecentLabOrderInput {
  id: string;
  testCodes: string[];
  orderedAt: string;
  /** lab_order_status — 'cancelled' orders are ignored; every other status counts as "recently performed or in flight". */
  status: string;
  panelBundleName?: string | null;
}

export interface DuplicateInvestigationFinding {
  severity: LabOrderSafetySeverity;
  title: string;
  message: string;
  testCode: string;
  priorOrderId: string;
  priorOrderedAt: string;
}

/**
 * Search: patient + test + recent timeframe (57.8). `recentOrders` is
 * expected to already be scoped to one patient (the caller's query does the
 * patient filter — this function has no patient concept of its own, matching
 * assessMedicationSafety's shape).
 */
export function duplicateInvestigationFindings(
  recentOrders: RecentLabOrderInput[],
  candidateTestCodes: string[],
  options: { windowDays?: number; now?: Date } = {},
): DuplicateInvestigationFinding[] {
  const windowDays = options.windowDays ?? 90;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  // Most recent order per test code, within the window, excluding cancelled orders.
  const mostRecentByCode = new Map<string, RecentLabOrderInput>();
  for (const order of recentOrders) {
    if (order.status === "cancelled") continue;
    const orderedAt = new Date(order.orderedAt);
    if (Number.isNaN(orderedAt.getTime()) || orderedAt < cutoff) continue;

    for (const code of order.testCodes) {
      const existing = mostRecentByCode.get(code);
      if (!existing || orderedAt > new Date(existing.orderedAt)) {
        mostRecentByCode.set(code, order);
      }
    }
  }

  const findings: DuplicateInvestigationFinding[] = [];
  const seenCodes = new Set<string>();
  for (const code of candidateTestCodes) {
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);

    const priorOrder = mostRecentByCode.get(code);
    if (!priorOrder) continue;

    const priorOrderedAt = new Date(priorOrder.orderedAt);
    const daysAgo = Math.max(
      0,
      Math.round((now.getTime() - priorOrderedAt.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const already = priorOrder.status === "resulted" ? "the result is already on file" : "that order is still open, awaiting a result";
    const when = daysAgo === 0 ? "today" : `${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;
    const bundleNote = priorOrder.panelBundleName ? ` (as part of "${priorOrder.panelBundleName}")` : "";

    findings.push({
      severity: priorOrder.status === "resulted" ? "caution" : "info",
      title: "This investigation may have already been performed recently",
      message: `${code} was ordered ${when}${bundleNote}, and ${already}. Confirm a repeat is clinically needed before ordering again — this does not block the order.`,
      testCode: code,
      priorOrderId: priorOrder.id,
      priorOrderedAt: priorOrder.orderedAt,
    });
  }

  return findings;
}
