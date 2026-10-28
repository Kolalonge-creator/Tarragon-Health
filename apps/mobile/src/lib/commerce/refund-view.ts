import { sponsorSplit } from "@tarragon/commerce";
import { fallbackRefundPolicy, refundRuleLines, type RefundPolicy, type RuleLine } from "@tarragon/shared";
import type { MessageKey } from "@tarragon/i18n";
import type { CatalogueItem, OrderRow } from "./parse";

/**
 * The phone's half of the refund wording (S71, A3) and the sponsor split line (A4), worked out here so it can be tested without rendering.
 * The numbers are the web's: the same rule lines from @tarragon/shared, fed by the same database answer (entitlement_policy_public) or, when
 * that cannot be reached, the same registry values. Nothing here types a number of days.
 */

/** The rule for one catalogue item: a Membership uses its own window, a care pack adds the read-only grace. */
export function refundRuleFor(policy: RefundPolicy | null, item: Pick<CatalogueItem, "kind">): RuleLine[] {
  return refundRuleLines(policy ?? fallbackRefundPolicy(), { membership: item.kind === "membership", pack: item.kind === "care_pack" });
}

export type RefundStep = "requested" | "approved" | "declined" | "sending" | "completed" | "problem" | "retrying";
const STEPS: readonly RefundStep[] = ["requested", "approved", "declined", "sending", "completed", "problem", "retrying"];
const STATES = ["pending", "approved", "processing", "completed", "rejected", "failed"] as const;
export type RefundState = (typeof STATES)[number];

export const REFUND_STEP_KEY: Record<RefundStep, MessageKey> = {
  requested: "refund.step.requested", approved: "refund.step.approved", declined: "refund.step.declined", sending: "refund.step.sending",
  completed: "refund.step.completed", problem: "refund.step.problem", retrying: "refund.step.retrying",
};

export interface MyRefund {
  readonly id: string;
  readonly orderId: string;
  readonly amountKobo: number;
  readonly state: RefundState;
  readonly decisionNote: string | null;
  readonly nameKey: string;
  /** Oldest first. The last one is the current step. */
  readonly steps: readonly { readonly step: RefundStep; readonly createdAt: string }[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Rows from `refunds` with the order's item and the status events. A row that does not match is dropped, never guessed. */
export function parseMyRefunds(data: unknown): MyRefund[] {
  if (!Array.isArray(data)) return [];
  const out: MyRefund[] = [];
  for (const r of data) {
    if (!isObj(r)) continue;
    const state = STATES.find((s) => s === r["state"]);
    const amount = r["amount_kobo"];
    if (!state || !str(r["id"]) || !str(r["order_id"]) || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) continue;
    const order = isObj(r["order"]) ? r["order"] : null;
    const item = order && isObj(order["catalog_item"]) ? order["catalog_item"] : null;
    const steps = (Array.isArray(r["steps"]) ? r["steps"] : [])
      .flatMap((s: unknown) => {
        if (!isObj(s) || !str(s["created_at"])) return [];
        const step = STEPS.find((x) => x === s["step"]);
        return step ? [{ step, createdAt: s["created_at"] }] : [];
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    out.push({
      id: r["id"], orderId: r["order_id"], amountKobo: amount, state, decisionNote: str(r["decision_note"]) ? r["decision_note"] : null,
      nameKey: item && str(item["name_key"]) ? item["name_key"] : "", steps,
    });
  }
  return out;
}

export type RefundTimingNote =
  | { readonly key: "refund.status.sla"; readonly params: { readonly days: number } }
  | { readonly key: "refund.status.bank"; readonly params: { readonly min: number; readonly max: number } };

/** Which timing line a refund carries: the answer time while it waits, the bank days once it is on its way. A finished or declined one carries neither. */
export function refundTimingNote(state: RefundState, p: RefundPolicy): RefundTimingNote | null {
  if (state === "pending") return { key: "refund.status.sla", params: { days: p.decisionSlaDays } };
  if (state === "approved" || state === "processing") return { key: "refund.status.bank", params: { min: p.bankDaysMin, max: p.bankDaysMax } };
  return null;
}

/** "You pay X. {Sponsor} pays Y." for a part-covered order: null when the person paid it all or the sponsor did. The name is the database's or nothing (never invented). */
export function orderSplit(o: Pick<OrderRow, "amountKobo" | "totalKobo" | "sponsorShareKobo" | "sponsorName">): { youKobo: number; sponsorKobo: number; sponsorName: string | null } | null {
  return sponsorSplit({ youKobo: o.totalKobo ?? o.amountKobo, sponsorShareKobo: o.sponsorShareKobo, sponsorName: o.sponsorName });
}
