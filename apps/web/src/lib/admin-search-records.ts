import type { SupabaseClient } from "@supabase/supabase-js";
import { koboToNaira, type Database } from "@tarragon/shared";
import { loose } from "@/lib/clinician/loose-client";
import { parseCohortList } from "@/lib/sponsors/report";
import { overviewSchema as directorySchema } from "@/lib/diagnostic-directory/model";

/**
 * The record half of the admin search box (docs/design/SUPERADMIN-CONSOLE.md, phase 2c): employers, sponsor
 * programmes, lab and imaging providers, incidents, and checkout orders by Paystack reference. Every read goes through
 * the caller's OWN session, so the database's row rules decide what comes back (never the service-role client). A
 * result is an identity line and a link to the page that already shows the record behind its own gate; nothing
 * clinical is ever returned. A source that fails is reported, never shown as a shorter list.
 */

export type RecordResult = { label: string; href: string; group: string; hint: string };

/** Results per group, the same as the people groups. */
export const GROUP_LIMIT = 6;

/** Paystack references are one unbroken token; only a term that could be one is looked up as a payment. */
export function looksLikeReference(term: string): boolean {
  return /^[A-Za-z0-9._=-]{6,100}$/.test(term);
}

export function matchesNeedle(needle: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
}

/**
 * A list the caller is not entitled to (SQLSTATE 42501) is simply not theirs to search: it adds nothing and is not a
 * failure, so the box does not warn on every search. Any other error is a failure and is reported.
 */
function refused(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "42501";
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;


/**
 * Runs every record lookup in parallel. `term` has already had PostgREST and LIKE metacharacters removed; `needle` is
 * its lowercase form for matching lists that are filtered here (the sponsor and directory lists are small and are read
 * whole through their own admin functions).
 */
export async function searchRecords(
  db: SupabaseClient<Database>,
  term: string,
  needle: string,
): Promise<{ results: RecordResult[]; failed: boolean }> {
  // The two admin list functions are read through the structural client; their answers are parsed with Zod below.
  const rpc = loose(db);
  const isRef = looksLikeReference(term);

  const [employers, cohorts, directory, incidents, orders] = await Promise.all([
    db.from("organisations").select("id, name, is_active").eq("type", "corporate").ilike("name", `%${term}%`).limit(GROUP_LIMIT),
    rpc.rpc("admin_list_sponsor_cohorts", {}),
    rpc.rpc("admin_dx_overview", {}),
    db
      .from("ops_incidents")
      .select("id, reference, title, severity, status")
      .or(`reference.ilike.%${term}%,title.ilike.%${term}%`)
      .order("detected_at", { ascending: false })
      .limit(GROUP_LIMIT),
    isRef
      ? db
          .from("orders")
          .select("id, paystack_reference, state, amount_kobo, created_at, beneficiary_patient_id")
          .ilike("paystack_reference", `%${term}%`)
          // Test checkouts stay hidden from staff, as everywhere else in the console.
          .eq("is_test", false)
          .order("created_at", { ascending: false })
          .limit(GROUP_LIMIT)
      : null,
  ]);

  const results: RecordResult[] = [];
  let failed = false;

  if (employers.error) failed = true;
  for (const o of employers.data ?? []) {
    results.push({ label: o.name || "Unnamed employer", href: `/admin/employers/${o.id}`, group: "Employers", hint: o.is_active ? "active" : "not active" });
  }

  if (cohorts.error && !refused(cohorts.error)) failed = true;
  for (const c of parseCohortList(cohorts.data).filter((c) => matchesNeedle(needle, c.name, c.code, c.sponsor)).slice(0, GROUP_LIMIT)) {
    results.push({ label: c.name, href: `/admin/sponsors/${c.id}`, group: "Sponsor programmes", hint: [c.code, c.sponsor, c.status].join(" · ") });
  }

  const dir = directory.error ? null : directorySchema.safeParse(directory.data);
  if (directory.error ? !refused(directory.error) : !dir?.success) failed = true;
  for (const p of (dir?.success ? dir.data.providers : []).filter((p) => matchesNeedle(needle, p.name)).slice(0, GROUP_LIMIT)) {
    results.push({
      label: p.name,
      href: `/admin/ops/diagnostic-directory/${p.listing_id}`,
      group: "Labs and imaging",
      hint: [p.kind, p.directory_status, p.contracted ? "contracted" : "not contracted"].join(" · "),
    });
  }

  if (incidents.error) failed = true;
  for (const i of incidents.data ?? []) {
    results.push({
      label: i.title || "Untitled incident",
      href: `/admin/ops/incidents/${i.id}`,
      group: "Incidents",
      hint: [i.reference, i.severity, i.status].filter(Boolean).join(" · "),
    });
  }

  if (orders?.error) failed = true;
  const orderRows = orders?.data ?? [];
  if (orderRows.length > 0) {
    // An order opens the admin Patients page for the person it was for, the support path that already shows their
    // Memberships and payments behind its own gate. The patient number comes from the same session.
    const ids = [...new Set(orderRows.map((o) => o.beneficiary_patient_id))];
    const people = await db.from("profiles").select("id, patient_number").in("id", ids);
    if (people.error) failed = true;
    const numberOf = new Map((people.data ?? []).map((p) => [p.id, p.patient_number]));
    for (const o of orderRows) {
      const patientNumber = numberOf.get(o.beneficiary_patient_id) ?? null;
      results.push({
        label: `Order ${o.paystack_reference}`,
        href: patientNumber ? `/admin/patients?q=${encodeURIComponent(patientNumber)}` : "/admin/patients",
        group: "Payments",
        hint: [o.state, naira(o.amount_kobo), day(o.created_at), patientNumber]
          .filter(Boolean)
          .join(" · "),
      });
    }
  }

  return { results, failed };
}
