import { createClient } from "@/lib/supabase/server";
import { rpcParsed } from "@/lib/rota/rpc";
import { activePagesSchema, pagingOverviewSchema, type ActivePage, type PagingOverviewRow } from "./schemas";

export async function getMyActivePages(): Promise<ActivePage[]> {
  return rpcParsed(await createClient(), "my_active_pages", {}, activePagesSchema);
}

export async function getPagingOverview(): Promise<PagingOverviewRow[]> {
  return rpcParsed(await createClient(), "paging_overview", {}, pagingOverviewSchema);
}
