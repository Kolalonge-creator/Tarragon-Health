import { redirect } from "next/navigation";
import { z } from "zod";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { t, type MessageKey } from "@tarragon/i18n";
import { joinProgrammeAction, leaveProgrammeAction, setSharingAction } from "./actions";

export const metadata = { title: "Programmes" };
export const dynamic = "force-dynamic";

const cohorts = z.array(z.object({ cohort_id: z.string().uuid(), name: z.string(), sponsor: z.string(), joined_at: z.string(), reporting_consent: z.boolean(), consent_available: z.boolean() }));
const MESSAGES: Record<string, MessageKey> = {
  joined: "programme.joined", already: "programme.already", code_invalid: "programme.code_invalid", saved: "programme.saved",
  unavailable: "programme.share_unavailable", error: "programme.error",
};

/**
 * Join a programme with a code, see the programmes you are in, and choose whether to share group figures with each one (S38e). Joining
 * shares nothing. Sharing is off until the person turns it on, can be turned off at any time, and ends when they leave. A person's own
 * account only: a supporter acting for someone does not join programmes on their behalf.
 */
export default async function ProgrammesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { acting, uiLanguage } = await getPatientDashboardContext();
  if (acting) redirect("/patient");
  const sp = await searchParams;
  const key = typeof sp.m === "string" ? MESSAGES[sp.m] : undefined;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_cohorts");
  const parsed = cohorts.safeParse(data);
  const list = error || !parsed.success ? null : parsed.data;

  return (
    <div className="space-y-6">
      <PageHeader backTo={{ href: "/patient", label: "Dashboard" }} title={t("programme.title", uiLanguage)} description={t("programme.subtitle", uiLanguage)} />
      {key ? <p role="status">{t(key, uiLanguage)}</p> : null}
      <form action={joinProgrammeAction} className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm">{t("programme.code_label", uiLanguage)}</span>
          <input name="code" required minLength={4} maxLength={20} autoComplete="off" autoCapitalize="characters" className="min-h-11 rounded border px-2 uppercase" />
        </label>
        <button type="submit" className="min-h-11 rounded border px-4">{t("programme.join", uiLanguage)}</button>
      </form>
      {list === null ? (
        <p role="alert">{t("programme.error", uiLanguage)}</p>
      ) : list.length === 0 ? (
        <p>{t("programme.none", uiLanguage)}</p>
      ) : (
        list.map((c) => (
          <Card key={c.cohort_id}>
            <CardHeader>
              <CardTitle>{c.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">{t("programme.from", uiLanguage, { sponsor: c.sponsor })}</p>
              <section aria-labelledby={`share-${c.cohort_id}`} className="space-y-2">
                <h2 id={`share-${c.cohort_id}`} className="font-medium">{t("programme.share_title", uiLanguage)}</h2>
                <p className="text-sm">{t("programme.share_body", uiLanguage, { sponsor: c.sponsor })}</p>
                <p>{t(c.reporting_consent ? "programme.share_on" : "programme.share_off", uiLanguage)}</p>
                {c.reporting_consent || c.consent_available ? (
                  <form action={setSharingAction}>
                    <input type="hidden" name="cohortId" value={c.cohort_id} />
                    <input type="hidden" name="on" value={c.reporting_consent ? "0" : "1"} />
                    <button type="submit" className="min-h-11 rounded border px-4">
                      {t(c.reporting_consent ? "programme.share_turn_off" : "programme.share_turn_on", uiLanguage)}
                    </button>
                  </form>
                ) : (
                  <p className="text-sm">{t("programme.share_unavailable", uiLanguage)}</p>
                )}
              </section>
              <form action={leaveProgrammeAction} className="space-y-1">
                <input type="hidden" name="cohortId" value={c.cohort_id} />
                <button type="submit" className="min-h-11 rounded border px-4">{t("programme.leave", uiLanguage)}</button>
                <p className="text-sm">{t("programme.leave_note", uiLanguage)}</p>
              </form>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
