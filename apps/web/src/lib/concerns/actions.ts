"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { loadReaderStatus } from "./load";
import { idSchema, INCIDENT_SEVERITIES, READER_KINDS, RETALIATION_OUTCOMES, textSchema, type ConcernNotice } from "./model";

/**
 * S36i and S20 v2 server actions, run only when a person presses a button. The database is the protection (concern_visible,
 * credential_is_cmo, the minimum lengths, no admin reader); these checks refuse a person who may not act BEFORE the database is called
 * and give a clear notice first.
 *
 * INV-07: a concern's id arrives in the request body (a hidden field), never in an address; the address carries only a fixed
 * notice token and one of two fixed paths; a database error message is never shown or logged (it is replaced by the token "failed").
 */
const LEAD = "/clinician/quality/concerns";
const READER = "/reader/concerns";
const MINE = "/clinician/my-concerns";
const back = (n: ConcernNotice, path = LEAD): never => redirect(`${path}?n=${n}`);

const mayLead = async (): Promise<boolean> => canAssignCases(await getCurrentClinicalStaff());

/** A named reader (clinician or independent) may act on what the database lets them read; the lead always may. */
async function mayRead(): Promise<boolean> {
  if (await mayLead()) return true;
  const status = await loadReaderStatus();
  return status.ok && status.data.is_reader;
}

/** Which of the two fixed pages the action returns to. A hidden field can only choose between them. */
const pathOf = (f: FormData): string => (f.get("return") === "reader" ? READER : LEAD);

/** Runs one reader action: refuses a person who is neither lead nor reader first, validates the form, calls the database, returns only a token. */
async function readerAction(
  formData: FormData,
  parse: (f: FormData) => Record<string, unknown> | null,
  fn: string,
  ok: ConcernNotice,
): Promise<void> {
  const path = pathOf(formData);
  if (!(await mayRead())) return redirect("/clinician");
  const args = parse(formData);
  if (!args) return back("failed", path);
  const { error } = await loose(await createClient()).rpc(fn, args);
  return back(error ? "failed" : ok, path);
}

const concern = (f: FormData) => idSchema.safeParse(f.get("concern"));
const field = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function acknowledgeConcernAction(formData: FormData): Promise<void> {
  return readerAction(formData, (f) => { const c = concern(f); return c.success ? { p_concern: c.data } : null; }, "acknowledge_safety_concern", "acknowledged");
}

export async function respondToConcernAction(formData: FormData): Promise<void> {
  return readerAction(
    formData,
    (f) => { const c = concern(f); const b = textSchema(20).safeParse(field(f, "body")); return c.success && b.success ? { p_concern: c.data, p_body: b.data } : null; },
    "respond_to_safety_concern",
    "responded",
  );
}

export async function closeConcernAction(formData: FormData): Promise<void> {
  return readerAction(
    formData,
    (f) => { const c = concern(f); const n = textSchema(20).safeParse(field(f, "note")); return c.success && n.success ? { p_concern: c.data, p_note: n.data } : null; },
    "close_safety_concern",
    "closed",
  );
}

export async function openIncidentAction(formData: FormData): Promise<void> {
  return readerAction(
    formData,
    (f) => { const c = concern(f); const s = z.enum(INCIDENT_SEVERITIES).safeParse(field(f, "severity")); return c.success && s.success ? { p_concern: c.data, p_severity: s.data } : null; },
    "open_incident_for_concern",
    "incident_opened",
  );
}

/**
 * Naming a reader is an explicit act by the lead, one person at a time. Nothing adds a reader automatically. A clinician reader is chosen
 * from the staff list; an independent reader (an outside person or a colleague who is not the lead) is named by their account id.
 */
export async function addBackupReaderAction(formData: FormData): Promise<void> {
  if (!(await mayLead())) return redirect("/clinician");
  const kind = z.enum(READER_KINDS).safeParse(field(formData, "kind") || "clinician");
  const p = idSchema.safeParse(kind.success && kind.data === "independent" ? field(formData, "independent_profile").trim() : field(formData, "profile"));
  const note = field(formData, "note").trim().slice(0, 300);
  if (!kind.success || !p.success) return back("failed");
  const { error } = await loose(await createClient()).rpc("add_safety_concern_backup_reader", { p_profile: p.data, p_note: note === "" ? null : note, p_kind: kind.data });
  return back(error ? "failed" : "reader_added");
}

export async function removeBackupReaderAction(formData: FormData): Promise<void> {
  if (!(await mayLead())) return redirect("/clinician");
  const p = idSchema.safeParse(formData.get("profile"));
  if (!p.success) return back("failed");
  const { error } = await loose(await createClient()).rpc("remove_safety_concern_backup_reader", { p_profile: p.data });
  return back(error ? "failed" : "reader_removed");
}

export async function closeRetaliationReviewAction(formData: FormData): Promise<void> {
  return readerAction(
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

/** The raiser answers a detriment check-in ("fine" or "problem"). The words of a note are never put in an address. */
export async function answerCheckinAction(formData: FormData): Promise<void> {
  if ((await getCurrentClinicalStaff()) === null) return redirect("/clinician");
  const checkin = idSchema.safeParse(formData.get("checkin"));
  const answer = z.enum(["fine", "problem"]).safeParse(formData.get("answer"));
  const note = z.string().trim().max(2000).safeParse(field(formData, "note"));
  if (!checkin.success || !answer.success || !note.success) return back("failed", MINE);
  const { error } = await loose(await createClient()).rpc("answer_concern_checkin", { p_checkin: checkin.data, p_answer: answer.data, p_note: note.data === "" ? null : note.data });
  return back(error ? "failed" : "checkin_answered", MINE);
}
