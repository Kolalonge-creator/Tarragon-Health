import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { followUpListSchema, type FollowUpRow } from "@/lib/clinician/follow-ups";
import { AcknowledgeForm, CloseForm } from "./forms";

export const metadata = { title: "My follow-ups" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

function Row({ f }: { f: FollowUpRow }) {
  return (
    <li>
      <Card>
        <CardContent className="space-y-3 pt-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-charcoal-ink">{f.patient_first_name || "-"}</span>
            <span>{t(`followups.kind.${f.kind}`, "en")}</span>
            <span>
              {t("followups.due", "en")}: {fmt(f.due_at)}
            </span>
            {f.abnormal_result && <Badge variant="amber">{t("followups.abnormal", "en")}</Badge>}
            {f.overdue && <Badge variant="red">{t("followups.overdue", "en")}</Badge>}
            {f.escalated_at && <Badge variant="blue">{t("followups.escalated", "en")}</Badge>}
            {f.state === "acknowledged" && <Badge variant="green">{t("followups.acknowledged", "en")}</Badge>}
          </div>
          {f.state === "closed" ? (
            <p className="text-charcoal-ink/70">
              {f.outcome ? t(`followups.outcome.${f.outcome}`, "en") : ""}: {f.outcome_reason}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {f.state === "open" && <AcknowledgeForm id={f.id} />}
              <CloseForm id={f.id} />
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

/** Orders, referrals, lab requests and follow-up tasks I own or am tied to (spec 23.8). Each one closes only with an outcome and a reason. */
export default async function FollowUpsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const res = await loose(await createClient()).rpc("list_clinical_follow_ups", { p_include_closed: false });
  const parsed = res.error ? null : followUpListSchema.safeParse(res.data);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{t("followups.title", "en")}</h1>
        <p className="text-sm text-charcoal-ink/60">{t("followups.subtitle", "en")}</p>
      </div>
      {!parsed?.success && (
        <p role="alert" className="text-sm text-red-600">
          {t("followups.load_error", "en")}
        </p>
      )}
      {parsed?.success && parsed.data.length === 0 && <p className="text-sm text-charcoal-ink/60">{t("followups.empty", "en")}</p>}
      {parsed?.success && parsed.data.length > 0 && (
        <ul className="space-y-3">
          {parsed.data.map((f) => (
            <Row key={f.id} f={f} />
          ))}
        </ul>
      )}
    </div>
  );
}
