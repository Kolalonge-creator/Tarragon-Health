import { notFound, redirect } from "next/navigation";
import { t, type MessageKey } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getLibraryItem } from "@/lib/wellbeing-library/queries";
import { WellbeingShell } from "@/components/wellbeing/wellbeing-shell";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { Card, CardContent } from "@/components/ui/card";
import { MediaPlayer } from "../media-player";
import { ExerciseStepper } from "../exercise-stepper";
import { PacedBreathing } from "../../breathing/paced-breathing";

type Script = { steps?: { text?: string }[]; pattern?: { inhale_s?: number; hold_s?: number; exhale_s?: number } };

export default async function LibraryItemPage({ params }: { params: Promise<{ code: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { code } = await params;
  const { item, failed } = await getLibraryItem(code);
  if (failed) return <WellbeingShell><LoadFailure>{t("library.error")}</LoadFailure></WellbeingShell>;
  // The database returns nothing for an item that is expired, a placeholder, unpublished or behind a closed guard: a calm 404.
  if (!item) notFound();
  const script = (item.script ?? {}) as Script;
  const steps = (script.steps ?? []).map((s) => s.text ?? "").filter((s) => s.length > 0);
  const audioSrc = item.audio_url;

  return (
    <WellbeingShell>
      <PageHeader title={item.title} description={item.summary ?? undefined} backTo={{ href: "/patient/wellbeing/library", label: t("library.title") }} />
      <Card>
        <CardContent className="space-y-4 pt-4">
          {(item.kind === "meditation" || item.kind === "sleep_story" || item.kind === "soundscape") &&
            (audioSrc ? <MediaPlayer mediaId={item.id} src={audioSrc} sleepTimer={item.kind !== "meditation"} /> : <p className="text-sm">{t("library.player.not_available")}</p>)}
          {item.kind === "exercise" && <ExerciseStepper mediaId={item.id} steps={steps} />}
          {item.kind === "breathing" && script.pattern?.inhale_s && script.pattern.exhale_s && item.duration_seconds && (
            <PacedBreathing mediaId={item.id} pattern={{ inhale_s: script.pattern.inhale_s, hold_s: script.pattern.hold_s ?? 0, exhale_s: script.pattern.exhale_s }} totalSeconds={item.duration_seconds} steps={steps} />
          )}
          {(item.kind === "exercise" || item.kind === "breathing") && (
            <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t(item.kind === "exercise" ? "library.exercise.note" : "breathing.safety")}</p>
          )}
          {item.reviewed_by_name && item.reviewed_at && (
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("library.reviewed", "en", { name: item.reviewed_by_name, date: item.reviewed_at })}</p>
          )}
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t(`library.kind.${item.kind}` as MessageKey)}</p>
        </CardContent>
      </Card>
    </WellbeingShell>
  );
}
