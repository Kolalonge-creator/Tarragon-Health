import Link from "next/link";
import { redirect } from "next/navigation";
import { t, type MessageKey } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { listLibrary, MEDIA_KINDS, type MediaItem } from "@/lib/wellbeing-library/queries";
import { WellbeingShell } from "@/components/wellbeing/wellbeing-shell";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuietTimer } from "./quiet-timer";

export const metadata = { title: "Calm and sleep" };

const SERIES_ORDER = ["intro", "stress", "grief", "work", "exams", "faith_reflection", "sleep", "general"] as const;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { kind } = await searchParams;
  const activeKind = (MEDIA_KINDS as readonly string[]).includes(kind ?? "") ? (kind as MediaItem["kind"]) : null;
  const all = await listLibrary();
  const items = (all ?? []).filter((i) => !activeKind || i.kind === activeKind);

  return (
    <WellbeingShell>
      <PageHeader title={t("library.title")} description={t("library.intro")} backTo={{ href: "/patient/wellbeing", label: "Wellbeing" }} />
      <nav aria-label={t("library.title")} className="flex flex-wrap gap-2 text-sm">
        <Link href="/patient/wellbeing/library" className={`rounded-full border px-3 py-1 ${!activeKind ? "bg-brand-green text-white border-brand-green" : "border-charcoal-ink/20 dark:border-night-ink/25"}`}>All</Link>
        {MEDIA_KINDS.map((k) => (
          <Link key={k} href={`/patient/wellbeing/library?kind=${k}`} className={`rounded-full border px-3 py-1 ${activeKind === k ? "bg-brand-green text-white border-brand-green" : "border-charcoal-ink/20 dark:border-night-ink/25"}`}>
            {t(`library.kind.${k}` as MessageKey)}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link className="underline" href="/patient/wellbeing/breathing">{t("breathing.title")}</Link>
        <Link className="underline" href="/patient/wellbeing/journal">{t("journal.title")}</Link>
      </div>
      <QuietTimer />
      {all === null ? (
        <LoadFailure>{t("library.error")}</LoadFailure>
      ) : items.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("library.empty")}</p>
      ) : (
        SERIES_ORDER.map((series) => {
          const inSeries = items.filter((i) => i.series === series);
          if (inSeries.length === 0) return null;
          return (
            <Card key={series}>
              <CardHeader>
                <CardTitle className="text-base">{t(`library.series.${series}` as MessageKey)}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                  {inSeries.map((i) => (
                    <li key={i.id} className="py-2">
                      <Link href={`/patient/wellbeing/library/${i.code}`} className="font-medium underline">{i.title}</Link>
                      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                        {t(`library.kind.${i.kind}` as MessageKey)}
                        {i.duration_seconds ? ` · ${t("library.minutes", "en", { n: Math.max(1, Math.round(i.duration_seconds / 60)) })}` : ""}
                        {i.voice ? ` · ${i.voice}` : ""}
                      </p>
                      {i.summary && <p className="text-sm">{i.summary}</p>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}
    </WellbeingShell>
  );
}
