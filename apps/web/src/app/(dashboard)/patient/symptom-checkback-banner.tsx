import Link from "next/link";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";

type Reader = {
  from(table: string): {
    select(cols: string): { eq(col: string, v: string): { order(col: string): { limit(n: number): PromiseLike<{ data: { id: string }[] | null; error: unknown }> } } };
  };
};

/**
 * S59c: a quiet pointer to a follow-up that is waiting ("Your care team would like to know how you are getting on"). It reads the
 * person's own open follow-ups (the table policy admits only the patient) and renders nothing when there is none, when the read fails, or
 * when the symptom checker is closed (the parent only renders it while the checker is open). It never appears as an alarm, carries no
 * result detail, and nothing in the app depends on it being seen or answered.
 */
export async function SymptomCheckbackBanner() {
  const supabase = await createClient();
  const { data, error } = await (supabase as unknown as Reader).from("symptom_checkbacks").select("id").eq("state", "open").order("due_at").limit(1);
  const first = !error ? data?.[0] : undefined;
  if (!first) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15" data-testid="symptom-checkback-banner">
      <span className="text-charcoal-ink dark:text-night-ink">{t("symptom.checkback.banner")}</span>
      <Link href={`/patient/symptom-checkback/${first.id}`} className="font-medium text-brand-green hover:underline">
        {t("symptom.checkback.banner_cta")}
      </Link>
    </div>
  );
}
