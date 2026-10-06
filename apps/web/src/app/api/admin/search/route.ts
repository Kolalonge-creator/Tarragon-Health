import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { rpcParsed } from "@/lib/credentialing/rpc";
import { queueSchema } from "@/lib/credentialing/schemas";
import { APPLICATION_STATE_LABEL } from "@/lib/credentialing/labels";

/**
 * The people half of the search box (the pages half runs in the browser). For the admin and the Chief Medical
 * Officer. Clinicians and clinician applicants are searched by name, staff number or MDCN folio through the caller's
 * own session, so the database still decides what they may see. The admin alone can also look up patients (name,
 * phone or patient number) for support and investigations; the result is only an identity line that opens the
 * admin Patients page with the search filled in, and the Patients page keeps its own admin-only gate.
 */
const querySchema = z.string().trim().min(2).max(80);

type PersonResult = { label: string; href: string; group: string; hint: string };

/** Characters that mean something to PostgREST's filter syntax or to LIKE are dropped, not escaped. */
function safeTerm(q: string): string {
  return q.replace(/[%_,()*\\"'`]/g, " ").replace(/\s+/g, " ").trim();
}

export async function GET(request: Request): Promise<Response> {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Not signed in", { status: 401 });
  const isAdmin = profile.role === "admin";
  const isCmo = !isAdmin && profile.role === "clinician" && canAssignCases(await getCurrentClinicalStaff());
  if (!isAdmin && !isCmo) return new NextResponse("Not allowed", { status: 403 });
  const base = isAdmin ? "/admin/credentialing" : "/clinician/credentialing";

  const parsed = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!parsed.success) return NextResponse.json({ results: [] satisfies PersonResult[] });
  const term = safeTerm(parsed.data);
  if (term.length < 2) return NextResponse.json({ results: [] satisfies PersonResult[] });
  const needle = term.toLowerCase();

  const supabase = await createClient();
  const results: PersonResult[] = [];
  let failed = false;

  const [staff, queue] = await Promise.all([
    supabase
      .from("clinical_staff")
      .select("full_name, staff_number, credential_number, active")
      .or(`full_name.ilike.%${term}%,staff_number.ilike.%${term}%,credential_number.ilike.%${term}%`)
      .limit(6),
    rpcParsed(supabase, "credentialing_queue", {}, queueSchema).catch(() => null),
  ]);

  if (staff.error) failed = true;
  for (const s of staff.data ?? []) {
    results.push({
      label: s.full_name,
      href: `${base}/expiry`,
      group: "Clinicians",
      hint: [s.credential_number ? `MDCN ${s.credential_number}` : null, s.staff_number, s.active ? "active" : "not active"].filter(Boolean).join(" · "),
    });
  }
  if (queue === null) failed = true;
  for (const a of (queue ?? [])
    .filter((q) => `${q.applicant_name ?? ""} ${q.mdcn_folio ?? ""}`.toLowerCase().includes(needle))
    .slice(0, 6)) {
    results.push({
      label: a.applicant_name ?? "Unnamed applicant",
      href: `${base}/${a.id}`,
      group: "Clinician applications",
      hint: [APPLICATION_STATE_LABEL[a.state] ?? a.state, a.mdcn_folio ? `MDCN ${a.mdcn_folio}` : null].filter(Boolean).join(" · "),
    });
  }

  if (isAdmin) {
    const patients = await createServiceRoleClient()
      .from("profiles")
      .select("full_name, patient_number, phone, city")
      .eq("role", "patient")
      .or(`full_name.ilike.%${term}%,patient_number.ilike.%${term}%,phone.ilike.%${term}%`)
      .limit(6);
    if (patients.error) failed = true;
    for (const p of patients.data ?? []) {
      results.push({
        label: p.full_name?.trim() || "Unnamed patient",
        href: `/admin/patients?q=${encodeURIComponent(p.patient_number ?? p.full_name ?? term)}`,
        group: "Patients",
        hint: [p.patient_number, p.city].filter(Boolean).join(" · "),
      });
    }
  }

  // `failed` tells the box a source was unavailable, so it can say so instead of showing a shorter list as if complete.
  return NextResponse.json({ results, failed });
}
