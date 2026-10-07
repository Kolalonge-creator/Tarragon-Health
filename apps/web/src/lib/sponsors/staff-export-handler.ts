import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { staffExportResponse } from "@tarragon/staff-core/sponsors/staff-export";

/** The web side of the sponsor staff download (S38f). The rules live in staff-core, shared with the console. */
export async function handleStaffExport(cohortId: string): Promise<Response> {
  const supabase = await createClient();
  return staffExportResponse({ role: (await getCurrentProfile())?.role, cohortId, rpc: (fn, args) => supabase.rpc(fn, args) });
}
