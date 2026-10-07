import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { toCsv } from "@/lib/research/model";

export const dynamic = "force-dynamic";

const resultSchema = z.object({
  export_id: z.string().uuid(),
  fields: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  sha256: z.string().length(64),
});

/**
 * S81: the de-identified export as a CSV download. All the rules live in public.run_research_export (Chief Medical Officer only, guard on,
 * protocol approved, consented patients only, minimum participants, audited); this route only turns the answer into a file. It sends no
 * cookies-based caching and names the file by the export id, never by a person or an organisation.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { data, error } = await loose(await createClient()).rpc("run_research_export", { p_protocol_id: id });
  if (error) {
    const denied = error.code === "42501" || /not authorised|switched off/i.test(error.message);
    return NextResponse.json({ error: denied ? "not_allowed" : "not_released" }, { status: denied ? 403 : 409 });
  }
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) return NextResponse.json({ error: "bad_response" }, { status: 502 });
  return new NextResponse(toCsv(parsed.data.fields, parsed.data.rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="research-export-${parsed.data.export_id}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-SHA256": parsed.data.sha256,
    },
  });
}
