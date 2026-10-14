import { createClient } from "@/lib/supabase/server";
import { rpcParsed } from "@/lib/rota/rpc";
import { activePagesSchema, myReadinessSchema, redPatientResponseSchema, type RedPatientResponse, pagingOverviewSchema, readinessOverviewSchema, type ActivePage, type MyReadiness, type PagingOverviewRow, type ReadinessOverviewRow } from "./schemas";

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

/** Never throws: a failed read shows nothing extra (the page and the task still work). */
export async function getRedPatientResponse(source: { page: string } | { task: string }): Promise<RedPatientResponse> {
  try {
    return await rpcParsed(
      await createClient(),
      "latest_red_patient_response",
      "page" in source ? { p_page: source.page } : { p_task: source.task },
      redPatientResponseSchema,
    );
  } catch {
    return null;
  }
}
