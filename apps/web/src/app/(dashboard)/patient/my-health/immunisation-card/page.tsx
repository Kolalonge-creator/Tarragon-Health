import type { Metadata } from "next";
import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { buildImmunisationCard, type DoseTrust } from "@/lib/my-health/immunisation-card";
import { t, type MessageKey } from "@tarragon/i18n";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Immunisation card", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

const TRUST_KEY: Record<DoseTrust, MessageKey> = {
  verified: "my_health.immunisation.trust.verified",
  waiting: "my_health.immunisation.trust.waiting",
  self_reported: "my_health.immunisation.trust.self_reported",
  rejected: "my_health.immunisation.trust.self_reported",
};

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/**
 * The immunisation card, read-only (S09y). It is the vaccination module's own data (logged doses, verified certificates, next doses due) laid out as
 * something a person can show or print. Adding, attaching a certificate or booking a dose stays where it is, on the prevention page. A failed read
 * says so; it is never drawn as an empty card, which would read as "no vaccinations".
 */
export default async function ImmunisationCardPage() {
  const { subjectId, profile, acting } = await getPatientDashboardContext();
  const supabase = await createClient();

  const [records, schedules] = await Promise.all([
    supabase
      .from("vaccination_records")
      .select("id, dose_number, date_administered, provider, verification_status, tarragon_certificate_serial, vaccination_catalog(name)")
      .eq("profile_id", subjectId)
      .order("date_administered", { ascending: true }),
    supabase
      .from("vaccination_schedules")
      .select("due_date, vaccination_catalog(name)")
      .eq("patient_id", subjectId)
      .in("status", ["pending", "booked"])
      .is("non_administration_reason", null)
      .order("due_date", { ascending: true }),
  ]);

  const failed = records.error !== null || schedules.error !== null;
  const card = failed
    ? null
    : buildImmunisationCard(
        (records.data ?? []).map((r) => ({
          id: r.id,
          vaccine: r.vaccination_catalog?.name ?? "Vaccine",
          doseNumber: r.dose_number,
          dateAdministered: r.date_administered,
          provider: r.provider,
          verificationStatus: r.verification_status,
          certificateSerial: r.tarragon_certificate_serial,
        })),
        (schedules.data ?? []).map((s) => ({ vaccine: s.vaccination_catalog?.name ?? "Vaccine", dueDate: s.due_date })),
      );

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          backTo={{ href: "/patient/my-health", label: t("my_health.title") }}
          title={t("my_health.immunisation.title")}
          icon={NAV_ICON.passport}
          description={t("my_health.immunisation.description")}
          actions={card ? <PrintButton /> : undefined}
        />
      </div>

      {failed || !card ? (
        <p role="alert" className="text-sm text-red-700">
          {t("my_health.immunisation.failed")}
        </p>
      ) : (
        <article className="mx-auto max-w-2xl rounded-lg border border-charcoal-ink/15 bg-white p-5 text-charcoal-ink print:max-w-none print:border-0 print:p-0">
          <header className="border-b border-charcoal-ink/15 pb-3">
            <p className="text-xs uppercase tracking-widest text-charcoal-ink/60">{t("my_health.immunisation.card_label")}</p>
            <h1 className="mt-1 text-xl font-semibold">{(acting ? acting.fullName : profile.full_name) ?? ""}</h1>
            {acting ? <p className="text-xs text-charcoal-ink/60">{t("my_health.immunisation.acting_note")}</p> : null}
            <p className="mt-1 text-xs text-charcoal-ink/60">{t("my_health.immunisation.printed_on", "en", { date: formatDate(new Date().toISOString()) })}</p>
          </header>

          {card.vaccines.length === 0 ? (
            <p className="mt-4 text-sm text-charcoal-ink/70">{t("my_health.immunisation.none")}</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {card.vaccines.map((v) => (
                <li key={v.vaccine}>
                  <p className="text-sm font-semibold">{v.vaccine}</p>
                  <ul className="mt-1 divide-y divide-charcoal-ink/10">
                    {v.doses.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                        <span>
                          {t("my_health.immunisation.dose", "en", { n: String(d.doseNumber) })} · {formatDate(d.date)}
                          {d.provider ? ` · ${d.provider}` : ""}
                          {d.serial ? ` · ${d.serial}` : ""}
                        </span>
                        <Badge variant={d.trust === "verified" ? "green" : d.trust === "waiting" ? "amber" : "grey"}>{t(TRUST_KEY[d.trust])}</Badge>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {card.counts.rejected > 0 ? <p className="mt-4 text-sm text-charcoal-ink/70">{t("my_health.immunisation.rejected_note", "en", { count: String(card.counts.rejected) })}</p> : null}

          {card.next.length > 0 ? (
            <section className="mt-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">{t("my_health.immunisation.next")}</h2>
              <ul className="mt-1 text-sm">
                {card.next.map((n) => (
                  <li key={`${n.vaccine}-${n.dueDate}`}>
                    {n.vaccine} · {formatDate(n.dueDate)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <footer className="mt-5 border-t border-charcoal-ink/15 pt-3 text-xs text-charcoal-ink/60">
            <p>{t("my_health.immunisation.footer")}</p>
          </footer>
        </article>
      )}

      <p className="print:hidden text-sm">
        <Link href="/patient/prevention" className="font-medium text-brand-green underline dark:text-brand-green-bright">
          {t("my_health.immunisation.manage")}
        </Link>
      </p>
    </div>
  );
}
