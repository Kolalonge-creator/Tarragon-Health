import { createClient } from "@/lib/supabase/server";
import { rpcParsed } from "@/lib/rota/rpc";
import { activePagesSchema, myReadinessSchema, pagingHealthSchema, pagingOverviewSchema, readinessOverviewSchema, type ActivePage, type MyReadiness, type PagingHealth, type PagingOverviewRow, type ReadinessOverviewRow } from "./schemas";

export async function getMyActivePages(): Promise<ActivePage[]> {
  return rpcParsed(await createClient(), "my_active_pages", {}, activePagesSchema);
}

export async function getPagingOverview(): Promise<PagingOverviewRow[]> {
  return rpcParsed(await createClient(), "paging_overview", {}, pagingOverviewSchema);
}

export async function getMyReadiness(): Promise<MyReadiness> {
  return rpcParsed(await createClient(), "my_on_call_readiness", {}, myReadinessSchema);
}

export async function getReadinessOverview(): Promise<ReadinessOverviewRow[]> {
  return rpcParsed(await createClient(), "on_call_readiness_overview", {}, readinessOverviewSchema);
}

/** null when the health view cannot be read (for example the code is live a moment before the database change): the screen then simply omits that section. */
export async function getPagingHealth(): Promise<PagingHealth | null> {
  try {
    return await rpcParsed(await createClient(), "paging_health", {}, pagingHealthSchema);
  } catch {
    return null;
  }
}
