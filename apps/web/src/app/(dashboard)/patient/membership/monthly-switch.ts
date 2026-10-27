import { getProposedConfig, type ConfigValue } from "@tarragon/shared";

/**
 * Whether a yearly price may also be shown as "about N a month, billed once a year". It is OFF in the versioned configuration
 * (pricing.transparency) until the founder confirms it (OQ-WP1-02). Read on the server and passed down as a plain flag, so the
 * client never carries the whole registry.
 */
export function showMonthlyEquivalent(): boolean {
  const value = getProposedConfig<ConfigValue>("pricing.transparency").value as unknown as { monthly_equivalent?: { enabled?: unknown } };
  return value.monthly_equivalent?.enabled === true;
}
