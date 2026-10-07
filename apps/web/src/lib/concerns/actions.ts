"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { idSchema, INCIDENT_SEVERITIES, RETALIATION_OUTCOMES, textSchema, type ConcernNotice } from "./model";

/**
 * S36i server actions, run only when a person presses a button. The database is the protection (concern_reader, credential_is_cmo,
 * the minimum lengths); these checks refuse a non-lead BEFORE the database is called and give a clear notice first.
 *
 * INV-07: a concern's id arrives in the request body (a hidden field), never in an address; the address carries only a fixed
 * notice token; a database error message is never shown or logged (it is replaced by the token "failed").
 */
const LEAD = "/clinician/quality/concerns";
const MINE = "/clinician/my-concerns";
const back = (n: ConcernNotice, path = LEAD): never => redirect(`${path}?n=${n}`);

const mayLead = async (): Promise<boolean> => canAssignCases(await getCurrentClinicalStaff());

/** Runs one lead action: refuses a non-lead first, validates the form, calls the database, and returns only a token. */
async function leadAction(
  formData: FormData,
  parse: (f: FormData) => Record<string, unknown> | null,
  fn: string,
  ok: ConcernNotice,
): Promise<void> {
  if (!(await mayLead())) return redirect("/clinician");
  const args = parse(formData);
  if (!args) return back("failed");
  const { error } = await loose(await createClient()).rpc(fn, args);
  return back(error ? "failed" : ok);
}

const concern = (f: FormData) => idSchema.safeParse(f.get("concern"));
const field = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function acknowledgeConcernAction(formData: FormData): Promise<void> {
  return leadAction(formData, (f) => { const c = concern(f); return c.success ? { p_concern: c.data } : null; }, "acknowledge_safety_concern", "acknowledged");
}

export async function respondToConcernAction(formData: FormData): Promise<void> {
  return leadAction(
    formData,
    (f) => { const c = concern(f); const b = textSchema(20).safeParse(field(f, "body")); return c.success && b.success ? { p_concern: c.data, p_body: b.data } : null; },
    "respond_to_safety_concern",
    "responded",
  );
}

export async function closeConcernAction(formData: FormData): Promise<void> {
  return leadAction(
    formData,
    (f) => { const c = concern(f); const n = textSchema(20).safeParse(field(f, "note")); return c.success && n.success ? { p_concern: c.data, p_note: n.data } : null; },
    "close_safety_concern",
    "closed",
  );
}

export async function openIncidentAction(formData: FormData): Promise<void> {
  return leadAction(
    formData,
    (f) => { const c = concern(f); const s = z.enum(INCIDENT_SEVERITIES).safeParse(field(f, "severity")); return c.success && s.success ? { p_concern: c.data, p_severity: s.data } : null; },
    "open_incident_for_concern",
    "incident_opened",
  );
}

/** Naming a backup reader is an explicit act by the lead, one person at a time. Nothing adds a reader automatically. */
export async function addBackupReaderAction(formData: FormData): Promise<void> {
  return leadAction(
    formData,
    (f) => {
      const p = idSchema.safeParse(f.get("profile"));
      const note = field(f, "note").trim().slice(0, 300);
      return p.success ? { p_profile: p.data, p_note: note === "" ? null : note } : null;
    },
    "add_safety_concern_backup_reader",
    "reader_added",
  );
}

export async function removeBackupReaderAction(formData: FormData): Promise<void> {
  return leadAction(formData, (f) => { const p = idSchema.safeParse(f.get("profile")); return p.success ? { p_profile: p.data } : null; }, "remove_safety_concern_backup_reader", "reader_removed");
}

export async function closeRetaliationReviewAction(formData: FormData): Promise<void> {
  return leadAction(
    formData,
    (f) => {
      const r = idSchema.safeParse(f.get("review"));
      const o = z.enum(RETALIATION_OUTCOMES).safeParse(field(f, "outcome"));
      const n = z.string().trim().min(10).max(1000).safeParse(field(f, "note"));
      return r.success && o.success && n.success ? { p_review: r.data, p_outcome: o.data, p_note: n.data } : null;
    },
    "close_retaliation_review",
    "review_closed",
  );
}

/** A clinician adds to their own concern. Only a clinician may; the database then checks it is theirs. */
export async function addToMyConcernAction(formData: FormData): Promise<void> {
  if ((await getCurrentClinicalStaff()) === null) return redirect("/clinician");
  const c = concern(formData);
  const b = z.string().trim().min(5).max(4000).safeParse(field(formData, "body"));
  if (!c.success || !b.success) return back("failed", MINE);
  const { error } = await loose(await createClient()).rpc("add_to_safety_concern", { p_concern: c.data, p_body: b.data });
  return back(error ? "failed" : "added", MINE);
}
