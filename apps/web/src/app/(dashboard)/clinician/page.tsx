import Link from "next/link";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { DOCTOR_TIER_LABEL, DOCTOR_TIER_AUTHORITY_BLURB } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { LoadFailure } from "@/components/ui/load-failure";
import { ClinicalStaffSetupWarning } from "@/components/clinical/clinical-staff-setup-warning";
import { formatNumber } from "@/lib/analytics/format";
import { getLagosGreetingWord, type GreetingWord } from "@/lib/greeting";
import { LEVEL_BADGE, ESCALATION_STATUS_BADGE } from "@/lib/worklist/level-badge";
import { createClient } from "@/lib/supabase/server";
import { SEMANTIC_ICON } from "@/lib/icons";
import { credentialMonitorSchema } from "@/lib/queries/provider-quality";
import { Worklist } from "./worklist";
import { RedFlagAttestation } from "./red-flag-attestation";
import { AttestationCard } from "./attestation-card";
import { HtnAttestationCard } from "./htn-attestation-card";
import type { EscalationLevel } from "@tarragon/shared";

type OverviewEscalationRow = {
  id: string;
  reason: string;
  status: "open" | "under_review" | "resolved" | "referred";
  patient: { full_name: string | null } | null;
  clinician_alert: { level: EscalationLevel; sla_due_at: string | null } | null;
};

type PendingAutoDraftedNoteRow = {
  id: string;
  patient_id: string;
  encounter_type: string;
  reason_for_encounter: string;
  encounter_date: string;
  patient: { full_name: string | null } | null;
};

const ENCOUNTER_TYPE_LABEL: Record<string, string> = {
  video_consult: "Video consult",
  async_consult: "Async consult",
  in_person: "In person",
  phone: "Phone",
  escalation_review: "Escalation review",
  other: "Other",
};

const LEVEL_PRIORITY: Record<EscalationLevel, number> = {
  emergency: 0,
  specialist_review: 1,
  urgent_escalation: 2,
  clinician_review: 3,
  routine: 4,
};

const GREETING_LABEL: Record<GreetingWord, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
};

/** Lagos-local time of day (CLAUDE.md: timezone always Africa/Lagos), not the
 * server's own — shares lib/greeting.ts with the patient dashboard rather
 * than a second local implementation of the same Lagos-hour bucketing. */
function greetingWord(now: Date): string {
  return GREETING_LABEL[getLagosGreetingWord(now)];
}

function initials(name: string | null | undefined): string {
  if (!name) return "•";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "•"
  );
}

export default async function ClinicianPage() {
  const profile = await getCurrentProfile();
  const staff = await getCurrentClinicalStaff();

  // Red-flag attestation status (AHC pathway §26) — shown only to an active
  // clinical_staff member. Resolves the caller's staff row + latest attestation.
  const supabase = await createClient();
  const { data: attestationStaff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", profile?.id ?? "")
    .eq("active", true)
    .maybeSingle();
  let attestationExpiresAt: string | null = null;
  let htnAttestationExpiresAt: string | null = null;
  if (attestationStaff) {
    const { data: latest } = await supabase
      .from("clinical_staff_attestations")
      .select("expires_at")
      .eq("clinical_staff_id", attestationStaff.id)
      .eq("attestation_version", "AHC-2026-v1")
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    attestationExpiresAt = latest?.expires_at ?? null;

    // H17 (TH-CP-HTN-001 §14.7/§23) — separate attestation_version row, same
    // clinical_staff_attestations table. `enforce_htn_alert_attestation`
    // checks exactly this version string; keep them in sync.
    const { data: latestHtn } = await supabase
      .from("clinical_staff_attestations")
      .select("expires_at")
      .eq("clinical_staff_id", attestationStaff.id)
      .eq("attestation_version", "htn-red-flags-v1")
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    htnAttestationExpiresAt = latestHtn?.expires_at ?? null;
  }

  // Unified doctor dashboard (founder decision 2026-07-31): every doctor,
  // any tier, gets the same page access — doctor_tier still drives clinical
  // authority (prescribing, refill-confirmation), just not which pages a
  // doctor can reach. Falls back to a generic label when the caller has no
  // clinical_staff row yet (e.g. newly added, tier not assigned).
  const roleLabel = staff?.doctor_tier ? DOCTOR_TIER_LABEL[staff.doctor_tier] : "Doctor";
  const authorityBlurb = staff?.doctor_tier ? DOCTOR_TIER_AUTHORITY_BLURB[staff.doctor_tier] : undefined;

  // Overview KPIs + the "Urgent escalations" panel share one fetch of every
  // open/under-review escalation — same filter as lib/queries/worklist-counts's
  // countOpenEscalations and lib/queries/escalations's fetchDoctorEscalations,
  // just run with the server client so this page stays a single request.
  const [patientCountRes, escalationsRes, medReviewsRes, carePlanReviewsRes] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "patient"),
    supabase
      .from("escalations")
      .select(
        "id, reason, status, patient:profiles!escalations_patient_id_fkey(full_name), clinician_alert:clinician_alerts!escalations_clinician_alert_id_fkey(level, sla_due_at)"
      )
      .in("status", ["open", "under_review"])
      .order("created_at", { ascending: true })
      .returns<OverviewEscalationRow[]>(),
    supabase.from("medication_reviews").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("care_plan_review_prompts")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
  ]);

  // Every one of these four is read for `.error` before its number is shown.
  // Without that check a failed query renders as "Escalations open 0 / Within
  // target", "SLA breaches 0 / None right now" and "No open escalations right
  // now" — three all-clears asserted from data nobody actually received. A
  // count this dashboard could not load is shown as unknown, never as zero,
  // and a tile with no trustworthy number carries no reassuring delta.
  const patientCountFailed = patientCountRes.error !== null;
  const escalationsFailed = escalationsRes.error !== null;
  const reviewsFailed = medReviewsRes.error !== null || carePlanReviewsRes.error !== null;
  const anythingFailed = patientCountFailed || escalationsFailed || reviewsFailed;

  const patientCount = patientCountRes.count ?? 0;
  const openEscalations = escalationsRes.data ?? [];
  const escalationCount = openEscalations.length;
  const slaBreaches = openEscalations.filter(
    (e) => e.clinician_alert?.sla_due_at && new Date(e.clinician_alert.sla_due_at) < new Date()
  ).length;
  const reviewsDue = (medReviewsRes.count ?? 0) + (carePlanReviewsRes.count ?? 0);

  // "Notes to complete" — the continuous-note worklist. Every escalation
  // this clinician resolves, async consult they answer, or video
  // consultation attributed to them guarantees a draft clinical_encounter_
  // notes row (private.auto_draft_note_from_*,
  // 20260917031004_auto_generated_continuous_clinical_note.sql), so this is
  // the one place a "nothing was ever documented" gap would surface. Only
  // fetched when the caller has a clinical_staff row (staff.id), since the
  // notes are attributed by clinical_staff.id, not profile id.
  let pendingAutoDraftedNotes: PendingAutoDraftedNoteRow[] = [];
  let pendingNotesFailed = false;
  if (staff) {
    const pendingNotesRes = await supabase
      .from("clinical_encounter_notes")
      .select(
        "id, patient_id, encounter_type, reason_for_encounter, encounter_date, patient:profiles!clinical_encounter_notes_patient_id_fkey(full_name)"
      )
      .eq("authored_by_staff", staff.id)
      .eq("auto_generated", true)
      .eq("status", "draft")
      .order("encounter_date", { ascending: true })
      .returns<PendingAutoDraftedNoteRow[]>();
    pendingNotesFailed = pendingNotesRes.error !== null;
    pendingAutoDraftedNotes = pendingNotesRes.data ?? [];
  }

  // Clinical Director governance panel (Gap E, CMO governance-surface audit
  // 2026-09-14) — additive to the shared worklist above, not a fork of it:
  // every tier still sees the same page, this section just renders when
  // doctor_tier === 'chief_medical_officer'. Only fetched for a CMO — these
  // three queries are governance-only and would be wasted reads for every
  // other tier landing on this same shared page.
  const isClinicalDirector = staff?.doctor_tier === "chief_medical_officer";
  let protocolDraftsPending = 0;
  let triageProtocolsUnsigned = 0;
  let credentialsNeedingAttention = 0;
  let governancePanelFailed = false;
  if (isClinicalDirector) {
    const [protocolDraftsRes, triageProtocolsRes, credentialMonitorRes] = await Promise.all([
      supabase.from("protocol_drafts").select("id", { count: "exact", head: true }).eq("status", "in_review"),
      supabase.from("triage_protocols").select("id", { count: "exact", head: true }).is("approved_at", null),
      supabase.rpc("provider_credential_monitor"),
    ]);
    governancePanelFailed =
      protocolDraftsRes.error !== null || triageProtocolsRes.error !== null || credentialMonitorRes.error !== null;
    protocolDraftsPending = protocolDraftsRes.count ?? 0;
    triageProtocolsUnsigned = triageProtocolsRes.count ?? 0;
    if (!governancePanelFailed) {
      const parsed = credentialMonitorSchema.safeParse(credentialMonitorRes.data);
      if (!parsed.success) {
        governancePanelFailed = true;
      } else {
        credentialsNeedingAttention = parsed.data.providers.filter(
          (p) =>
            p.license_state === "expiring_soon" ||
            p.license_state === "expired" ||
            p.indemnity_state === "expiring_soon" ||
            p.indemnity_state === "expired"
        ).length;
      }
    }
  }

  const urgentEscalations = openEscalations
    .slice()
    .sort((a, b) => {
      const pa = LEVEL_PRIORITY[a.clinician_alert?.level ?? "routine"];
      const pb = LEVEL_PRIORITY[b.clinician_alert?.level ?? "routine"];
      if (pa !== pb) return pa - pb;
      const slaA = a.clinician_alert?.sla_due_at ? new Date(a.clinician_alert.sla_due_at).getTime() : Infinity;
      const slaB = b.clinician_alert?.sla_due_at ? new Date(b.clinician_alert.sla_due_at).getTime() : Infinity;
      return slaA - slaB;
    })
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">
          {greetingWord(new Date())}
          {profile?.full_name ? `, ${profile.full_name}` : ""}
        </h1>
        <p className="text-sm text-charcoal-ink/60">Here&apos;s what needs you today.</p>
      </div>

      {/* Chief Medical Officer is the top tier, not an orthogonal flag —
          reaching it carries every capability this dashboard grants any
          other doctor, plus the protocol/config sign-off and case-assignment
          authority gated separately (see docs/CLAUDE.md's Clinical Tier
          Ladder). This badge is purely visible confirmation. */}
      {staff?.doctor_tier === "chief_medical_officer" && (
        <span className="inline-flex w-fit items-center rounded-full bg-sprout-gold/15 px-2.5 py-1 text-xs font-medium text-deep-forest">
          Clinical Director
        </span>
      )}

      {/* Additive to the shared worklist, not a separate landing page or
          account role — see CLAUDE.md's "never re-split the account role"
          rule. Links go to /clinician/* pages built alongside this panel
          (2026-09-14), not /admin/*, which a CMO's `clinician` login can
          never reach. */}
      {isClinicalDirector && (
        <Card variant="soft">
          <CardHeader>
            <CardTitle className="text-base">For the Clinical Director</CardTitle>
            <CardDescription>Governance items only you can act on, at a glance.</CardDescription>
          </CardHeader>
          <CardContent>
            {governancePanelFailed ? (
              <LoadFailure>
                Part of this panel could not be loaded. Open each governance page directly rather
                than trusting a count below.
              </LoadFailure>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <Link
                  href="/clinician/protocols"
                  className="rounded-lg border border-charcoal-ink/10 p-3 hover:bg-charcoal-ink/[0.02]"
                >
                  <p className="text-xs text-charcoal-ink/50">Protocol drafts in review</p>
                  <p className="font-heading text-xl font-semibold text-charcoal-ink">
                    {formatNumber(protocolDraftsPending)}
                  </p>
                </Link>
                <Link
                  href="/clinician/triage-protocols"
                  className="rounded-lg border border-charcoal-ink/10 p-3 hover:bg-charcoal-ink/[0.02]"
                >
                  <p className="text-xs text-charcoal-ink/50">Triage protocol versions unsigned</p>
                  <p className="font-heading text-xl font-semibold text-charcoal-ink">
                    {formatNumber(triageProtocolsUnsigned)}
                  </p>
                </Link>
                <Link
                  href="/clinician/provider-quality"
                  className="rounded-lg border border-charcoal-ink/10 p-3 hover:bg-charcoal-ink/[0.02]"
                >
                  <p className="text-xs text-charcoal-ink/50">Provider credentials needing attention</p>
                  <p className="font-heading text-xl font-semibold text-charcoal-ink">
                    {formatNumber(credentialsNeedingAttention)}
                  </p>
                </Link>
              </div>
            )}
            <Link
              href="/clinician/team-caseload"
              className="mt-3 inline-block text-sm font-medium text-brand-green hover:underline"
            >
              View the whole team&apos;s caseload →
            </Link>
          </CardContent>
        </Card>
      )}

      {!staff && <ClinicalStaffSetupWarning roleLabel={roleLabel} />}
      {authorityBlurb && (
        <Card variant="soft">
          <CardContent className="py-3 text-sm text-charcoal-ink/70">{authorityBlurb}</CardContent>
        </Card>
      )}
      {staff && <RedFlagAttestation />}
      {attestationStaff && <AttestationCard expiresAt={attestationExpiresAt} />}
      {attestationStaff && <HtnAttestationCard expiresAt={htnAttestationExpiresAt} />}

      {anythingFailed && (
        <LoadFailure>
          Part of this overview could not be loaded, so any figure below marked &ldquo;could not be
          loaded&rdquo; is unknown, not zero. Reload the page, and work from the worklist pages
          themselves until it comes back.
        </LoadFailure>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {patientCountFailed ? (
          <StatTile
            icon={SEMANTIC_ICON.parentCare}
            label="Active patients"
            empty={{ hint: "Could not be loaded" }}
          />
        ) : (
          <StatTile
            icon={SEMANTIC_ICON.parentCare}
            label="Active patients"
            value={formatNumber(patientCount)}
          />
        )}
        {escalationsFailed ? (
          <StatTile
            icon={SEMANTIC_ICON.escalation}
            label="Escalations open"
            empty={{ hint: "Could not be loaded" }}
          />
        ) : (
          <StatTile
            icon={SEMANTIC_ICON.escalation}
            label="Escalations open"
            value={String(escalationCount)}
            delta={{
              text: escalationCount > 0 ? "Awaiting review" : "Within target",
              direction: escalationCount > 0 ? "down" : "up",
            }}
          />
        )}
        {reviewsFailed ? (
          <StatTile
            icon={SEMANTIC_ICON.carePlan}
            label="Reviews due"
            empty={{ hint: "Could not be loaded" }}
          />
        ) : (
          <StatTile
            icon={SEMANTIC_ICON.carePlan}
            label="Reviews due"
            value={String(reviewsDue)}
            delta={{ text: "Across care plans & meds", direction: "flat" }}
          />
        )}
        {/* SLA breaches are derived from the same escalation fetch, so a
            failure there makes this figure unknown too — "None right now" off
            a failed read is the most dangerous sentence on this page. */}
        {escalationsFailed ? (
          <StatTile
            icon={SEMANTIC_ICON.escalation}
            label="SLA breaches"
            empty={{ hint: "Could not be loaded" }}
          />
        ) : (
          <StatTile
            icon={SEMANTIC_ICON.escalation}
            tintClassName={slaBreaches > 0 ? "bg-red-100" : undefined}
            iconClassName={slaBreaches > 0 ? "text-red-700" : undefined}
            label="SLA breaches"
            value={String(slaBreaches)}
            delta={{
              text: slaBreaches > 0 ? "Needs immediate attention" : "None right now",
              direction: slaBreaches > 0 ? "down" : "up",
            }}
          />
        )}
      </div>

      {/* Full width, not a half-page card beside a "Today's queue" panel —
          that panel used to repeat four counts (async consults, outreach,
          care plan reviews, medication reviews) the sidebar now shows as
          live badges on every page, so keeping it here just for the
          landing view was pure duplication on the one screen where both
          were visible at once. */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Urgent escalations</CardTitle>
            <Link
              href="/clinician/escalations"
              className="shrink-0 text-sm font-medium text-brand-green hover:underline"
            >
              View all →
            </Link>
          </div>
          <CardDescription>Ranked by severity, then how close each is to its SLA.</CardDescription>
        </CardHeader>
        <CardContent>
          {escalationsFailed ? (
            <LoadFailure>
              Open escalations could not be loaded. Do not read this as an empty list: open the
              escalations worklist directly to check what is waiting.
            </LoadFailure>
          ) : urgentEscalations.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No open escalations right now.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {urgentEscalations.map((escalation) => {
                const level = escalation.clinician_alert?.level;
                const levelBadge = level ? LEVEL_BADGE[level] : null;
                const statusBadge = ESCALATION_STATUS_BADGE[escalation.status];
                return (
                  <li key={escalation.id}>
                    <Link
                      href={`/clinician/escalations/${escalation.id}`}
                      className="flex items-center justify-between gap-3 py-2.5 hover:bg-charcoal-ink/[0.02]"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft-sage font-heading text-xs font-semibold text-deep-forest">
                          {initials(escalation.patient?.full_name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-charcoal-ink">
                            {escalation.patient?.full_name ?? "Unknown patient"}
                          </span>
                          <span className="block truncate text-xs text-charcoal-ink/55">
                            {escalation.reason}
                          </span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {levelBadge && <Badge variant={levelBadge.variant}>{levelBadge.label}</Badge>}
                        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Continuous-note worklist — see the comment above pendingAutoDraftedNotes.
          Only rendered for a caller with a clinical_staff row; a note is
          always drafted the moment the underlying interaction concludes, so
          this list is the honest measure of what's left undocumented, not
          an aspirational reminder. */}
      {staff && (
        <Card>
          <CardHeader>
            <CardTitle>Notes to complete</CardTitle>
            <CardDescription>
              Drafted automatically when you resolved these — review and sign each one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingNotesFailed ? (
              <LoadFailure>
                This list could not be loaded. Do not read this as &ldquo;nothing pending&rdquo; —
                open a recently-resolved case&apos;s patient page directly to check for its note.
              </LoadFailure>
            ) : pendingAutoDraftedNotes.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">Nothing waiting on you right now.</p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10">
                {pendingAutoDraftedNotes.map((note) => (
                  <li key={note.id}>
                    <Link
                      href={`/clinician/patients/${note.patient_id}`}
                      className="flex items-center justify-between gap-3 py-2.5 hover:bg-charcoal-ink/[0.02]"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft-sage font-heading text-xs font-semibold text-deep-forest">
                          {initials(note.patient?.full_name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-charcoal-ink">
                            {note.patient?.full_name ?? "Unknown patient"}
                          </span>
                          <span className="block truncate text-xs text-charcoal-ink/55">
                            {ENCOUNTER_TYPE_LABEL[note.encounter_type] ?? note.encounter_type} ·{" "}
                            {note.reason_for_encounter}
                          </span>
                        </span>
                      </span>
                      <Badge variant="blue">Auto-drafted</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Worklist />
    </div>
  );
}
