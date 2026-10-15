import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { listLibrary } from "@/lib/wellbeing-library/queries";
import { WellbeingShell } from "@/components/wellbeing/wellbeing-shell";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";

export const metadata = { title: "Slow breathing" };

export default async function BreathingPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const all = await listLibrary();
  const items = (all ?? []).filter((i) => i.kind === "breathing");
  return (
    <WellbeingShell>
      <PageHeader title={t("breathing.title")} description={t("breathing.intro")} backTo={{ href: "/patient/wellbeing", label: "Wellbeing" }} />
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("breathing.safety")}</p>
      {all === null ? (
        <LoadFailure>{t("library.error")}</LoadFailure>
      ) : items.length === 0 ? (
        <p className="text-sm">{t("library.empty")}</p>
      ) : (
        <>
          <p className="text-sm font-medium">{t("breathing.choose")}</p>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id}>
                <Link className="underline" href={`/patient/wellbeing/library/${i.code}`}>{i.title}</Link>
                {i.duration_seconds ? ` (${t("library.minutes", "en", { n: Math.max(1, Math.round(i.duration_seconds / 60)) })})` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </WellbeingShell>
  );
}
