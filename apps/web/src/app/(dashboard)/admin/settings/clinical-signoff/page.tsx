import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import { GOVERNED_CONFIG_TABLES, readGovernedConfigSignoff } from "@/lib/queries/governed-config-signoff";
import {
  SignoffChecklist,
  type ProtocolOption,
  type SettledItem,
  type SignedRule,
  type StaffOption,
  type UnsignedRule,
} from "./signoff-checklist";

/**
 * The "what still needs my signature, and what do I press" page.
 *
 * The sign-off queue on /admin/settings/clinical-protocols already reported
 * WHAT was outstanding, correctly. What it could not do was tell you what to
 * DO about it: for a clinical rule it said "needs an owner and a linked
 * signed protocol assigned (via a new draft version)", which is accurate and
 * almost unusable — the reader has to know that a shadow rule's governance
 * fields are immutable, that the fix is to duplicate it into a fresh draft,
 * and that the draft is the thing you sign. Seven rules sat unsigned from
 * 2026-08-29 to 2026-09-16 behind that sentence.
 *
 * This page is the same information with the next action attached to it, and
 * it deliberately renders ONLY what is actionable plus a short list of what
 * is already done, so "am I finished?" is answerable at a glance.
 */

/**
 * What actually changes for patients and clinicians when a rule goes live.
 * Keyed by rule_key so each sentence is specific rather than a generic
 * "this rule will start running" — the whole point is that someone signing
 * it can tell what they are agreeing to without reading a JSON condition
 * tree. A rule with no entry falls back to a plain, honest description
 * rather than an invented one.
 */
const WHAT_HAPPENS: Record<string, string> = {
  diagnostic_abnormal_screening_result_review:
    "An abnormal or critical screening result will automatically raise a clinical review task, instead of only being visible if someone looks. This is the prevention-to-chronic upgrade path.",
  engagement_repeated_missed_appointments:
    "A patient who repeatedly misses appointments gets flagged as disengaging, so the care team can reach out rather than lose them quietly.",
  htn_repeated_high_home_bp_review:
    "Repeated high home blood-pressure readings will raise a review task for the care team, rather than sitting in the patient's history unread.",
  medication_new_prescription_ckd_renal_monitoring:
    "Starting a new medication for a patient with CKD will prompt a renal-function recheck.",
  operational_missed_appointment_rebooking:
    "A missed appointment will prompt the patient to rebook promptly, rather than waiting for the next scheduled contact.",
  preventive_next_screening_after_normal_result:
    "A normal screening result will automatically schedule the next screening at the right interval.",
  referral_critical_screening_specialist_review:
    "A critical screening result will recommend a specialist referral for a doctor to review and act on.",
};

export default async function ClinicalSignoffPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const supabase = await createClient();

  const [rulesRes, staffRes, protocolsRes, configs] = await Promise.all([
    supabase
      .from("clinical_rules")
      .select("id, rule_key, version, name, description, category, status, approved_by, approved_at, owner_clinical_staff_id, protocol_version_id, clinical_staff:clinical_staff!clinical_rules_owner_clinical_staff_id_fkey(full_name), protocol_versions(title)")
      .in("status", ["draft", "shadow", "active"])
      .order("rule_key", { ascending: true })
      .order("version", { ascending: false }),
    // Care Coordinators are excluded on purpose: the ladder in CLAUDE.md is
    // explicit that a Care Coordinator never owns a clinical judgement, and
    // offering one in this dropdown would be offering to record exactly that.
    supabase
      .from("clinical_staff")
      .select("id, full_name, doctor_tier")
      .eq("active", true)
      .neq("doctor_tier", "care_coordinator")
      .order("full_name", { ascending: true }),
    supabase
      .from("protocol_versions")
      .select("id, protocol_id, title, version_number")
      .not("approved_by", "is", null)
      .order("title", { ascending: true }),
    readGovernedConfigSignoff(supabase),
  ]);

  if (rulesRes.error || staffRes.error || protocolsRes.error) {
    return (
      <LoadFailure>The sign-off checklist could not be loaded.</LoadFailure>
    );
  }

  const rules = rulesRes.data ?? [];

  // One row per rule_key: the newest version is the one that represents the
  // rule's current state. Showing every historical version here would turn a
  // seven-item checklist into a version-history browser, which is what
  // /admin/settings/clinical-rules already is.
  const newestByKey = new Map<string, (typeof rules)[number]>();
  for (const r of rules) {
    if (!newestByKey.has(r.rule_key)) newestByKey.set(r.rule_key, r);
  }
  const newest = [...newestByKey.values()];

  const unsignedRules: UnsignedRule[] = newest
    .filter((r) => !r.approved_by)
    .map((r) => ({
      id: r.id,
      rule_key: r.rule_key,
      version: r.version,
      name: r.name,
      description: r.description,
      category: r.category,
      status: r.status,
      whatHappens:
        WHAT_HAPPENS[r.rule_key] ??
        "This rule will start acting on real events instead of only being measured in shadow mode.",
    }));

  const signedRules: SignedRule[] = newest
    .filter((r) => r.approved_by)
    .map((r) => ({
      id: r.id,
      rule_key: r.rule_key,
      version: r.version,
      name: r.name,
      category: r.category,
      ownerName:
        (r as { clinical_staff?: { full_name: string } | null }).clinical_staff?.full_name ?? null,
      protocolTitle:
        (r as { protocol_versions?: { title: string } | null }).protocol_versions?.title ?? null,
      signedOn: r.approved_at ? new Date(r.approved_at).toISOString().slice(0, 10) : null,
      whatHappens:
        WHAT_HAPPENS[r.rule_key] ??
        "This rule acts on real events rather than only being measured in shadow mode.",
    }));


  // Read live, never hardcoded. A hardcoded "these are all signed" list is
  // exactly the kind of reassurance that goes stale silently — the page would
  // keep showing a green tick for a config somebody had since replaced with
  // an unsigned version.
  const settled: SettledItem[] = configs
    .filter((c) => c.signed)
    .map((c) => ({ key: c.table, title: c.title, detail: `version ${c.version}`, href: c.href }));

  const unsignedConfigs: SettledItem[] = configs
    .filter((c) => !c.signed)
    .map((c) => ({
      key: c.table,
      title: c.title,
      detail:
        c.version === null
          ? "no active version — nothing is configured yet"
          : `version ${c.version} is live and driving behaviour with no signature`,
      href: c.href,
    }));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-charcoal-ink">Clinical sign-off</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          Everything on the platform that needs a Clinical Director&apos;s signature before it may act
          on a patient, and the one action that signs it. You are signing that the rule matches a
          protocol you stand behind — not writing the rule, which is already fixed and cannot be
          edited here.
        </p>
      </div>

      <SignoffChecklist
        unsignedRules={unsignedRules}
        signedRules={signedRules}
        unsignedConfigs={unsignedConfigs}
        settled={settled}
        staff={(staffRes.data ?? []) as StaffOption[]}
        protocols={(protocolsRes.data ?? []) as ProtocolOption[]}
        totalConfigCount={GOVERNED_CONFIG_TABLES.length}
      />
    </div>
  );
}
