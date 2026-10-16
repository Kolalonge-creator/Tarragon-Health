import { getProposedConfig } from "./proposed-config";

/**
 * The smallest group a sponsor may see a figure for. Read from the versioned `outcomes.snapshot_rules` config
 * (min_cell) so the member-facing notice can never say a different number from the one the reports enforce.
 */
export function sponsorMinimumGroupSize(asOf?: string): number {
  const v = getProposedConfig<{ min_cell: number }>("outcomes.snapshot_rules", asOf).value;
  return v.min_cell;
}
