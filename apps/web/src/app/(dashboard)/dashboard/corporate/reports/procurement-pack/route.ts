import type { NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { rpcLoose } from "@/lib/institution/rpc";
import { PackDocument } from "@/lib/institution/pack-document";
import { packResponse } from "@/lib/institution/pack-response";

export const dynamic = "force-dynamic";

/** POST /dashboard/corporate/reports/procurement-pack?format=csv|pdf. Sponsor staff only; every programme's access is audited before the file is built. */
export async function POST(req: NextRequest) {
  return packResponse({
    role: (await getCurrentProfile())?.role,
    format: req.nextUrl.searchParams.get("format"),
    rpc: (fn, args) => rpcLoose(fn, args),
    render: async (pack) => new Uint8Array(await renderToBuffer(PackDocument({ pack }))),
  });
}
