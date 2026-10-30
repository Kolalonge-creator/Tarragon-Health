import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ChildRecordDocument } from "@/lib/child-record/child-record-document";
import { buildChildRecord } from "@/lib/child-record/build-child-record";
import { mayPrintChildRecord } from "@/lib/child-record/access";
import { t } from "@tarragon/i18n";
import { ageFromDateOfBirth } from "@tarragon/shared";

/**
 * One-page PDF of a child's growth chart and vaccine record (S68b). Cookie-session auth and every read through the caller's own RLS-scoped
 * session, like the school health summary: a child the caller has no grant on returns nothing and 404s. Never behind a plan: a child's own
 * history is not a paid feature, so there is no entitlement check here and none may be added.
 */
const Params = z.object({ patientId: z.string().uuid() });

export async function GET(_request: Request, { params }: { params: Promise<{ patientId: string }> }): Promise<Response> {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const patientId = parsed.data.patientId;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: child } = await supabase.from("profiles").select("full_name, date_of_birth, sex, is_dependent_account, dependent_kind").eq("id", patientId).maybeSingle();
  if (!child) return new Response("Not found", { status: 404 });

  // Decide access BEFORE reading the record. A read filtered by RLS looks empty, and a page that says "no measurements, every dose overdue" must
  // never be printed for someone who simply cannot see the data. The caller's own grant is visible to them.
  if (user.id !== patientId) {
    const { data: grant, error: grantError } = await supabase
      .from("profile_access")
      .select("permission_level, expires_at, categories:profile_access_categories(category)")
      .eq("profile_id", patientId)
      .eq("grantee_user_id", user.id)
      .maybeSingle();
    if (grantError) return new Response("Could not build the record", { status: 502 });
    const age = ageFromDateOfBirth(child.date_of_birth);
    const allowed = mayPrintChildRecord(user.id, patientId, grant
      ? {
          permissionLevel: grant.permission_level,
          expiresAt: grant.expires_at,
          categories: (grant.categories ?? []).map((c) => c.category),
          childIsMinorDependant: child.is_dependent_account === true && child.dependent_kind === "minor_child" && age !== null && age < 18,
        }
      : null);
    if (!allowed) return new Response(t("cdl.export.no_access"), { status: 403 });
  }

  const [growth, catalog, records] = await Promise.all([
    supabase
      .from("child_growth_measurements")
      .select("id, measured_at, weight_kg, height_cm, weight_for_age_z, height_for_age_z, weight_for_height_z, muac_mm, bilateral_oedema, nutrition_class, plausibility_flags")
      .eq("patient_id", patientId)
      .order("measured_at", { ascending: true }),
    supabase.from("vaccination_catalog").select("id, code, name, recommended_age").eq("is_active", true).like("code", "child_%"),
    supabase.from("vaccination_records").select("vaccination_catalog_id, dose_number, date_administered, verification_status").eq("profile_id", patientId),
  ]);
  // A failed read must not print as "no measurements" on a page someone hands to a clinic.
  if (growth.error || catalog.error || records.error) return new Response("Could not build the record", { status: 502 });

  const now = new Date();
  const data = buildChildRecord({
    name: (child.full_name ?? "").split(/\s+/)[0] || "Baby",
    dateOfBirth: child.date_of_birth,
    sex: child.sex === "male" || child.sex === "female" ? child.sex : null,
    today: new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10),
    generatedAt: now.toISOString(),
    growth: growth.data,
    catalog: catalog.data,
    records: records.data,
  });
  const buffer = await renderToBuffer(ChildRecordDocument({ data }));
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="tarragon-child-record.pdf"' },
  });
}
