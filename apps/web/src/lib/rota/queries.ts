import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rpcParsed } from "./rpc";
import {
  capacitySchema,
  colleaguesSchema,
  leadOverviewSchema,
  leadSummarySchema,
  myBlocksSchema,
  myRotaSchema,
  mySwapsSchema,
  rotaOverviewSchema,
  type LeadCapacity,
  type LeadOverview,
  type RotaOverview,
} from "./schemas";

/**
 * Page reads for availability, the rota and leads (S18). Each is one database function that checks who is asking: a
 * person who may not see a thing gets a refusal from the database, not an empty list the page has to interpret.
 */
export async function getRotaOverview(): Promise<RotaOverview> {
  return rpcParsed(await createClient(), "rota_overview", {}, rotaOverviewSchema);
}
export async function getLeadOverview(): Promise<LeadOverview> {
  return rpcParsed(await createClient(), "lead_overview", {}, leadOverviewSchema);
}
export async function getLeadCapacity(): Promise<LeadCapacity> {
  return rpcParsed(await createClient(), "lead_capacity_status", {}, capacitySchema);
}
export async function getMyBlocks() {
  return rpcParsed(await createClient(), "my_availability_blocks", {}, myBlocksSchema);
}
export async function getMyRota() {
  return rpcParsed(await createClient(), "my_rota", {}, myRotaSchema);
}
export async function getMySwaps() {
  return rpcParsed(await createClient(), "my_rota_swaps", {}, mySwapsSchema);
}
export async function getColleagues() {
  return rpcParsed(await createClient(), "on_call_colleagues", {}, colleaguesSchema);
}
export async function getMyLeadSummary() {
  return rpcParsed(await createClient(), "my_lead_summary", {}, leadSummarySchema);
}

export const patientLeadSchema = z.array(z.object({ lead_name: z.string().nullable(), photo_url: z.string().nullable(), status: z.enum(["assigned", "arranging"]) }));
export async function getMyCareTeamLead() {
  return rpcParsed(await createClient(), "my_care_team_lead", {}, patientLeadSchema);
}
