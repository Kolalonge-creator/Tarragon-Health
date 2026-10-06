import { createClient } from "@/lib/supabase/server";
import { rpcParsed } from "@/lib/rota/rpc";
import { activePagesSchema, myReadinessSchema, pagingOverviewSchema, readinessOverviewSchema, type ActivePage, type MyReadiness, type PagingOverviewRow, type ReadinessOverviewRow } from "./schemas";

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
