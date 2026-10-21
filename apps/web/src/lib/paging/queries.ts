import { createClient } from "@/lib/supabase/server";
import { rpcParsed } from "@/lib/rota/rpc";
import { activePagesSchema, myReadinessSchema, myShiftStartTestsSchema, shiftStartOverviewSchema, type MyShiftStartTests, type ShiftStartOverviewRow, pagingCountsSchema, pagingHealthSchema, pagingOverviewSchema, readinessOverviewSchema, redPatientResponseSchema, type ActivePage, type MyReadiness, type PagingCounts, type PagingHealth, type PagingOverviewRow, type ReadinessOverviewRow, type RedPatientResponse } from "./schemas";

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

export async function getPagingCounts(days = 30): Promise<PagingCounts> {
  return rpcParsed(await createClient(), "paging_counts", { p_days: days }, pagingCountsSchema);
}

/** null when the health view cannot be read (for example the code is live a moment before the database change): the screen then simply omits that section. */
export async function getPagingHealth(): Promise<PagingHealth | null> {
  try {
    return await rpcParsed(await createClient(), "paging_health", {}, pagingHealthSchema);
  } catch {
    return null;
  }
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

/** Never throws: if the database change is not live yet the screen simply omits the shift-start section. */
export async function getMyShiftStartTests(): Promise<MyShiftStartTests | null> {
  try {
    return await rpcParsed(await createClient(), "my_shift_start_tests", {}, myShiftStartTestsSchema);
  } catch {
    return null;
  }
}

/** Reviewers only; null for anyone else or when the read fails. */
export async function getShiftStartOverview(): Promise<ShiftStartOverviewRow[] | null> {
  try {
    return await rpcParsed(await createClient(), "shift_start_tests_overview", {}, shiftStartOverviewSchema);
  } catch {
    return null;
  }
}
