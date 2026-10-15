import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildPrecallView, callLengthLimits, precallSchema, remainingExtension, uuidSchema } from "@/lib/followups/followups";
import { ExtendCallForm } from "./extend-form";

export const metadata = { title: "Before the call" };
export const dynamic = "force-dynamic";

/**
 * The pre-call summary (two-tier item 4): what changed since the last call, shown to the doctor before every follow-up. It is ONE call
 * to public.precall_summary, which wraps the audited clinician_patient_summary (INV-10) and is open only to the doctor the consultation
 * is assigned to (INV-12); anyone else gets the same 404 as an unknown id. No other read of the patient happens on this page.
 */
export default async function PrecallPage({ params }: { params: Promise<{ encounterId: string }> }) {
  const { encounterId } = await params;
  if (!uuidSchema.safeParse(encounterId).success) notFound();
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = loose(await createClient());
  const res = await supabase.rpc("precall_summary", { p_encounter: encounterId });
  if (res.error?.code === "42501") notFound();
  const parsed = res.error ? null : precallSchema.safeParse(res.data);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link href="/clinician/consultations" className="text-sm font-medium text-brand-green hover:underline">
          ← {t("precall.back", "en")}
        </Link>
        <Link href={`/clinician/consultation/${encounterId}`} className="text-sm font-medium text-brand-green hover:underline">
          Consultation room →
        </Link>
      </div>
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{t("precall.title", "en")}</h1>
        <p className="text-sm text-charcoal-ink/60">{t("precall.subtitle", "en")}</p>
      </div>

      {!parsed?.success && <p role="alert" className="text-sm text-red-600">{t("precall.load_error", "en")}</p>}
      {parsed?.success && parsed.data.status === "denied" && <p role="alert" className="text-sm text-red-600">{t("precall.denied", "en")}</p>}
      {parsed?.success && parsed.data.status !== "denied" && <Body encounterId={encounterId} data={parsed.data} />}
    </div>
  );
}

function Body({ encounterId, data }: { encounterId: string; data: ReturnType<typeof precallSchema.parse> }) {
  const view = buildPrecallView(data);
  const { maxExtension } = callLengthLimits();
  const room = remainingExtension(maxExtension, view.extended);
  const steps = [5, 10, 15].filter((m) => m <= room && m <= maxExtension);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {view.planned !== null && <Badge variant="blue">{t("precall.length", "en", { minutes: view.planned })}</Badge>}
        {view.extended > 0 && <Badge variant="grey">{t("precall.extended", "en", { minutes: view.extended })}</Badge>}
        {view.longerRequested && <Badge variant="amber">{t("precall.longer_requested", "en")}</Badge>}
        <span className="text-charcoal-ink/60">
          {view.sinceLabel.kind === "since" ? t("precall.since", "en", { when: view.sinceLabel.when }) : t("precall.since_none", "en")}
        </span>
      </div>

      <Section title={t("precall.vitals", "en")}>
        {view.vitals.length === 0 && <p className="text-sm text-charcoal-ink/60">{t("precall.vitals_none", "en")}</p>}
        {view.vitals.map((v) => (
          <p key={v.type} className="text-sm">
            {t("precall.vitals_row", "en", { type: v.type, count: v.count, first: v.first, last: v.last, avg: v.average })}
          </p>
        ))}
      </Section>

      <Section title={t("precall.results", "en")}>
        {view.results.length === 0 && <p className="text-sm text-charcoal-ink/60">{t("precall.results_none", "en")}</p>}
        {view.results.map((r, i) => (
          <p key={`${r.when}-${i}`} className="text-sm">
            {t("precall.results_row", "en", { panel: r.panel, when: r.when, state: r.state })}
          </p>
        ))}
      </Section>

      <Section title={t("precall.medicines", "en")}>
        {view.medicines.active.length === 0 && <p className="text-sm text-charcoal-ink/60">{t("precall.medicines_none", "en")}</p>}
        {view.medicines.active.map((m) => (
          <p key={m.name} className="text-sm">
            {m.name} {m.dose}
          </p>
        ))}
        {view.medicines.adherencePercent !== null && (
          <p className="text-sm">{t("precall.adherence", "en", { percent: `${view.medicines.adherencePercent}%` })}</p>
        )}
        {view.medicines.started.map((m) => (
          <p key={`s-${m.name}`} className="text-sm">
            {t("precall.started", "en", { name: m.name, dose: m.dose })}
          </p>
        ))}
        {view.medicines.changes > 0 && <p className="text-sm">{t("precall.changes", "en", { count: view.medicines.changes })}</p>}
        {view.proposals > 0 && <p className="text-sm">{t("precall.proposals", "en", { count: view.proposals })}</p>}
      </Section>

      <Section title={t("precall.tasks", "en")}>
        {view.tasks.length === 0 && <p className="text-sm text-charcoal-ink/60">{t("precall.tasks_none", "en")}</p>}
        {view.tasks.map((k, i) => (
          <p key={`${k.type}-${i}`} className="text-sm">
            {t("precall.task_row", "en", { type: k.type, when: k.when })}
          </p>
        ))}
      </Section>

      {(view.conditions.length > 0 || view.allergies.length > 0) && (
        <Section title={t("precall.conditions", "en")}>
          {view.conditions.length > 0 && <p className="text-sm">{view.conditions.join(", ")}</p>}
          {view.allergies.length > 0 && (
            <p className="text-sm">
              {t("precall.allergies", "en")}: {view.allergies.join(", ")}
            </p>
          )}
        </Section>
      )}

      {steps.length > 0 && <ExtendCallForm encounterId={encounterId} steps={steps} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">{children}</CardContent>
    </Card>
  );
}
