import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LEVEL_BADGE, ESCALATION_STATUS_BADGE } from "@/lib/worklist/level-badge";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { ReviewedByDoctor } from "@/components/reviewed-by-doctor";
import { StartVirtualReviewButton } from "./start-virtual-review-button";
import { NotesPanel } from "./notes-panel";
import { ResolveForm } from "./resolve-form";

export default async function DoctorEscalationPage({
  params,
}: {
  params: Promise<{ escalationId: string }>;
}) {
  const { escalationId } = await params;
  const supabase = await createClient();

  // RLS (private.is_org_staff) is the real gate here: an escalation outside
  // the caller's org simply doesn't come back, same as any other cross-tenant
  // lookup in this app.
  const { data: escalation } = await supabase
    .from("escalations")
    .select(
      "*, patient:profiles!escalations_patient_id_fkey(id, full_name, phone), clinician_alert:clinician_alerts!escalations_clinician_alert_id_fkey(title, detail, level, sla_due_at)"
    )
    .eq("id", escalationId)
    .maybeSingle();

  if (!escalation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Escalation not found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">
            This escalation doesn&apos;t exist or isn&apos;t in your organisation.
          </p>
        </CardContent>
      </Card>
    );
  }

  const levelBadge = escalation.clinician_alert
    ? LEVEL_BADGE[escalation.clinician_alert.level]
    : null;
  const statusBadge = ESCALATION_STATUS_BADGE[escalation.status];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          {escalation.patient?.full_name ?? "Unnamed patient"}
        </h1>
        {escalation.patient?.phone && (
          <p className="text-charcoal-ink/60">{escalation.patient.phone}</p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Escalation detail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            {levelBadge && <Badge variant={levelBadge.variant}>{levelBadge.label}</Badge>}
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          </div>
          {escalation.clinician_alert && (
            <p className="text-sm text-charcoal-ink">
              {escalation.clinician_alert.title}
              {escalation.clinician_alert.detail && ` — ${escalation.clinician_alert.detail}`}
            </p>
          )}
          <p className="text-sm text-charcoal-ink">Reason: {escalation.reason}</p>
          <StartVirtualReviewButton escalationId={escalation.id} />
        </CardContent>
      </Card>

      <ReviewedByDoctor escalationId={escalation.id} />

      {escalation.patient?.id && <VitalsTrendChart patientId={escalation.patient.id} />}

      <NotesPanel escalationId={escalation.id} organisationId={escalation.organisation_id} />

      <ResolveForm escalationId={escalation.id} />
    </div>
  );
}
