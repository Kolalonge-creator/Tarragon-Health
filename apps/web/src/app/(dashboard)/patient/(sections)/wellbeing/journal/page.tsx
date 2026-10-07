import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { listLibrary } from "@/lib/wellbeing-library/queries";
import { WellbeingShell } from "@/components/wellbeing/wellbeing-shell";
import { PageHeader } from "@/components/ui/page-header";
import { JournalClient } from "./journal-client";

export const metadata = { title: "Private journal" };

export default async function JournalPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const all = (await listLibrary()) ?? [];
  // Prompts are reviewed library items; the first step of the script is the prompt text. No prompt is written by the build.
  const prompts = all
    .filter((i) => i.kind === "exercise" && i.exercise_type === "journal_prompt")
    .map((i) => ({ code: i.code, title: i.title, text: ((i.script as { steps?: { text?: string }[] } | null)?.steps?.[0]?.text ?? "").trim() }))
    .filter((p) => p.text.length > 0);
  return (
    <WellbeingShell>
      <PageHeader title={t("journal.title")} description={t("journal.intro")} backTo={{ href: "/patient/wellbeing", label: "Wellbeing" }} />
      <JournalClient prompts={prompts} patientId={profile.id} />
    </WellbeingShell>
  );
}
