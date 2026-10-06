import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import { Card, CardContent } from "@/components/ui/card";
import { readClinicalSignoffChecklist } from "@/lib/clinical/read-clinical-signoff-checklist";
import { CLINICAL_RULES_ITEM_KEY, readCmoSigningHub } from "@/lib/queries/cmo-signing-hub";
import { SignoffChecklist } from "@/app/(dashboard)/admin/settings/clinical-signoff/signoff-checklist";
import { SignoffQueueList } from "@/app/(dashboard)/admin/settings/clinical-protocols/signoff-queue-list";
import {
  ContentLibraryManager,
  type ContentBlockRow,
} from "@/app/(dashboard)/admin/settings/lpe-content-library/content-library-manager";
import {
  ResultReleasePoliciesManager,
  type ResultReleasePolicyVersionRow,
} from "@/app/(dashboard)/admin/settings/result-release-policies/result-release-policies-manager";

export const metadata = { title: "Sign-off hub" };

/**
 * The Chief Medical Officer's one place for everything that needs their
 * signature: what it is, how urgent, and the control to sign it.
 *
 * Replaces a page that only covered clinical rules and eight governed
 * configs. AI governance, protocol drafts, coaching content and result release
 * policies each lived on their own page (or, for two of them, on no page a CMO
 * could open), so "what needs me?" meant visiting each. The list below is built
 * by readCmoSigningHub; the same list drives the banner every page shows the
 * CMO, so the two cannot disagree.
 *
 * Where a signature can honestly be given from here it is: clinical rules
 * (guided form), coaching content and the result release policy open inline.
 * The rest link to one page each, because a signature on configuration whose
 * actual values you have not looked at means nothing, and the item's own page
 * is where those values are shown.
 *
 * `admin/settings/clinical-signoff` and the other admin pages redirect anyone
 * whose `profiles.role !== "admin"`, and a real CMO account is always
 * `clinician` (CLAUDE.md, "never re-split the account role"), so every link
 * here stays under /clinician.
 */
export default async function ClinicianClinicalSignoffPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  const supabase = await createClient();
  const [checklist, hub] = await Promise.all([
    readClinicalSignoffChecklist(supabase, "/clinician"),
    readCmoSigningHub(supabase),
  ]);

  // A failed checklist read costs only the guided rule forms and the signed history, not the whole
  // hub: every other line comes from readCmoSigningHub and its links do not depend on it.
  const checklistFailed = checklist.loadFailed;

  // Only fetch what an inline panel needs, and only when its line is on the list.
  const keys = new Set(hub.items.map((i) => i.key));
  const [blocksRes, releaseRes] = await Promise.all([
    keys.has("lpe_content_blocks")
      ? supabase
          .from("lpe_content_blocks")
          .select("id, key, title, body_md, condition, module, reading_level, clinician_reviewed, reviewed_at")
          .order("condition", { ascending: true, nullsFirst: false })
          .order("title", { ascending: true })
      : null,
    keys.has("result_release_policies")
      ? supabase
          .from("result_release_policies")
          .select("id, version, config, notes, is_active, approved_at, created_at")
          .order("version", { ascending: false })
      : null,
  ]);

  // A failed fetch leaves the panel out, so the line falls back to a plain link
  // to the item's own page. That is a safe degradation, never a missing line.
  const inlinePanels: Partial<Record<string, ReactNode>> = {};

  if (!checklistFailed && keys.has(CLINICAL_RULES_ITEM_KEY) && checklist.unsignedRules.length > 0) {
    inlinePanels[CLINICAL_RULES_ITEM_KEY] = (
      <SignoffChecklist
        unsignedRules={checklist.unsignedRules}
        signedRules={[]}
        unsignedConfigs={[]}
        settled={[]}
        staff={checklist.staff}
        protocols={checklist.protocols}
        totalConfigCount={checklist.totalConfigCount}
        basePath="/clinician"
        mode="pending-rules"
      />
    );
  }

  if (blocksRes && !blocksRes.error && blocksRes.data && blocksRes.data.length > 0) {
    inlinePanels.lpe_content_blocks = <ContentLibraryManager blocks={blocksRes.data as ContentBlockRow[]} />;
  }

  if (releaseRes && !releaseRes.error && releaseRes.data) {
    const versions = releaseRes.data as ResultReleasePolicyVersionRow[];
    inlinePanels.result_release_policies = (
      <ResultReleasePoliciesManager
        versions={versions}
        activeVersion={versions.find((v) => v.is_active) ?? null}
        nextVersion={(versions[0]?.version ?? 0) + 1}
        canCreateDraft={false}
      />
    );
  }

  const hasSigned = !checklistFailed && (checklist.signedRules.length > 0 || checklist.settled.length > 0);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-charcoal-ink">Sign-off hub</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          Everything on the platform that needs your signature, in one list, most urgent first. Open a
          line to see what it is and sign it, or follow it to its own page when you need to review the
          actual values first. Nothing is signed until you press the sign button.
        </p>
      </div>

      {/* Never an all-clear when a read failed: say so, and keep whatever did load. */}
      {hub.failed && (
        <LoadFailure>
          Some sign-off counts could not be loaded, so the list below may be short. This is not an
          all-clear. Reload, and check the individual pages if it persists.
        </LoadFailure>
      )}

      {checklistFailed && (
        <LoadFailure>
          The clinical rules could not be loaded here, so rules cannot be signed from this page right now.
          This is not an all-clear. Reload, or open Clinical rules directly.
        </LoadFailure>
      )}

      {hub.items.length === 0 && (hub.failed || checklistFailed) ? null : hub.items.length === 0 ? (
        <Card className="border-brand-green/30 bg-brand-green/5">
          <CardContent className="pt-6 text-sm text-charcoal-ink/70">
            Nothing is waiting on your signature. Every clinical rule, governed configuration, protocol,
            AI system version, coaching content block and result release policy carries a signature.
          </CardContent>
        </Card>
      ) : (
        <SignoffQueueList items={hub.items} inlinePanels={inlinePanels} />
      )}

      {hasSigned && (
        <details className="rounded-md border border-mist-grey/40 p-4">
          <summary className="cursor-pointer text-sm font-medium text-charcoal-ink">
            Already signed ({checklist.signedRules.length} clinical rules, {checklist.settled.length} of{" "}
            {checklist.totalConfigCount} configurations)
          </summary>
          <div className="mt-4">
            <SignoffChecklist
              unsignedRules={[]}
              signedRules={checklist.signedRules}
              unsignedConfigs={[]}
              settled={checklist.settled}
              staff={checklist.staff}
              protocols={checklist.protocols}
              totalConfigCount={checklist.totalConfigCount}
              basePath="/clinician"
              mode="signed"
            />
          </div>
        </details>
      )}
    </div>
  );
}
