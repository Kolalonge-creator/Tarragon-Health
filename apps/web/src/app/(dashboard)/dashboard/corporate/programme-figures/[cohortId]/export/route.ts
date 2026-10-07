import type { NextRequest } from "next/server";
import { handleStaffExport } from "@/lib/sponsors/staff-export-handler";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ cohortId: string }> }) {
  return handleStaffExport((await ctx.params).cohortId);
}
