import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { PANEL_CODES, panelDefinitionSchema, type PanelDefinition } from "./structured";

/** The active panel lists and the active sign-off row, for the CMO page and the read-only admin page. Never throws. */
export async function readLabPanels(supabase: SupabaseClient<Database>) {
  const [signoffRes, ...panelRes] = await Promise.all([
    supabase.from("lab_panel_signoffs").select("id, version, approved_at, created_at, config").eq("is_active", true).maybeSingle(),
    ...PANEL_CODES.map((p) => supabase.rpc("lab_panel_definition", { p_panel: p })),
  ]);
  const panels: PanelDefinition[] = [];
  for (const r of panelRes) {
    const parsed = panelDefinitionSchema.safeParse(r.data);
    if (parsed.success) panels.push(parsed.data);
  }
  return { signoff: signoffRes.data ?? null, panels, loadFailed: signoffRes.error !== null || panels.length !== PANEL_CODES.length };
}
