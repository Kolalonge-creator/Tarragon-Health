import { createClient } from "@/lib/supabase/server";
import { rpcParsed } from "@/lib/rota/rpc";
import {
  coverOverviewSchema,
  fireDrillReportSchema,
  intakeOverviewSchema,
  myCoverOffersSchema,
  opsModeStatusSchema,
  type CoverOverview,
  type FireDrillReport,
  type IntakeOverview,
  type MyCoverOffers,
  type OpsModeStatus,
} from "./schemas";

export async function getIntakeOverview(): Promise<IntakeOverview> {
  return rpcParsed(await createClient(), "intake_gate_overview", {}, intakeOverviewSchema);
}

export async function getCoverOverview(): Promise<CoverOverview> {
  return rpcParsed(await createClient(), "cover_offers_overview", {}, coverOverviewSchema);
}

export async function getFireDrillReport(days: number): Promise<FireDrillReport> {
  return rpcParsed(await createClient(), "fire_drill_report", { p_days: days }, fireDrillReportSchema);
}

export async function getMyCoverOffers(): Promise<MyCoverOffers> {
  return rpcParsed(await createClient(), "my_cover_offers", {}, myCoverOffersSchema);
}

/** Never throws: a failed read shows no banner (the queue and the pages still work). */
export async function getOpsModeStatus(): Promise<OpsModeStatus | null> {
  try {
    return await rpcParsed(await createClient(), "ops_mode_status", {}, opsModeStatusSchema);
  } catch {
    return null;
  }
}

/** The test page window in force (paging_delivery_config.readiness_test_page_days), in days. Never throws: null hides the control's current value. */
export async function getPagingTestPageDays(): Promise<number | null> {
  try {
    const client = (await createClient()) as unknown as {
      from(table: string): { select(c: string): { eq(c: string, v: boolean): { order(c: string, o: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: { rules: unknown }[] | null; error: unknown }> } } } };
    };
    const { data, error } = await client.from("paging_delivery_config").select("version, rules").eq("is_active", true).order("version", { ascending: false }).limit(1);
    if (error || !data?.[0]) return null;
    const days = (data[0].rules as Record<string, unknown> | null)?.readiness_test_page_days;
    return typeof days === "number" && Number.isInteger(days) && days > 0 ? days : null;
  } catch {
    return null;
  }
}
