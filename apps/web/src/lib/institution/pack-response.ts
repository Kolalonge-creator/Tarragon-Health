import { packToCsv, parseProcurementPack, type ProcurementPack } from "./files";

export const SPONSOR_STAFF_ROLES = ["hmo_admin", "corporate_admin", "ngo_admin"] as const;
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

function lagosToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The procurement and renewal pack download. Order matters: each programme's access is written with the existing log_sponsor_staff_export first
 * (a download that cannot be recorded is not given), then sponsor_procurement_pack audits the pack itself and returns only frozen, suppressed figures.
 * `render` turns the parsed pack into the file body for the chosen format; the caller supplies the PDF renderer so this stays testable.
 */
export async function packResponse(input: {
  role: string | null | undefined;
  format: string | null;
  rpc: Rpc;
  render: (pack: ProcurementPack) => Promise<Uint8Array>;
  now?: Date;
}): Promise<Response> {
  if (!(SPONSOR_STAFF_ROLES as readonly string[]).includes(input.role ?? "")) return new Response("Not allowed", { status: 403 });
  if (input.format !== "csv" && input.format !== "pdf") return new Response("Bad request", { status: 400 });
  const programmes = await input.rpc("sponsor_staff_programmes");
  const list = (programmes.data as { programmes?: { id: string }[] } | null)?.programmes;
  if (programmes.error || !list) return new Response("The pack could not be built.", { status: 502 });
  for (const p of list) {
    const logged = await input.rpc("log_sponsor_staff_export", { p_cohort: p.id });
    if (logged.error || (logged.data as { ok?: boolean } | null)?.ok !== true) return new Response("The download could not be recorded, so it was not given.", { status: 500 });
  }
  const res = await input.rpc("sponsor_procurement_pack", { p_format: input.format });
  if (res.error) {
    if (res.error.message.includes("not yet activated")) return new Response("Not switched on yet", { status: 404 });
    return new Response("The pack could not be built.", { status: 502 });
  }
  const pack = parseProcurementPack(res.data);
  if (!pack) return new Response("The pack could not be read.", { status: 502 });
  const day = lagosToday(input.now ?? new Date());
  const headers = { "Cache-Control": "no-store" };
  if (input.format === "csv") {
    return new Response(packToCsv(pack), { status: 200, headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tarragon-programme-pack-${day}.csv"` } });
  }
  const bytes = await input.render(pack);
  return new Response(bytes as BodyInit, { status: 200, headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="tarragon-programme-pack-${day}.pdf"` } });
}
