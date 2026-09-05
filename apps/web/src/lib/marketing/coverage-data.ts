import { marketingAnonClient as anonClient } from "./anon-client";
import type { CoverageItem } from "@/lib/coverage/what-works-where";

/**
 * The public coverage map for the marketing site.
 *
 * Reads public.public_service_coverage() through a BARE anon supabase-js client,
 * deliberately not @/lib/supabase/server, so the marketing tree stays free of
 * auth and platform modules per the marketing-boundary rule. The RPC is
 * explicitly granted to anon and returns nothing but where the company
 * operates.
 *
 * Fails soft. If the environment has no Supabase keys, or the call errors, the
 * page renders its honest empty state and tells the visitor to ask, rather than
 * inventing coverage or crashing the route.
 */

export type StateCoverage = {
  state: string;
  displayName: string;
  /** The state's master rollout switch. False means nothing partner-backed works there yet. */
  isActive: boolean;
  services: Record<NonNullable<CoverageItem["gatedBy"]>, boolean>;
};

function toStateCoverage(raw: unknown): StateCoverage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const services = (row.services ?? {}) as Record<string, unknown>;
  if (typeof row.state !== "string") return null;
  return {
    state: row.state,
    displayName: typeof row.display_name === "string" ? row.display_name : row.state,
    isActive: row.is_active === true,
    services: {
      lab: services.lab === true,
      pharmacy: services.pharmacy === true,
      specialist: services.specialist === true,
      home_visit: services.home_visit === true,
      delivery: services.delivery === true,
    },
  };
}

export async function getServiceCoverage(): Promise<StateCoverage[]> {
  const supabase = anonClient();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("public_service_coverage");
  if (error || !Array.isArray(data)) return [];

  return data
    .map(toStateCoverage)
    .filter((row): row is StateCoverage => row !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
