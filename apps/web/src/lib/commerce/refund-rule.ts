// The refund rule moved to @tarragon/shared so the phone app quotes the very same numbers (S71, A3). This path stays so the web imports do not change.
export { fallbackRefundPolicy, parseRefundPolicy, refundRuleLines, type RefundPolicy, type RuleLine } from "@tarragon/shared";
