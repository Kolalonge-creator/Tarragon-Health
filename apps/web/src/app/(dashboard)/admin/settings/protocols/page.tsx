import { redirect } from "next/navigation";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { ProtocolVersionsManager } from "./protocol-versions-manager";
import { ProtocolDraftsManager } from "./protocol-drafts-manager";

export default async function ProtocolsSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts blocks a plain `clinician` login from reaching any /admin/**
  // route at all (deliberately — see proxy.ts's own comment, out of scope to
  // relax), so a Chief Medical Officer can never actually land here; this
  // page's own /clinician/protocols mirror is their real, reachable path
  // (found + built 2026-09-14, CMO governance-surface audit). The dual-gate
  // below is belt-and-suspenders defence-in-depth for the admin route only,
  // not a claim that a CMO reaches this specific URL.
  const staff = await getCurrentClinicalStaff();
  if (profile?.role !== "admin" && !canAssignCases(staff)) {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clinical protocols"
        description={`The version-signed record behind every "protocols supervised by Dr. X" claim shown to patients: docs/CLINICAL_TRUST_MODEL_SPEC.md §1/§4. Append-only: signing a new version is how a protocol changes, nothing here is ever edited after the fact. Only the org's active Clinical Director can sign.`}
      />
      <ProtocolDraftsManager />
      <ProtocolVersionsManager />
    </div>
  );
}
