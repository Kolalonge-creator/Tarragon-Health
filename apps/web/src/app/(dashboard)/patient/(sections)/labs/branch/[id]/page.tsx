import Link from "next/link";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate } from "@/lib/format-date";
import { loadBranchProfile } from "@/lib/diagnostic-directory/patient-search";

export const metadata = { title: "Lab or imaging branch" };
export const dynamic = "force-dynamic";

const locale = DEFAULT_UI_LANGUAGE;

/** Diagnostic directory Phase 6: one listed branch, its contact details and the tests it passes every check for today. */
export default async function BranchProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadBranchProfile(id);
  return (
    <div className="space-y-4">
      <Link href="/patient/labs" className="text-sm text-brand-green hover:underline">{t("dxsearch.branch.back", locale)}</Link>
      {!loaded.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {t(loaded.closed ? "dxsearch.find.closed" : "dxsearch.find.error", locale)}
        </p>
      ) : !loaded.profile ? (
        <p className="text-sm text-charcoal-ink/70">{t("dxsearch.branch.not_found", locale)}</p>
      ) : (
        <Profile p={loaded.profile} />
      )}
    </div>
  );
}

function Profile({ p }: { p: NonNullable<Extract<Awaited<ReturnType<typeof loadBranchProfile>>, { ok: true }>["profile"]> }) {
  const maps = p.latitude !== null && p.longitude !== null ? `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}` : null;
  return (
    <>
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">{p.provider_name}: {p.branch_name}</h1>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{[p.address, p.neighbourhood, p.town, p.lga, p.state].filter(Boolean).join(", ")}</p>
        {p.is_partner && (
          <details className="mt-2 text-xs">
            <summary className="inline-block cursor-pointer rounded-full border border-charcoal-ink/30 px-2 py-0.5 font-semibold text-charcoal-ink">{t("dxsearch.partner.badge", locale)}</summary>
            <p className="mt-1 max-w-2xl text-charcoal-ink/70">{t("dxsearch.partner.explainer", locale)}</p>
          </details>
        )}
      </div>
      <Card>
        <CardHeader><CardTitle>{t("dxsearch.branch.contact", locale)}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {p.phone && <p><a className="text-brand-green hover:underline" href={`tel:${p.phone}`}>{p.phone}</a></p>}
          {p.email && <p><a className="text-brand-green hover:underline" href={`mailto:${p.email}`}>{p.email}</a></p>}
          {p.website && <p><a className="text-brand-green hover:underline" href={p.website} target="_blank" rel="noopener noreferrer">{p.website}</a></p>}
          {maps && <p><a className="text-brand-green hover:underline" href={maps} target="_blank" rel="noopener noreferrer">{t("dxsearch.place.directions", locale)}</a></p>}
          {p.location_checked_on && <p className="text-xs text-charcoal-ink/60">{t("dxsearch.branch.checked", locale, { date: formatPatientDate(p.location_checked_on) })}</p>}
          <p className="text-xs text-charcoal-ink/60">{t("dxsearch.branch.prices", locale)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("dxsearch.branch.tests", locale)}</CardTitle></CardHeader>
        <CardContent>
          {p.services.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">{t("dxsearch.branch.no_tests", locale)}</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10 text-sm">
              {p.services.map((s) => (
                <li key={s.concept_id} className="py-2">
                  <p className="font-medium text-charcoal-ink dark:text-night-ink">{s.test}</p>
                  {(s.appointment_required || s.availability === "by_appointment") && <p className="text-xs text-charcoal-ink/70">{t("dxsearch.find.by_appointment", locale)}</p>}
                  {s.performed_elsewhere && <p className="text-xs text-charcoal-ink/70">{t("dxsearch.find.sent_elsewhere", locale)}</p>}
                  {s.preparation_note && <p className="text-xs text-charcoal-ink/70">{t("dxsearch.place.prep", locale, { note: s.preparation_note })}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-charcoal-ink/60">{t("dxsearch.verified.explainer", locale)}</p>
        </CardContent>
      </Card>
    </>
  );
}
