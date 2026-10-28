import { getProposedConfig, type ConfigValue } from "./proposed-config/index";

/**
 * The numbers the plain-words refund rule quotes (S26b). The database answers them (`entitlement_policy_public`, which reads the active
 * versioned config); when it cannot be reached the same PROPOSED values from the shared registry are used, so the rule is always on the
 * screen and never quotes a number that is typed into a component.
 */
export interface RefundPolicy {
  readonly coolingOffDays: number;
  readonly membershipWindowDays: number;
  readonly decisionSlaDays: number;
  readonly bankDaysMin: number;
  readonly bankDaysMax: number;
  readonly graceDays: number;
}

const isDays = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export function fallbackRefundPolicy(): RefundPolicy {
  const rules = getProposedConfig<ConfigValue>("refunds.order_rules").value as unknown as Record<string, number>;
  const lifecycle = getProposedConfig<ConfigValue>("entitlements.lifecycle").value as unknown as { grace_days: number };
  const member = getProposedConfig<ConfigValue>("membership.refund").value as unknown as { window_days: number };
  return {
    coolingOffDays: rules["cooling_off_days"] ?? 14,
    membershipWindowDays: member.window_days,
    decisionSlaDays: rules["decision_sla_days"] ?? 3,
    bankDaysMin: rules["bank_days_min"] ?? 5,
    bankDaysMax: rules["bank_days_max"] ?? 10,
    graceDays: lifecycle.grace_days,
  };
}

/** Anything that is not a well-formed answer falls back to the registry values field by field, never to a made-up number. */
export function parseRefundPolicy(raw: unknown): RefundPolicy {
  const base = fallbackRefundPolicy();
  if (typeof raw !== "object" || raw === null) return base;
  const x = raw as Record<string, unknown>;
  return {
    coolingOffDays: isDays(x["cooling_off_days"]) ? x["cooling_off_days"] : base.coolingOffDays,
    membershipWindowDays: isDays(x["membership_window_days"]) ? x["membership_window_days"] : base.membershipWindowDays,
    decisionSlaDays: isDays(x["decision_sla_days"]) ? x["decision_sla_days"] : base.decisionSlaDays,
    bankDaysMin: isDays(x["bank_days_min"]) ? x["bank_days_min"] : base.bankDaysMin,
    bankDaysMax: isDays(x["bank_days_max"]) ? x["bank_days_max"] : base.bankDaysMax,
    graceDays: isDays(x["grace_days"]) ? x["grace_days"] : base.graceDays,
  };
}

export interface RuleLine {
  readonly key: string;
  readonly params: Readonly<Record<string, number>>;
}

/**
 * The lines of the rule, as i18n keys with their numbers. A Membership uses its own window and says access ends at once on a refund; every
 * other order uses the cooling-off window. `pack` adds the short read-only grace that follows the end of a pack.
 */
export function refundRuleLines(p: RefundPolicy, kind: { readonly membership: boolean; readonly pack: boolean }): RuleLine[] {
  const lines: RuleLine[] = [
    kind.membership
      ? { key: "refund.rule.window_membership", params: { days: p.membershipWindowDays } }
      : { key: "refund.rule.window", params: { days: p.coolingOffDays } },
    { key: "refund.rule.timing", params: { sla: p.decisionSlaDays, min: p.bankDaysMin, max: p.bankDaysMax } },
    { key: "refund.rule.declined", params: {} },
    { key: "refund.rule.no_renew", params: {} },
  ];
  if (kind.pack && p.graceDays > 0) lines.push({ key: "refund.rule.grace", params: { days: p.graceDays } });
  return lines;
}
