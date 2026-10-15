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
