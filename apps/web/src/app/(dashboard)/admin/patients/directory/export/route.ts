import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { lagosToday } from "@/lib/format-date";
import { exportSchema, reasonOk, SEGMENTS, SORTS, type Segment, type SortKey } from "@/lib/admin-patient-directory/model";
import { EXPORT_COLUMNS, LAGOS_UTC_OFFSET_HOURS, exportRow } from "@/lib/admin-patient-directory/export-rows";
import { buildXlsx } from "@/lib/admin-patient-directory/xlsx";

export const dynamic = "force-dynamic";

/**
 * The patient directory as an Excel file. A POST, so a link prefetch can never trigger a download that writes an audit row, and the
 * typed reason and search stay out of the address. The database function writes the audit row (with the reason) before it returns
 * any row, so a download that cannot be logged is not given. Only the admin role gets past the first check; the function checks again.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return new NextResponse("Not allowed", { status: 403 });

  const form = await req.formData();
  const text = (k: string): string => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const reason = text("reason");
  if (!reasonOk(reason)) return new NextResponse("Write a reason of 10 to 500 characters.", { status: 400 });
  const segment = text("segment") || "all";
  if (!(SEGMENTS as readonly string[]).includes(segment)) return new NextResponse("Unknown filter.", { status: 400 });
  const sort = text("sort") || "joined";
  if (!(SORTS as readonly string[]).includes(sort)) return new NextResponse("Unknown sort.", { status: 400 });
  const dir = text("dir") || "desc";
  if (dir !== "asc" && dir !== "desc") return new NextResponse("Unknown sort direction.", { status: 400 });
  const search = text("search").trim();
  if (search.length > 80) return new NextResponse("Search text is too long.", { status: 400 });

  const { data, error } = await loose(await createClient()).rpc("admin_patient_directory_export", {
    p_reason: reason.trim(),
    p_search: search === "" ? null : search,
    p_segment: segment as Segment,
    p_sort: sort as SortKey,
    p_dir: dir,
  });
  if (error) {
    if (error.code === "42501") return new NextResponse("Not allowed", { status: 403 });
    if (error.code === "54000") return new NextResponse("More than 20,000 patients match. Narrow the view and try again. Nothing was downloaded or logged.", { status: 413 });
    return new NextResponse("The download could not be recorded, so it was not given.", { status: 500 });
  }
  const parsed = exportSchema.safeParse(data);
  if (!parsed.success) return new NextResponse("The directory could not be read.", { status: 502 });

  const file = buildXlsx("Patients", EXPORT_COLUMNS, parsed.data.rows.map(exportRow), LAGOS_UTC_OFFSET_HOURS);
  return new NextResponse(Buffer.from(file), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tarragon-patient-directory-${lagosToday()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
