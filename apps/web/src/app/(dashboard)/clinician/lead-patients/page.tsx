import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { leadPatientsSchema } from "@/lib/clinician/queue-console";

export const metadata = { title: "My lead patients" };
export const dynamic = "force-dynamic";

/** Patients I lead (spec 9.1). Each row is an audited read; the list only ever contains my own active leads. */
export default async function LeadPatientsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = loose(await createClient());
  const res = await supabase.rpc("my_lead_patients");
  const parsed = res.error ? null : leadPatientsSchema.safeParse(res.data);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{t("lead.title", "en")}</h1>
        <p className="text-sm text-charcoal-ink/60">{t("lead.subtitle", "en")}</p>
      </div>
      {!parsed?.success && <p role="alert" className="text-sm text-red-600">{t("lead.load_error", "en")}</p>}
      {parsed?.success && parsed.data.length === 0 && <p className="text-sm text-charcoal-ink/60">{t("lead.empty", "en")}</p>}
      {parsed?.success && parsed.data.length > 0 && (
        <ul className="space-y-3">
          {parsed.data.map((p) => (
            <li key={p.patient_id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-4 pt-4 text-sm">
                  <span className="font-medium text-charcoal-ink">{p.first_name ?? "-"}</span>
                  <span>{t("lead.last_bp", "en")}: {p.last_bp ? `${p.last_bp.systolic}/${p.last_bp.diastolic}` : "-"}</span>
                  <span>{t("lead.adherence", "en")}: {p.adherence_percent === null ? "-" : `${p.adherence_percent}%`}</span>
                  {p.pending_proposals > 0 && <Badge variant="blue">{t("lead.proposals", "en")}: {p.pending_proposals}</Badge>}
                  {p.due_tasks > 0 && <Badge variant="amber">{t("lead.due", "en")}: {p.due_tasks}</Badge>}
                  <Link href={`/clinician/lead-patients/${p.patient_id}`} className="ml-auto font-medium text-brand-green underline">
                    {t("lead.open_summary", "en")}
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
