import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { lagosToday } from "@/lib/format-date";
import { assertNoCausalWording, packRows, packToCsv, parsePackReply } from "@/lib/outcomes/pack";
import { PackDocument } from "@/lib/outcomes/pack-document";

export const dynamic = "force-dynamic";

const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()));
const input = z.object({ cohortId: z.string().uuid(), format: z.enum(["csv", "pdf"]), from: plainDate.optional(), to: plainDate.optional() });

/**
 * The sponsor pilot / renewal pack as a file (S75c, Module 22.9). A POST, so a prefetch cannot trigger it. The download is written to the audit log
 * BEFORE the file is built (no log, no file). The database refuses a pack with causal wording; the same word list runs again here before any byte is
 * written. Admin or the active CMO only (the database enforces it too).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ cohortId: string }> }): Promise<NextResponse> {
  if ((await getCurrentProfile())?.role !== "admin") return new NextResponse("Not allowed", { status: 403 });
  const { cohortId } = await ctx.params;
  const form = await req.formData();
  const raw = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const p = input.safeParse({ cohortId, format: raw("format") ?? "csv", from: raw("from"), to: raw("to") });
  if (!p.success) return new NextResponse("Choose csv or pdf, and use plain dates like 2026-07-01.", { status: 400 });
  const supabase = await createClient();
  const logged = await supabase.rpc("log_sponsor_pack_export", { p_cohort: p.data.cohortId, p_format: p.data.format });
  if (logged.error) return new NextResponse("The download could not be recorded, so it was not given.", { status: 500 });
  const { data, error } = await supabase.rpc("sponsor_pilot_pack", { p_cohort: p.data.cohortId, p_from: p.data.from, p_to: p.data.to });
  const reply = error ? null : parsePackReply(data);
  if (!reply) return new NextResponse("The pack could not be read.", { status: 502 });
  if (!reply.ok) return new NextResponse("The pack was not issued because its wording was not allowed. Ask an engineer to look at it.", { status: 422 });
  const rows = packRows(reply.pack);
  try {
    assertNoCausalWording(rows);
  } catch {
    return new NextResponse("The pack was not issued because its wording was not allowed.", { status: 422 });
  }
  const headers = { "Cache-Control": "no-store" };
  if (p.data.format === "pdf") {
    const design = String(reply.pack.evaluation_design ?? "");
    const caveat = String(reply.pack.caveat ?? "");
    const buffer = await renderToBuffer(createElement(PackDocument, { title: "Programme pilot and renewal pack", design, caveat, rows }) as Parameters<typeof renderToBuffer>[0]);
    return new NextResponse(new Uint8Array(buffer), { status: 200, headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="tarragon-pilot-pack-${lagosToday()}.pdf"` } });
  }
  return new NextResponse(packToCsv(rows), { status: 200, headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tarragon-pilot-pack-${lagosToday()}.csv"` } });
}
