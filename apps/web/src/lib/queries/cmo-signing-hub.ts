import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { readSignoffQueue, SEVERITY_RANK, type SettledConfig, type SignoffQueueItem } from "@/lib/queries/signoff-queue";
import { readPendingAiGovernanceSignoff } from "@/lib/queries/pending-ai-governance-signoff";
import { readPendingCommunitySignoff } from "@/lib/queries/pending-community-signoff";
import { readCredentialAttention, credentialAttentionItem } from "@/lib/queries/credential-attention";
import { GLUCOSE_TRIAGE_ITEM_KEY, readPendingGlucoseTriageSignoff } from "@/lib/queries/pending-glucose-triage-signoff";
import { readS06S10Signoffs, EMPTY_S06S10, type S06S10Snapshot } from "@/lib/queries/s06-s10-signoffs";
import { readPendingQualityConfigSignoff } from "@/lib/queries/pending-quality-config-signoff";
import { readPendingCapacityConfigSignoff } from "@/lib/queries/pending-capacity-config-signoff";
import { readPendingPostCheckinSignoff } from "@/lib/queries/pending-post-checkin-signoff";
import { readPendingGlucoseTaskTypeSignoff } from "@/lib/queries/pending-glucose-task-type-signoff";
import { VITALS_TRIAGE_ITEM_KEY, readPendingVitalsTriageSignoff } from "@/lib/queries/pending-vitals-triage-signoff";
import { readPendingVitalsTaskTypeSignoff } from "@/lib/queries/pending-vitals-task-type-signoff";
import { readPendingRedOutreachSignoff } from "@/lib/queries/pending-red-outreach-signoff";
import { readPendingSoleCmoException } from "@/lib/queries/pending-sole-cmo-exception";
import { readThresholdHubState } from "@/lib/queries/threshold-overrides";
import { GLUCOSE_WORDING_SIGNED } from "@tarragon/i18n";
import { FAST_SUGAR_ITEM_KEY, readPendingFastSugarWordingSignoff } from "@/lib/queries/pending-fast-sugar-wording-signoff";
import { readUnifiedRedPagingState } from "@/lib/queries/pending-unified-red-paging-signoff";
import { readLegacyNoticeRetirementState } from "@/lib/queries/pending-legacy-notice-retirement-signoff";
import { readPendingQueuePagingConfigSignoff } from "@/lib/queries/pending-queue-paging-config-signoff";
import { readPendingBpDeviceReview } from "@/lib/queries/pending-bp-device-review";
import { readPendingSymptomUxSignoff } from "@/lib/queries/pending-symptom-ux-signoff";
import { readPendingMentalWellbeingSignoff } from "@/lib/queries/pending-mental-wellbeing-signoff";
import { MENTAL_WELLBEING_ITEM_KEY } from "@/lib/clinical/mental-wellbeing-signoff-model";

export type CmoSigningHub = {
  /** One line per thing that needs the Chief Medical Officer's signature, most urgent first. */
  items: SignoffQueueItem[];
  /** At least one read failed, so `items` may be short. Never render this state as an all-clear. */
  failed: boolean;
  /** Which sources could not be read, by name, so the warning can say what is missing. */
  failedSources: string[];
  /** Governed configurations whose live version is signed (for the "already signed" list). */
  settledConfigs: SettledConfig[];
  /** The S06 to S10 clinical items (C1 to C8) with their live state; its lines are already merged into `items`. */
  s06s10: S06S10Snapshot;
  /**
   * Things that need the CMO's attention but are not a signature (P5: overdue MDCN spot re-checks, clinicians with no verification
   * on record). Kept apart from `items` on purpose: the banner counts `items` as "areas that need your signature".
   */
  attention: SignoffQueueItem[];
};

/** The key the merged clinical-rules line carries, so the page can attach the guided signing forms to it. */
export const CLINICAL_RULES_ITEM_KEY = "clinical_rules";
/** The key the merged protocol-drafts line carries; the one manager lists every draft, so there is one line, not one per draft. */
export const PROTOCOL_DRAFTS_ITEM_KEY = "protocol_drafts";
/** The key the Community line carries (safety rules, group rules and the three statements), so the page can attach the signing checklist. */
export const COMMUNITY_ITEM_KEY = "community";
/** The key the red-alert outreach line carries (the call-the-patient task type, CMO Q11), so the page can attach the confirm panel. */
export const RED_OUTREACH_ITEM_KEY = "red_outreach";
/** The key the urgent glucose review task type line carries (R2, CMO Q7 and Q8), so the page can attach the confirm panel. */
export const GLUCOSE_TASK_TYPE_ITEM_KEY = "glucose_task_type";
/** The key the amber vitals review task type line carries (pulse, SpO2, temperature), so the page can attach the confirm panel. */
export const VITALS_TASK_TYPE_ITEM_KEY = "vitals_task_type";
/** The line for the S20 v2 quality and credentialing configuration drafts (audit sampling, second review, speak-up check-ins, licence notices). */
export const QUALITY_CONFIG_ITEM_KEY = "quality_configs";
/** The line for the capacity and cover configuration drafts (intake gate, hard rest rule, fire drills) and the pilot lead cap. */
export const CAPACITY_CONFIG_ITEM_KEY = "capacity_configs";
/** The line for the post-consultation check-in configuration (the questions, what each answer does, the 48 hour and 7 day timing). */
export const POST_CHECKIN_ITEM_KEY = "post_checkin_config";
/** The line for the ops desk resilience configuration draft (the checklist gate on the on-call cover guard, OQ-441). */
export const OPS_DESK_CONFIG_ITEM_KEY = "ops_desk_config";
/** The key the sole-CMO on-call exception line carries, so the page can attach the signing panel. */
export const SOLE_CMO_EXCEPTION_ITEM_KEY = "sole_cmo_on_call_exception";
/** The line for unified red-event paging (S19d): switch the one governed ladder on for SpO2, pulse, temperature, red-flag symptoms and emergency events, or off again. */
export const UNIFIED_RED_PAGING_ITEM_KEY = "unified_red_paging";
/** The line for the personal-threshold policy (N-overrides): nothing can be proposed until the CMO signs it. */
export const THRESHOLD_POLICY_ITEM_KEY = "threshold_override_policy";
/** The line for retiring the older notify-everyone message for blood pressure and glucose once the on-call page is proven, and the Care Circle notice for unified pages (S19f). */
export const LEGACY_NOTICE_RETIREMENT_ITEM_KEY = "legacy_notice_retirement";
/** OQ-451: the task layer configuration (accept the version in force, or sign a newer one). */
export const TASK_LAYER_CONFIG_ITEM_KEY = "queue_task_layer_config";
/** OQ-451: activate the paging delivery configuration v2 (objective on-call readiness), refused until the test-page checklist is met. */
export const PAGING_DELIVERY_CONFIG_ITEM_KEY = "paging_delivery_config";
/** S07y: recommended blood pressure monitors an admin entered that wait for the CMO to review them against a public validation registry. */
export const BP_DEVICE_REVIEW_ITEM_KEY = "bp_device_review";
/** S59c: the symptom checker assessment-experience configs (follow-up timing, describe-it words, why-this-result reasons, safety-net lines). */
export const SYMPTOM_UX_ITEM_KEY = "symptom_assessment_ux";
export { GLUCOSE_TRIAGE_ITEM_KEY, VITALS_TRIAGE_ITEM_KEY, FAST_SUGAR_ITEM_KEY, MENTAL_WELLBEING_ITEM_KEY };

/**
 * Everything that needs the Chief Medical Officer's signature, in one list.
 *
 * Before this the work was spread over three separate mechanisms — the
 * clinical sign-off checklist (rules + 8 governed configs), a banner for AI
 * governance, and a hub of per-page links on /admin that a CMO's `clinician`
 * login cannot open — so nobody could answer "what needs me?" without
 * visiting each. This is the one answer, built from the same readers the
 * admin hub and the banner already use so the counts cannot disagree.
 *
 * Links all point into /clinician/*: a CMO account is never `admin`.
 *
 * "Needs setup" and "ready to sign" clinical rules are merged into one line:
 * the guided form on the hub is where the owner and protocol are chosen, so
 * for the person signing there is no separate setup step to do first.
 *
 * Never throws. A read that fails sets `failed` rather than shortening the
 * list silently — the one wrong thing this page can say is "all clear".
 */
export async function readCmoSigningHub(supabase: SupabaseClient<Database>): Promise<CmoSigningHub> {
  const [queue, ai, community, s06s10, credentials, redOutreach, glucose, glucoseTaskType, vitals, vitalsTaskType, qualityConfigs, soleCmo, unifiedRed, capacityConfigs, fastSugar, queuePaging, legacyRetire, thresholds, bpDevices, postCheckin, mentalWellbeing, symptomUx] = await Promise.all([
    readSignoffQueue(supabase, "/clinician").catch(() => ({
      items: [] as SignoffQueueItem[],
      settledConfigs: [] as SettledConfig[],
      failedSources: ["the sign-off queue"],
    })),
    readPendingAiGovernanceSignoff(supabase),
    readPendingCommunitySignoff(supabase),
    readS06S10Signoffs(supabase).catch(() => ({ ...EMPTY_S06S10, failed: true, failedSources: ["the S06 to S10 items"] })),
    readCredentialAttention(supabase),
    readPendingRedOutreachSignoff(supabase),
    readPendingGlucoseTriageSignoff(supabase),
    readPendingGlucoseTaskTypeSignoff(supabase),
    readPendingVitalsTriageSignoff(supabase),
    readPendingVitalsTaskTypeSignoff(supabase),
    readPendingQualityConfigSignoff(supabase),
    readPendingSoleCmoException(supabase),
    readUnifiedRedPagingState(supabase),
    readPendingCapacityConfigSignoff(supabase),
    readPendingFastSugarWordingSignoff(supabase),
    readPendingQueuePagingConfigSignoff(supabase),
    readLegacyNoticeRetirementState(supabase),
    readThresholdHubState(supabase),
    readPendingBpDeviceReview(supabase),
    readPendingPostCheckinSignoff(supabase),
    readPendingMentalWellbeingSignoff(supabase),
    readPendingSymptomUxSignoff(supabase),
  ]);

  const items: SignoffQueueItem[] = [];
  let ruleCount = 0;
  const protocolDrafts: SignoffQueueItem[] = [];
  for (const item of queue.items) {
    if (item.key === "clinical_rules_needs_setup" || item.key === "clinical_rules_ready") {
      ruleCount += item.count ?? 0;
      continue;
    }
    if (item.key.startsWith("protocol_draft:")) {
      protocolDrafts.push(item);
      continue;
    }
    items.push(item);
  }

  if (protocolDrafts.length > 0) {
    const titles = protocolDrafts.map((d) => d.title);
    items.push({
      key: PROTOCOL_DRAFTS_ITEM_KEY,
      title: "Clinical protocol drafts",
      detail: `${protocolDrafts.length} draft${protocolDrafts.length === 1 ? "" : "s"} waiting to be promoted and signed: ${titles.slice(0, 3).join(", ")}${titles.length > 3 ? ` and ${titles.length - 3} more` : ""}.`,
      href: "/clinician/protocols",
      severity: "draft_pending",
      count: protocolDrafts.length,
    });
  }

  if (ruleCount > 0) {
    items.push({
      key: CLINICAL_RULES_ITEM_KEY,
      title: "Clinical rules",
      detail: `${ruleCount} rule${ruleCount === 1 ? "" : "s"} waiting. For each, pick the doctor accountable and the signed protocol it comes from, then sign.`,
      href: "/clinician/clinical-rules",
      severity: "draft_pending",
      count: ruleCount,
    });
  }

  if (ai.attentionCount > 0) {
    const parts = [
      ai.pendingVersionApprovalCount > 0 &&
        `${ai.pendingVersionApprovalCount} AI system version${ai.pendingVersionApprovalCount === 1 ? "" : "s"} to approve`,
      ai.pendingClinicalAccuracyLabelCount > 0 &&
        `${ai.pendingClinicalAccuracyLabelCount} clinical-accuracy scenario${ai.pendingClinicalAccuracyLabelCount === 1 ? "" : "s"} for your tier judgement`,
    ].filter(Boolean);
    items.push({
      key: "ai_governance",
      title: "AI governance",
      detail: `${parts.join(" and ")}.`,
      href: "/clinician/ai-governance",
      severity: "draft_pending",
      count: ai.attentionCount,
    });
  }

  if (community.attentionCount > 0) {
    const parts = [
      community.rulesUnsigned && "the emergency and self-harm rules to sign",
      community.groupsWaiting > 0 && `${community.groupsWaiting} group rule set${community.groupsWaiting === 1 ? "" : "s"} to approve`,
      community.statementsWaiting > 0 && `${community.statementsWaiting} statement${community.statementsWaiting === 1 ? "" : "s"} to record`,
    ].filter(Boolean);
    items.push({
      key: COMMUNITY_ITEM_KEY,
      title: "Community groups",
      detail: `${parts.join(", ")}. Nothing is live for members until you switch it on.`,
      href: "/clinician/community/signoff",
      severity: "draft_pending",
      count: community.attentionCount,
    });
  }

  const credentialItem = credentialAttentionItem(credentials);
  const attention = credentialItem ? [credentialItem] : [];
  if (thresholds.reviewsOverdue > 0) {
    // Not a signature: the monthly review of a personal threshold is overdue. Kept out of `items` so the banner still counts only signatures.
    attention.push({
      key: "threshold_override_reviews",
      title: "Personal thresholds: monthly review overdue",
      detail: `${thresholds.reviewsOverdue} personal alert threshold${thresholds.reviewsOverdue === 1 ? " is" : "s are"} past the monthly review date. Keep or end each one.`,
      href: "/clinician/threshold-overrides",
      severity: "draft_pending",
      count: thresholds.reviewsOverdue,
    });
  }
  if (thresholds.policyWaiting) {
    items.push({
      key: THRESHOLD_POLICY_ITEM_KEY,
      title: "Personal alert thresholds: sign the policy to switch the feature on",
      detail: "Senior doctors can set a signed, time-limited personal threshold for a patient whose usual readings sit outside the standard lines. It can never lower a red, relax a reading with a symptom or apply in pregnancy or under 18. Nothing can be proposed until you sign.",
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: 1,
    });
  }
  // Signed on the hub but not yet in the app: the proposed fast-sugar text reaches patients only when the build marks the wording signed (a code change).
  if (fastSugar.signed && GLUCOSE_WORDING_SIGNED === null) {
    attention.push({
      key: `${FAST_SUGAR_ITEM_KEY}_not_shipped`,
      title: "Fast-sugar wording is signed but not yet in the app",
      detail: "Your signature is recorded. Patients still see the plain text until the app build marks the wording signed (a code change). Ask the build owner to ship it.",
      href: "/clinician/go-live#glucose_fast_sugar_wording",
      severity: "draft_pending",
    });
  }
  if (redOutreach.waiting) {
    items.push({
      key: RED_OUTREACH_ITEM_KEY,
      title: "Red alert outreach (call the patient)",
      detail: "A Member's red alert that is not confirmed within the time you chose opens a call-the-patient task for the clinician on call. The task type needs your confirmation before any task is created.",
      href: "/clinician/task-types",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (soleCmo.waiting) {
    items.push({
      key: SOLE_CMO_EXCEPTION_ITEM_KEY,
      title: "Sole-CMO on-call exception: sign to be allowed on the on-call rota",
      detail: "You are the only Chief Medical Officer, and the rule that nobody grants their own competencies keeps you off the on-call rota. A documented exception, signed by you, lets you grant yourself the on-call competency and nothing else.",
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: 1,
    });
  }

  items.push(...s06s10.items);

  if (glucoseTaskType.waiting) {
    items.push({
      key: GLUCOSE_TASK_TYPE_ITEM_KEY,
      title: "Urgent glucose review (task type)",
      detail: "The task a doctor gets for an urgent same-day glucose reading needs your confirmation. Until you confirm it, the glucose rules cannot be signed.",
      href: "/clinician/task-types",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (glucose.pending) {
    items.push({
      key: GLUCOSE_TRIAGE_ITEM_KEY,
      title: `Glucose triage rules, version ${glucose.version}`,
      detail: `Version ${glucose.version} is a draft waiting for your signature, with the guideline basis of every rule and the patient wording in full.${glucose.approvedVersion !== null ? ` Version ${glucose.approvedVersion} stays in force until you sign.` : " Until you sign, glucose readings are graded in shadow only and the older glucose alerts keep running."}`,
      href: "/clinician/glucose-triage-rules",
      severity: "draft_pending",
    });
  }

  if (vitalsTaskType.waiting) {
    items.push({
      key: VITALS_TASK_TYPE_ITEM_KEY,
      title: "Amber vitals review (task type)",
      detail: "The task a doctor gets for a pulse, oxygen or temperature reading that is outside the usual range but not an emergency needs your confirmation. Until you confirm it, the vitals rules cannot be signed.",
      href: "/clinician/task-types",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (fastSugar.waiting) {
    items.push({
      key: FAST_SUGAR_ITEM_KEY,
      title: "Fast-sugar treatment wording (separate from the glucose rules)",
      detail: "The message that tells a patient with a low sugar to take fast sugar (a sweet drink, sugar or honey, about 15 grams, and to check again in 15 minutes) needs its own signature. It stays unsigned, and the plain text stays in use, until you sign.",
      href: "/clinician/go-live#glucose_fast_sugar_wording",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (vitals.pending) {
    items.push({
      key: VITALS_TRIAGE_ITEM_KEY,
      title: `Pulse, oxygen and temperature triage rules, version ${vitals.version}`,
      detail: `Version ${vitals.version} is a draft waiting for your signature, with the guideline basis of every rule (including how it compares with NEWS2) and the patient wording in full.${vitals.approvedVersion !== null ? ` Version ${vitals.approvedVersion} stays in force until you sign.` : " Until you sign, these readings are graded in shadow only and the older alerts keep running."}`,
      href: "/clinician/vitals-triage-rules",
      severity: "draft_pending",
    });
  }

  if (qualityConfigs.qualityVersion !== null || qualityConfigs.credentialingVersion !== null) {
    const parts = [
      qualityConfigs.qualityVersion !== null && `quality configuration version ${qualityConfigs.qualityVersion} (audit sampling, second review, speak-up check-ins)`,
      qualityConfigs.credentialingVersion !== null && `credentialing configuration version ${qualityConfigs.credentialingVersion} (licence notices, shifts after expiry)`,
    ].filter(Boolean);
    items.push({
      key: QUALITY_CONFIG_ITEM_KEY,
      title: "Quality and licence rules",
      detail: `${parts.join(" and ")} waiting for your signature. They stay off until you sign.`,
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: (qualityConfigs.qualityVersion !== null ? 1 : 0) + (qualityConfigs.credentialingVersion !== null ? 1 : 0),
    });
  }

  if (unifiedRed.liveVersion !== null || unifiedRed.waitingVersion !== null) {
    const on = unifiedRed.liveVersion !== null;
    items.push({
      key: UNIFIED_RED_PAGING_ITEM_KEY,
      title: on ? "Unified red-event paging is ON (switch off here)" : "Unified red-event paging (off)",
      detail: on
        ? `Version ${unifiedRed.liveVersion} is live: low oxygen, dangerous heart rate, high temperature, red-flag symptoms and emergency events page the clinician on call. You can switch it off at any time; open pages are left alone.`
        : `Version ${unifiedRed.waitingVersion} is ready and OFF. Run the staging test pack, then switch it on here. Until you do, those events notify every clinician as before.`,
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (legacyRetire.liveVersion !== null || legacyRetire.waiting.length > 0) {
    const on = legacyRetire.liveVersion !== null;
    items.push({
      key: LEGACY_NOTICE_RETIREMENT_ITEM_KEY,
      title: on ? "Older clinician-message retirement is ON (switch off here)" : "Older clinician-message retirement (off)",
      detail: on
        ? `Version ${legacyRetire.liveVersion?.version} is live. You can switch it off at any time; any held message with no confirmed page is sent at once.`
        : "Several versions are ready and OFF. Start with the parallel run (it changes nothing and measures how often the on-call page arrives), then look at the evidence here before retiring any older message.",
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (capacityConfigs.capacityVersion !== null || capacityConfigs.leadVersion !== null) {
    const parts = [
      capacityConfigs.capacityVersion !== null && `capacity configuration version ${capacityConfigs.capacityVersion} (intake gate, rest rule, fire drills)`,
      capacityConfigs.leadVersion !== null && `lead configuration version ${capacityConfigs.leadVersion} (patient cap per lead)`,
    ].filter(Boolean);
    items.push({
      key: CAPACITY_CONFIG_ITEM_KEY,
      title: "Capacity, rest and fire drills",
      detail: `${parts.join(" and ")} waiting for your signature. They stay off until you sign.`,
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: (capacityConfigs.capacityVersion !== null ? 1 : 0) + (capacityConfigs.leadVersion !== null ? 1 : 0),
    });
  }

  if ((capacityConfigs.opsDeskVersion ?? null) !== null) {
    items.push({
      key: OPS_DESK_CONFIG_ITEM_KEY,
      title: "Ops desk checklist gate",
      detail: `ops desk configuration version ${capacityConfigs.opsDeskVersion} waiting for your signature. It stays off until you sign: signing it stops the on-call cover guard being switched on until the resilience checklist is attested and a primary and deputy ops contact are active.`,
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (queuePaging.taskLayer !== null) {
    const ask = queuePaging.taskLayer;
    items.push({
      key: TASK_LAYER_CONFIG_ITEM_KEY,
      title: ask.kind === "sign_new" ? "Task layer rules: sign a new version" : "Task layer rules: accept the version in force",
      detail:
        ask.kind === "sign_new"
          ? `Task layer configuration version ${ask.version} is a draft waiting for your signature. Signing it makes it the version in force; the old one stays on record.`
          : `Task layer configuration version ${ask.version} is already running (offer windows, who can take an escalated task, hand-back rules, completion codes, watchdog limits) but has never been signed. Signing records that you accept it and changes nothing else.`,
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (queuePaging.pagingVersion !== null) {
    items.push({
      key: PAGING_DELIVERY_CONFIG_ITEM_KEY,
      title: "Pager readiness gate: activate version " + queuePaging.pagingVersion,
      detail: `Paging delivery configuration version ${queuePaging.pagingVersion} turns on the objective on-call readiness check. It cannot be activated until every on-call clinician has a working push subscription, a verified email and an acknowledged test page.`,
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (bpDevices.waiting > 0) {
    items.push({
      key: BP_DEVICE_REVIEW_ITEM_KEY,
      title: "Recommended blood pressure monitors to review",
      detail: `${bpDevices.waiting} monitor${bpDevices.waiting === 1 ? "" : "s"} entered with a validation source, waiting for your review. Nothing is shown to patients as checked until you review it against the public registry.`,
      href: "/clinician/recommended-devices",
      severity: "draft_pending",
      count: bpDevices.waiting,
    });
  }

  if (postCheckin.version !== null) {
    items.push({
      key: POST_CHECKIN_ITEM_KEY,
      title: "Check-ins after a consultation",
      detail: `Check-in configuration version ${postCheckin.version} (the questions, what each answer does, and the 48 hour and 7 day timing) is waiting for your signature. No check-in is sent until you sign and an admin switches the guard on.`,
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (symptomUx.waiting.length > 0) {
    items.push({
      key: SYMPTOM_UX_ITEM_KEY,
      title: "Symptom checker: follow-up, describe-it, reasons and safety-net wording",
      detail: `${symptomUx.waiting.length} draft${symptomUx.waiting.length === 1 ? "" : "s"} (${symptomUx.waiting.map((w) => `${w.kind.replace("_", " ")} version ${w.version}`).join(", ")}) waiting for your signature. Each is shown in full. Until you sign one, the feature it drives stays on its safe default, and the symptom checker itself stays behind its own go-live guard.`,
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: symptomUx.waiting.length,
    });
  }
  // S56b: the follow-up list rules to sign and the attestations the four wellbeing guards need. Nothing here signs or switches anything.
  const mentalWellbeingPending = (mentalWellbeing.worklistVersion !== null ? 1 : 0) + mentalWellbeing.attestations.length;
  if (mentalWellbeingPending > 0) {
    items.push({
      key: MENTAL_WELLBEING_ITEM_KEY,
      title: "Mental wellbeing: follow-up list, share with my care team, calm tool, patterns",
      detail: `${mentalWellbeingPending} thing${mentalWellbeingPending === 1 ? "" : "s"} waiting for you${mentalWellbeing.worklistVersion !== null ? ` (the follow-up list rules, version ${mentalWellbeing.worklistVersion}, to sign)` : ""}. Nothing is shown to a patient or a clinician until you record or sign these and switch the matching guard on.`,
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: mentalWellbeingPending,
    });
  }

  const failedSources = [
    ...queue.failedSources,
    ...s06s10.failedSources,
    ...(ai.failed ? ["AI governance"] : []),
    ...(community.failed ? ["Community"] : []),
    ...(credentials.failed ? ["Clinician registration checks"] : []),
    ...(redOutreach.failed ? ["Red alert outreach"] : []),
    ...(glucose.failed ? ["the glucose triage rules"] : []),
    ...(glucoseTaskType.failed ? ["the urgent glucose review task type"] : []),
    ...(vitals.failed ? ["the pulse, oxygen and temperature triage rules"] : []),
    ...(vitalsTaskType.failed ? ["the amber vitals review task type"] : []),
    ...(qualityConfigs.failed ? ["the quality and credentialing configurations"] : []),
    ...(soleCmo.failed ? ["the sole-CMO on-call exception"] : []),
    ...(unifiedRed.failed ? ["unified red-event paging"] : []),
    ...(legacyRetire.failed ? ["the older clinician-message retirement"] : []),
    ...(capacityConfigs.failed ? ["the capacity and lead configurations"] : []),
    ...(thresholds.failed ? ["personal alert thresholds"] : []),
    ...(fastSugar.failed ? ["the fast-sugar wording signature"] : []),
    ...(queuePaging.failed ? ["the task layer and paging delivery configurations"] : []),
    ...(bpDevices.failed ? ["the recommended blood pressure monitors"] : []),
    ...(postCheckin.failed ? ["the check-in configuration"] : []),
    ...(symptomUx.failed ? ["the symptom checker assessment wording and timing"] : []),
    ...(mentalWellbeing.failed ? ["the mental wellbeing sign-offs"] : []),
  ];
  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  // A banner row may only link to a hub line that exists. The banner reads its own copy of the state, so if the two ever disagree (a row it
  // thinks is waiting that the queue does not list) the link falls back to the item's own page rather than pointing at a missing anchor.
  const lineKeys = new Set(items.map((i) => i.key));
  const banner: S06S10Snapshot = { ...s06s10, rows: s06s10.rows.map((r) => (r.panelKey && !lineKeys.has(r.panelKey) ? { ...r, panelKey: null } : r)) };
  return { items, failed: failedSources.length > 0, failedSources, settledConfigs: queue.settledConfigs, s06s10: banner, attention };
}
