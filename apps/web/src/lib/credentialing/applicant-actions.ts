"use server";

import { createHash, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getProposedConfig } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runBestEffort } from "@/lib/sentry/run-best-effort";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getMyApplication, getMyCredentialStatus } from "./queries";
import { checkDocumentUpload } from "./files";
import { csv, endOfLagosDay, run, safeReturnTo, text, uuid } from "./action-helpers";
import { CredentialingError, rpcParsed, rpcVoid } from "./rpc";
import { startTestSchema, submitTestSchema } from "./schemas";

const HOME = "/account/clinician";

/** The applicant's own actions. Every database function re-checks that the caller owns the application. */

export async function startApplication(fd: FormData): Promise<void> {
  const back = safeReturnTo(fd.get("returnTo"), HOME);
  await run(back, async () => {
    await rpcParsed(await createClient(), "start_clinician_application", { p_employment_type: "contracted" }, z.string());
    return "Your application has started. Fill in your details and upload your documents.";
  });
}

const yearField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : null),
  z.number().int().min(1950).max(new Date().getFullYear() + 1).nullable(),
);

const detailsSchema = z.object({
  applicationId: uuid,
  mdcn_folio: z.string().max(40),
  qualification: z.string().max(120),
  graduation_year: yearField,
  nysc_year: yearField,
  years_since_house_job: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : null),
    z.number().min(0).max(60).nullable(),
  ),
});

function referee(fd: FormData, n: 1 | 2): Record<string, string> {
  return {
    name: text(fd, `referee${n}_name`),
    institution: text(fd, `referee${n}_institution`),
    phone: text(fd, `referee${n}_phone`),
    email: text(fd, `referee${n}_email`),
    relationship: text(fd, `referee${n}_relationship`),
  };
}

export async function saveApplicationDetails(fd: FormData): Promise<void> {
  const back = safeReturnTo(fd.get("returnTo"), HOME);
  await run(back, async () => {
    const parsed = detailsSchema.safeParse({
      applicationId: text(fd, "applicationId"),
      mdcn_folio: text(fd, "mdcn_folio"),
      qualification: text(fd, "qualification"),
      graduation_year: text(fd, "graduation_year"),
      nysc_year: text(fd, "nysc_year"),
      years_since_house_job: text(fd, "years_since_house_job"),
    });
    if (!parsed.success) throw new CredentialingError("Check the folio number and the years you entered.", "23514");
    const d = parsed.data;
    const declared = fd.get("conflicts_confirm") === "on";
    const indemnityExpiry = endOfLagosDay(text(fd, "indemnity_expires_on"));
    const details = {
      mdcn_folio: d.mdcn_folio,
      qualification: d.qualification,
      graduation_year: d.graduation_year,
      nysc_year: d.nysc_year,
      years_since_house_job: d.years_since_house_job,
      specialties: csv(text(fd, "specialties")),
      languages: csv(text(fd, "languages")),
      referees: [referee(fd, 1), referee(fd, 2)],
      conflicts_declaration: declared
        ? {
            pharmacy: fd.get("conflict_pharmacy") === "on",
            lab: fd.get("conflict_lab") === "on",
            hmo: fd.get("conflict_hmo") === "on",
            referee_relationship: fd.get("conflict_referee") === "on",
            notes: text(fd, "conflict_notes").slice(0, 500),
          }
        : null,
      indemnity_insurer: text(fd, "indemnity_insurer"),
      indemnity_policy_number: text(fd, "indemnity_policy_number"),
      indemnity_expires_at: indemnityExpiry,
    };
    await rpcVoid(await createClient(), "save_clinician_application", { p_application: d.applicationId, p_details: details });
    return "Your details are saved.";
  });
}

const kindSchema = z.enum([
  "mdcn_practising_licence",
  "mdcn_portal_screenshot",
  "graduation_certificate",
  "nysc_certificate",
  "government_id",
  "indemnity_certificate",
  "cv",
  "mdcn_confirmation",
]);

/**
 * Uploads one document. The bytes are checked here (size, real file type from the first bytes) before they reach
 * storage; the database function checks the folder, type and size again. With no applicationId this is a renewal
 * of an existing clinician's licence or indemnity certificate.
 */
export async function uploadCredentialDocument(fd: FormData): Promise<void> {
  const back = safeReturnTo(fd.get("returnTo"), HOME);
  await run(back, async () => {
    const kind = kindSchema.safeParse(text(fd, "kind"));
    if (!kind.success) throw new CredentialingError("Choose which document this is.", "23514");
    const appRaw = text(fd, "applicationId");
    const application = appRaw === "" ? null : uuid.safeParse(appRaw);
    if (application && !application.success) throw new CredentialingError("That application was not found.", "P0002");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new CredentialingError("Choose a file to upload.", "23514");

    const rules = getProposedConfig("credentialing.rules").value as { document_max_bytes: number };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkDocumentUpload({ bytes, claimedMime: file.type, maxBytes: rules.document_max_bytes });
    if (!check.ok) throw new CredentialingError(check.error, "23514");

    const profile = await getCurrentProfile();
    if (!profile?.organisation_id) throw new CredentialingError("Sign in again to continue.", "42501");
    const path = `${profile.organisation_id}/${profile.id}/${randomUUID()}.${check.type.ext}`;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const expiresOn = endOfLagosDay(text(fd, "expires_on"));

    const supabase = await createClient();
    // Only someone with an application or a clinician record may store a document at all.
    const [mine, staff] = await Promise.all([getMyApplication(), getMyCredentialStatus()]);
    if (!mine && !staff) throw new CredentialingError("Start your application before uploading documents.", "23514");

    // The bucket has no policy for signed-in users: the file is vetted above, then stored with the service role. The
    // database function confirms the object exists with the declared size and type before it records anything.
    const storage = createServiceRoleClient().storage.from("clinician-documents");
    const { error: uploadError } = await storage.upload(path, bytes, { contentType: check.type.mime, upsert: false });
    if (uploadError) throw new CredentialingError("We could not store that file. Please try again.", undefined);
    try {
      await rpcParsed(
        supabase,
        "register_clinician_document",
        {
          p_application: application?.data ?? null,
          p_kind: kind.data,
          p_storage_path: path,
          p_mime: check.type.mime,
          p_size: bytes.length,
          p_sha256: sha256,
          p_expires_at: expiresOn,
        },
        z.string(),
      );
    } catch (e) {
      // never leave a stored file with no record behind it; a failed removal is reported, not hidden
      await runBestEffort(async () => {
        const { error } = await storage.remove([path]);
        if (error) throw error;
      }, { area: "credentialing.orphan_upload_cleanup", path });
      throw e;
    }
    return "Document uploaded.";
  });
}

export async function submitApplication(fd: FormData): Promise<void> {
  const back = safeReturnTo(fd.get("returnTo"), HOME);
  await run(back, async () => {
    await rpcVoid(await createClient(), "submit_clinician_application", { p_application: uuid.parse(text(fd, "applicationId")) });
    return "Submitted. Your care team lead will check your documents and get in touch.";
  });
}

export async function completeTrainingModule(fd: FormData): Promise<void> {
  const back = safeReturnTo(fd.get("returnTo"), HOME);
  await run(back, async () => {
    await rpcVoid(await createClient(), "complete_training_module", {
      p_application: uuid.parse(text(fd, "applicationId")),
      p_module: uuid.parse(text(fd, "moduleId")),
    });
    return "Module marked as done.";
  });
}

/** Opens (or resumes) the test, then sends the person to the page that shows its scenarios. */
export async function beginTest(fd: FormData): Promise<void> {
  const back = safeReturnTo(fd.get("returnTo"), HOME);
  let failure: string | null = null;
  try {
    await rpcParsed(await createClient(), "start_credential_test", { p_application: uuid.parse(text(fd, "applicationId")) }, startTestSchema);
  } catch (e) {
    failure = e instanceof CredentialingError ? e.message : "Something went wrong. Please try again.";
  }
  if (failure) redirect(`${back}?error=${encodeURIComponent(failure)}`);
  redirect(`${HOME}/test`);
}

export async function submitTest(fd: FormData): Promise<void> {
  const attempt = text(fd, "attemptId");
  let target: string;
  try {
    const answers: Record<string, string> = {};
    for (const [key, value] of fd.entries()) {
      if (key.startsWith("answer:") && typeof value === "string") answers[key.slice("answer:".length)] = value;
    }
    const result = await rpcParsed(await createClient(), "submit_credential_test", { p_attempt: uuid.parse(attempt), p_answers: answers }, submitTestSchema);
    const note = result.passed
      ? "You passed the test. Your care team lead will review your application next."
      : result.safety_critical_missed > 0
        ? `Not passed this time. A safety-critical scenario was answered incorrectly. Attempts left: ${result.attempts_left}.`
        : `Not passed this time. Your score was ${result.score_percent} percent. Attempts left: ${result.attempts_left}.`;
    target = `${HOME}?${result.passed ? "ok" : "error"}=${encodeURIComponent(note)}`;
  } catch (e) {
    const message = e instanceof CredentialingError ? e.message : "Something went wrong. Please try again.";
    target = `${HOME}?error=${encodeURIComponent(message)}`;
  }
  redirect(target);
}
