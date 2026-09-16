"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SignoffActionState = { error?: string; success?: string } | undefined;

const PATHS = [
  "/admin/settings/clinical-signoff",
  "/admin/settings/clinical-rules",
  "/admin/settings/clinical-protocols",
];

/**
 * Sign one clinical rule in a single submit.
 *
 * WHY THIS EXISTS. Signing a shadow rule already worked, but only as a
 * three-step sequence spread across a page that never named it as a
 * sequence. `private.guard_clinical_rule_immutable` refuses to let
 * `owner_clinical_staff_id` or `protocol_version_id` change once a row
 * leaves `draft` — deliberately — so a shadow rule missing either one can
 * never be signed as it stands. It has to be duplicated into a fresh draft
 * carrying those two fields, and THAT draft signed. The rules page showed
 * "Cannot be signed yet. Assign an owner and link a signed protocol version
 * first" next to a form headed "Draft v2: assign owner & link protocol", and
 * left the reader to work out that the second sentence is how you satisfy
 * the first. Seven rules had sat unsigned since 2026-08-29.
 *
 * So this collapses the sequence into one action against the same guards.
 * It works WITH the immutability rule, exactly as
 * draftNextClinicalRuleVersionAction does — nothing here weakens a check:
 *
 *   1. duplicate the rule's clinical content into a new draft version,
 *      unchanged, with the chosen owner and protocol;
 *   2. call public.sign_clinical_rule on that draft, which is the real gate
 *      (active Clinical Director only, protocol and owner both required);
 *   3. retire the superseded shadow row, so the engine is not left
 *      shadow-executing last version's copy of a rule forever.
 *
 * Step 3 is cleanup and is deliberately non-fatal: the signature in step 2
 * is the thing that matters, and reporting "signing failed" because a
 * tidy-up write failed afterwards would be a lie about what happened.
 *
 * The signature recorded is the signed-in Clinical Director's, resolved
 * server-side by the RPC from `private.current_clinical_staff()`. Nothing
 * here lets a caller sign as somebody else.
 */
export async function signClinicalRuleWithGovernanceAction(
  _prev: SignoffActionState,
  formData: FormData
): Promise<SignoffActionState> {
  const supabase = await createClient();

  const sourceId = String(formData.get("source_id") ?? "").trim();
  const ownerStaffId = String(formData.get("owner_clinical_staff_id") ?? "").trim();
  const protocolVersionId = String(formData.get("protocol_version_id") ?? "").trim();
  const confirmed = formData.get("confirm") === "on";

  if (!sourceId) return { error: "No rule was selected." };
  if (!ownerStaffId) return { error: "Choose the doctor who will be accountable for this rule." };
  if (!protocolVersionId) return { error: "Choose the signed protocol this rule's thresholds come from." };
  if (!confirmed) {
    return {
      error:
        "Tick the confirmation box first. Signing puts this rule live and records your name against it.",
    };
  }

  const { data: source, error: sourceError } = await supabase
    .from("clinical_rules")
    .select(
      `id, rule_key, version, name, description, category, domain, event_type,
       population, conditions, actions, priority, specificity, escalation,
       suppression, explanation_template, effective_from, organisation_id, patient_id,
       status, owner_clinical_staff_id, protocol_version_id, approved_by`
    )
    .eq("id", sourceId)
    .single();

  if (sourceError || !source) {
    return { error: sourceError?.message ?? "That rule could not be found." };
  }
  // An already-signed rule is not an error: correcting a wrong protocol link
  // is a real and necessary act. The rules were first signed on 2026-09-16
  // when the only options were five condition-specific protocols, so
  // all-patient rules had to be linked to whichever one was in the list —
  // the critical-screening referral rule ended up recorded as deriving from
  // the menstrual cycle protocol. A governance link that is wrong reads as
  // deliberate, which is worse than one that is missing, so there has to be a
  // way to put it right.
  //
  // Correcting one is the same versioning flow as signing one: the signed row
  // is immutable, so a new version carries the corrected fields and
  // sign_clinical_rule retires the version it supersedes. Nothing is edited
  // in place and the original signature stays in the history.
  const isCorrection = Boolean(source.approved_by);

  if (
    isCorrection &&
    source.owner_clinical_staff_id === ownerStaffId &&
    source.protocol_version_id === protocolVersionId
  ) {
    return {
      error: `${source.name} already names that owner and that protocol — nothing would change.`,
    };
  }

  // A rule that already carries both governance fields and is not being
  // corrected needs no duplicate — signing it directly is the shorter, truer
  // path, and creating a pointless v+1 would clutter the version history.
  let idToSign = source.id;

  if (isCorrection || !source.owner_clinical_staff_id || !source.protocol_version_id) {
    // Highest existing version + 1, not source.version + 1: correcting an
    // already-corrected rule would otherwise collide with the version it
    // created, and clinical_rules is unique on (rule_key, version).
    const { data: versions } = await supabase
      .from("clinical_rules")
      .select("version")
      .eq("rule_key", source.rule_key)
      .order("version", { ascending: false })
      .limit(1);
    const nextVersion = (versions?.[0]?.version ?? source.version) + 1;
    const { data: draft, error: draftError } = await supabase
      .from("clinical_rules")
      .insert({
        rule_key: source.rule_key,
        version: nextVersion,
        name: source.name,
        description: source.description,
        category: source.category,
        domain: source.domain,
        event_type: source.event_type,
        population: source.population,
        conditions: source.conditions,
        actions: source.actions,
        priority: source.priority,
        specificity: source.specificity,
        escalation: source.escalation,
        suppression: source.suppression,
        explanation_template: source.explanation_template,
        effective_from: source.effective_from,
        organisation_id: source.organisation_id,
        patient_id: source.patient_id,
        owner_clinical_staff_id: ownerStaffId,
        protocol_version_id: protocolVersionId,
        supersedes_id: source.id,
        notes: isCorrection
          ? `Version ${nextVersion} of ${source.rule_key}, duplicated unchanged from v${source.version} to correct its governance link (owner and/or the signed protocol its thresholds come from). Clinical content is byte-identical to v${source.version}.`
          : `Version ${nextVersion} of ${source.rule_key}, duplicated unchanged from v${source.version} with an accountable owner and a signed protocol attached, then signed from the clinical sign-off checklist.`,
      })
      .select("id")
      .single();

    if (draftError || !draft) {
      return { error: draftError?.message ?? "Could not prepare this rule for signing." };
    }
    idToSign = draft.id;
  }

  const { error: signError } = await supabase.rpc("sign_clinical_rule", {
    p_id: idToSign,
    p_activate: true,
  });

  if (signError) {
    // The draft is left in place on purpose rather than deleted: it is a
    // valid, unsigned draft carrying the governance fields, so a retry (or a
    // different Director) can sign it without redoing the setup.
    return { error: signError.message };
  }

  // sign_clinical_rule already retires a superseded ACTIVE version, so a
  // correction needs no tidy-up. Only the first-time path leaves an orphan:
  // the original shadow row, which the engine would otherwise keep
  // shadow-executing alongside the newly active version forever.
  if (idToSign !== source.id && source.status === "shadow") {
    const { error: retireError } = await supabase.rpc("retire_clinical_rule", {
      p_id: source.id,
      p_reason: `Superseded by v${source.version + 1}, which was signed and activated.`,
    });
    if (retireError) {
      PATHS.forEach((p) => revalidatePath(p));
      return {
        success: `${source.name} is signed and live. One tidy-up step did not complete: the old shadow copy (v${source.version}) could not be retired (${retireError.message}) — it does not affect patients, but retire it on the clinical rules page when convenient.`,
      };
    }
  }

  PATHS.forEach((p) => revalidatePath(p));
  return {
    success: isCorrection
      ? `${source.name} now names the protocol you chose. The previous version is retired and stays in the history.`
      : `${source.name} is signed and live.`,
  };
}
