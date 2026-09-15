import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { getVisibleItemsForTab } from "@/lib/admin-settings-nav";
import { SettingsHubGrid } from "@/components/shell/settings-hub-grid";
import { createClient } from "@/lib/supabase/server";
import { getSignoffQueue } from "@/lib/queries/signoff-queue";
import { SignoffQueueList } from "./signoff-queue-list";
import { LoadFailure } from "@/components/ui/load-failure";
import { ContentLibraryManager, type ContentBlockRow } from "../lpe-content-library/content-library-manager";
import {
  ClinicalRulesManager,
  type ClinicalRuleVersionRow,
  type ClinicalStaffOption,
  type SignedProtocolOption,
} from "../clinical-rules/clinical-rules-manager";

export default async function ClinicalProtocolsSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // Belt-and-braces alongside the tile-visibility gate below: the two
  // managers embedded on this hub (content review, rule governance) are
  // otherwise hard-gated `role !== "admin"` on their own pages — this page
  // must never be a softer door to the same data.
  if (profile.role !== "admin") redirect("/admin");

  const perms = await getCallerPermissions();
  const items = getVisibleItemsForTab("clinical-protocols", perms);
  if (items.length === 0) redirect("/admin/settings");

  const supabase = await createClient();
  let queue: Awaited<ReturnType<typeof getSignoffQueue>> | null = null;
  let queueFailed = false;
  try {
    queue = await getSignoffQueue(supabase);
  } catch {
    queueFailed = true;
  }

  // Fetched here too, not just on /admin/settings/lpe-content-library and
  // /admin/settings/clinical-rules, so the two most-often-outstanding queue
  // items can be reviewed and signed right on this landing page — no second
  // navigation just to find the thing the queue already named. Only the data
  // fetch lives in this try/catch; building JSX from it happens below,
  // outside the catch, since a component thrown during render isn't caught
  // here anyway (eslint: react-hooks/error-boundaries).
  let contentBlocks: ContentBlockRow[] = [];
  let clinicalRules: ClinicalRuleVersionRow[] = [];
  let clinicalStaff: ClinicalStaffOption[] = [];
  let signedProtocols: SignedProtocolOption[] = [];
  try {
    const [blocksRes, rulesRes, staffRes, protocolsRes] = await Promise.all([
      supabase
        .from("lpe_content_blocks")
        .select("id, key, title, body_md, condition, module, reading_level, clinician_reviewed, reviewed_at")
        .order("condition", { ascending: true, nullsFirst: false })
        .order("title", { ascending: true }),
      supabase
        .from("clinical_rules")
        .select(
          `id, rule_key, version, name, description, category, domain, event_type,
           population, conditions, actions, priority, specificity, escalation,
           suppression, explanation_template, status, effective_from, effective_to,
           owner_clinical_staff_id, protocol_version_id, organisation_id, patient_id,
           approved_by, approved_at, activated_at, retired_at, retired_reason,
           rolled_back_at, rollback_reason, notes, created_at`
        )
        .order("rule_key", { ascending: true })
        .order("version", { ascending: false }),
      supabase.from("clinical_staff").select("id, full_name, doctor_tier").eq("active", true).order("full_name", { ascending: true }),
      supabase
        .from("protocol_versions")
        .select("id, protocol_id, title, version_number")
        .not("approved_by", "is", null)
        .order("protocol_id", { ascending: true })
        .order("version_number", { ascending: false }),
    ]);

    if (!blocksRes.error && !rulesRes.error && !staffRes.error && !protocolsRes.error) {
      contentBlocks = (blocksRes.data as ContentBlockRow[] | null) ?? [];
      clinicalRules = (rulesRes.data as ClinicalRuleVersionRow[] | null) ?? [];
      clinicalStaff = (staffRes.data as ClinicalStaffOption[] | null) ?? [];
      signedProtocols = (protocolsRes.data as SignedProtocolOption[] | null) ?? [];
    }
    // A failed fetch here just leaves every list empty, which makes the
    // inlinePanels build below produce nothing — SignoffQueueList then falls
    // back to its plain link for that item, a safe degradation since the
    // linked-to page does its own fetch anyway.
  } catch {
    // same fallback as above
  }

  const inlinePanels: Partial<Record<string, ReactNode>> = {};
  if (contentBlocks.length > 0) {
    inlinePanels.lpe_content_blocks = <ContentLibraryManager blocks={contentBlocks} />;
  }
  if (clinicalRules.length > 0) {
    const rulesPanel = (
      <ClinicalRulesManager rules={clinicalRules} clinicalStaff={clinicalStaff} signedProtocols={signedProtocols} />
    );
    // Both queue-item severities for this table ("needs setup" and "ready
    // to sign") link to the same underlying rule list — whichever one is
    // showing, expanding it opens the same manager.
    inlinePanels.clinical_rules_needs_setup = rulesPanel;
    inlinePanels.clinical_rules_ready = rulesPanel;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Clinical Protocols</h2>
        <p className="text-charcoal-ink/60">
          The signed clinical configuration behind escalations, risk scoring, and every
          doctor-reviewed claim.
        </p>
      </div>
      {/* A failed read here must never render as an empty queue — that would
          say "nothing to sign" about state nobody actually checked, the same
          failure mode LoadFailure exists to prevent elsewhere on this page's
          own tiles (triage-protocols, clinical-rules). */}
      {queueFailed || !queue ? (
        <LoadFailure>
          The sign-off queue could not be loaded. This is not a report that nothing needs signing —
          check each tile below directly until this loads.
        </LoadFailure>
      ) : (
        <SignoffQueueList items={queue} inlinePanels={inlinePanels} />
      )}
      <SettingsHubGrid items={items} />
    </div>
  );
}
