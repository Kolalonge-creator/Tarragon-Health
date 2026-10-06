"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { endOfLagosDay, run, safeReturnTo, text, uuid } from "./action-helpers";
import { paragraphsToContent, parseOptions } from "./content";
import { CredentialingError, rpcParsed, rpcVoid } from "./rpc";
import { COMPETENCY_CODES } from "./labels";

/**
 * Reviewer (admin or Chief Medical Officer) and CMO-only actions (S15). The screens decide who sees which button;
 * the database decides who may actually do it, and its refusal is what the person reads. Nothing here is trusted
 * because a button was visible.
 */
const FALLBACK = "/admin/credentialing";

function back(fd: FormData): string {
  return safeReturnTo(fd.get("returnTo"), FALLBACK);
}

async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  await rpcVoid(await createClient(), fn, args);
}

export async function beginChecks(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("begin_credential_checks", { p_application: uuid.parse(text(fd, "applicationId")) });
    return "Checks started.";
  });
}

export async function setEmploymentType(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    const type = z.enum(["employed", "contracted"]).parse(text(fd, "employment_type"));
    await call("set_application_employment_type", { p_application: uuid.parse(text(fd, "applicationId")), p_employment_type: type });
    return "Employment type saved.";
  });
}

export async function verifyDocument(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("verify_clinician_document", { p_document: uuid.parse(text(fd, "documentId")), p_note: text(fd, "note") || null });
    return "Document marked as checked.";
  });
}

const checkKind = z.enum(["licence", "qualifications", "identity", "practice_years", "referee_1", "referee_2"]);

export async function recordCheck(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    const kind = checkKind.parse(text(fd, "kind"));
    const result = z.enum(["passed", "failed"]).parse(text(fd, "result"));
    const isReferee = kind === "referee_1" || kind === "referee_2";
    const details = isReferee
      ? {
          contact_source: text(fd, "contact_source"),
          confirmed_back: fd.get("confirmed_back") === "on",
          called_on: text(fd, "called_on") || null,
          contact_used: text(fd, "contact_used").slice(0, 200),
        }
      : {};
    const licenceExpiry = kind === "licence" ? endOfLagosDay(text(fd, "licence_expires_on")) : null;
    await call("record_credential_check", {
      p_application: uuid.parse(text(fd, "applicationId")),
      p_kind: kind,
      p_result: result,
      p_notes: text(fd, "notes").slice(0, 1000) || null,
      p_details: details,
      p_licence_expires_at: licenceExpiry,
    });
    return result === "passed" ? "Check recorded as passed." : "Check recorded as failed.";
  });
}

function reason(fd: FormData): string {
  const r = text(fd, "reason");
  if (r.length < 10) throw new CredentialingError("Give a reason of at least 10 characters.", "23514");
  return r.slice(0, 1000);
}

export async function rejectApplication(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("reject_clinician_application", { p_application: uuid.parse(text(fd, "applicationId")), p_reason: reason(fd) });
    return "Application marked as not approved.";
  });
}

export async function approveApplication(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    const levelRaw = text(fd, "level");
    const level = levelRaw === "" ? null : z.coerce.number().int().min(1).max(2).parse(levelRaw);
    const competencies = fd.getAll("competency").filter((v): v is string => typeof v === "string" && COMPETENCY_CODES.includes(v));
    await rpcParsed(
      await createClient(),
      "approve_clinician_application",
      { p_application: uuid.parse(text(fd, "applicationId")), p_level: level, p_competencies: competencies },
      z.string(),
    );
    return "Approved. Switch them on when they are ready to start.";
  });
}

export async function activateClinician(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("activate_clinician", { p_application: uuid.parse(text(fd, "applicationId")) });
    return "They are now active.";
  });
}

export async function grantTestRetake(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("grant_test_retake", { p_application: uuid.parse(text(fd, "applicationId")), p_reason: reason(fd) });
    return "One more attempt allowed.";
  });
}

export async function suspendClinician(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("suspend_clinician", { p_staff: uuid.parse(text(fd, "staffId")), p_reason: reason(fd) });
    return "Access paused.";
  });
}

export async function reinstateClinician(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("reinstate_clinician", { p_staff: uuid.parse(text(fd, "staffId")), p_reason: reason(fd) });
    return "Access restored.";
  });
}

export async function offboardClinician(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("offboard_clinician", { p_staff: uuid.parse(text(fd, "staffId")), p_reason: reason(fd) });
    return "They have left the network. Their documents are kept for the retention period.";
  });
}

export async function renewCredential(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    const kind = z.enum(["licence", "indemnity"]).parse(text(fd, "kind"));
    const expiry = endOfLagosDay(text(fd, "expires_on"));
    if (!expiry) throw new CredentialingError("Enter the new expiry date.", "23514");
    await call("renew_clinician_credential", {
      p_staff: uuid.parse(text(fd, "staffId")),
      p_kind: kind,
      p_expires_at: expiry,
      p_document: uuid.parse(text(fd, "documentId")),
    });
    return "Renewal recorded.";
  });
}

export async function grantGrace(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    const days = z.coerce.number().int().min(1).max(365).parse(text(fd, "days"));
    await rpcParsed(
      await createClient(),
      "grant_credential_grace",
      { p_staff: uuid.parse(text(fd, "staffId")), p_kind: z.enum(["licence", "indemnity"]).parse(text(fd, "kind")), p_days: days, p_reason: reason(fd) },
      z.string(),
    );
    return "Grace period recorded and the clinician has been told.";
  });
}

export async function revokeGrace(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("revoke_credential_grace", { p_grace: uuid.parse(text(fd, "graceId")) });
    return "Grace period ended.";
  });
}

const competency = z.enum(COMPETENCY_CODES as [string, ...string[]]);

export async function grantCompetency(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("grant_clinician_competency", { p_staff: uuid.parse(text(fd, "staffId")), p_code: competency.parse(text(fd, "code")) });
    return "Competency granted.";
  });
}

export async function revokeCompetency(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("revoke_clinician_competency", { p_staff: uuid.parse(text(fd, "staffId")), p_code: competency.parse(text(fd, "code")) });
    return "Competency removed.";
  });
}

export async function setLevel(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    const level = z.coerce.number().int().min(1).max(2).parse(text(fd, "level"));
    await call("set_clinician_level", { p_staff: uuid.parse(text(fd, "staffId")), p_level: level, p_reason: reason(fd) });
    return "Level changed.";
  });
}

// ---- Content: written and approved by the Chief Medical Officer only (the database enforces it) ----

export async function saveTestCase(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    const options = parseOptions(text(fd, "options"));
    if (!options) throw new CredentialingError("Write each option on its own line like  a | the answer  (at least two, with different ids).", "23514");
    const idRaw = text(fd, "id");
    await rpcParsed(
      await createClient(),
      "save_credential_test_case",
      {
        p_id: idRaw === "" ? null : uuid.parse(idRaw),
        p_code: z.string().min(1).max(60).parse(text(fd, "code")),
        p_scenario: z.string().min(10).max(2000).parse(text(fd, "scenario")),
        p_options: options,
        p_correct_option_id: text(fd, "correct_option_id"),
        p_is_red: fd.get("is_red") === "on",
        p_rationale: text(fd, "rationale").slice(0, 2000),
      },
      z.string(),
    );
    return "Saved as a draft. It cannot be used until you approve it.";
  });
}

export async function saveTrainingModule(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    const paragraphs = paragraphsToContent(text(fd, "content"));
    const idRaw = text(fd, "id");
    await rpcParsed(
      await createClient(),
      "save_training_module",
      {
        p_id: idRaw === "" ? null : uuid.parse(idRaw),
        p_code: z.string().min(1).max(60).parse(text(fd, "code")),
        p_title: z.string().min(3).max(160).parse(text(fd, "title")),
        p_summary: text(fd, "summary").slice(0, 500),
        p_content: paragraphs,
        p_minutes: z.coerce.number().int().min(1).max(120).parse(text(fd, "minutes") || "10"),
      },
      z.string(),
    );
    return "Saved as a draft. It cannot be used until you approve it.";
  });
}

export async function approveContent(fd: FormData): Promise<void> {
  await run(back(fd), async () => {
    await call("approve_credential_content", { p_kind: z.enum(["test_case", "training_module"]).parse(text(fd, "kind")), p_id: uuid.parse(text(fd, "id")) });
    return "Approved. It is now in use.";
  });
}
