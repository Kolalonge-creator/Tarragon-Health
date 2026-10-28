import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { PANEL_CODES, panelDefinitionSchema, type PanelDefinition } from "./structured";

export type LabSignoffDraft = { id: string; version: number; notes: string | null; created_at: string };

/** Pure: the newest unsigned, inactive sign-off that is newer than the version in force, or null. */
export function newestWaitingLabDraft(
  rows: (LabSignoffDraft & { is_active: boolean; approved_at: string | null })[],
  activeVersion: number | null,
): LabSignoffDraft | null {
  const waiting = rows
    .filter((r) => !r.is_active && r.approved_at === null && r.version > (activeVersion ?? 0))
    .sort((a, b) => b.version - a.version)[0];
  return waiting ? { id: waiting.id, version: waiting.version, notes: waiting.notes, created_at: waiting.created_at } : null;
}

/** The active panel lists and the active sign-off row, for the CMO page and the read-only admin page. Never throws. */
export async function readLabPanels(supabase: SupabaseClient<Database>) {
  const [signoffRes, draftsRes, ...panelRes] = await Promise.all([
    supabase.from("lab_panel_signoffs").select("id, version, approved_at, created_at, config").eq("is_active", true).maybeSingle(),
    supabase.from("lab_panel_signoffs").select("id, version, notes, created_at, is_active, approved_at").eq("is_active", false).is("approved_at", null),
    ...PANEL_CODES.map((p) => supabase.rpc("lab_panel_definition", { p_panel: p })),
  ]);
  const panels: PanelDefinition[] = [];
  for (const r of panelRes) {
    const parsed = panelDefinitionSchema.safeParse(r.data);
    if (parsed.success) panels.push(parsed.data);
  }
  const draft = draftsRes.error ? null : newestWaitingLabDraft(draftsRes.data ?? [], signoffRes.data?.version ?? null);
  return { signoff: signoffRes.data ?? null, draft, panels, loadFailed: signoffRes.error !== null || draftsRes.error !== null || panels.length !== PANEL_CODES.length };
}
