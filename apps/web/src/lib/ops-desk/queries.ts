import { createClient } from "@/lib/supabase/server";
import { rpcParsed } from "@/lib/rota/rpc";
import { callSheetSchema, callsSchema, overviewSchema, rosterSchema, type CallRow, type CallSheet, type OpsDeskOverview, type RosterContact } from "./schemas";

export async function getOpsDeskRoster(): Promise<RosterContact[]> {
  return rpcParsed(await createClient(), "ops_desk_roster", {}, rosterSchema);
}

export async function getOpsDeskOverview(days = 30): Promise<OpsDeskOverview> {
  return rpcParsed(await createClient(), "ops_desk_overview", { p_days: days }, overviewSchema);
}

export async function getOpsDeskCalls(incident: string | null, limit = 100): Promise<CallRow[]> {
  return rpcParsed(await createClient(), "ops_desk_calls", { p_incident: incident, p_limit: limit }, callsSchema);
}

export async function getOpsDeskCallSheet(incident: string): Promise<CallSheet> {
  return rpcParsed(await createClient(), "ops_desk_call_sheet", { p_incident: incident }, callSheetSchema);
}

export type PageIncident = { id: string; reference: string; title: string; detected_at: string; owner_id: string | null };

type IncidentQuery = {
  from(t: string): {
    select(c: string): {
      or(f: string): { eq(c: string, v: string): { not(c: string, op: string, v: string): { order(c: string, o: { ascending: boolean }): PromiseLike<{ data: PageIncident[] | null; error: unknown }> } } };
    };
  };
};

/** The open "page expired" and "nobody reachable" incidents. Throws when the read fails, so the page can say so instead of showing an empty list. */
export async function getOpenPageIncidents(organisationId: string): Promise<PageIncident[]> {
  const supabase = (await createClient()) as unknown as IncidentQuery;
  const { data, error } = await supabase
    .from("ops_incidents")
    .select("id, reference, title, detected_at, owner_id")
    .or("external_reference.like.page\\_expired:*,external_reference.like.page\\_nobody\\_reachable:*")
    .eq("organisation_id", organisationId)
    .not("status", "in", "(resolved,closed)")
    .order("detected_at", { ascending: false });
  if (error || !data) throw new Error("The open page incidents could not be read.");
  return data;
}
