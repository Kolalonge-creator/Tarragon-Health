import type { NextRequest } from "next/server";
import { getCurrentProfile } from "@tarragon/auth/current-profile";
import { createClient } from "@tarragon/auth/supabase/server";
import { staffExportResponse } from "@tarragon/staff-core/sponsors/staff-export";

export const dynamic = "force-dynamic";

/** A POST, so a prefetch cannot trigger it. The rules (role, audit before the file, same answer for another sponsor's programme) live in staff-core. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ cohortId: string }> }) {
  const supabase = await createClient();
  return staffExportResponse({
    role: (await getCurrentProfile())?.role,
    cohortId: (await ctx.params).cohortId,
    rpc: (fn, args) => supabase.rpc(fn, args),
  });
}
