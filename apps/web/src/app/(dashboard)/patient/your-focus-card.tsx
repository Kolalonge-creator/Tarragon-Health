import Link from "next/link";
import { t, type MessageKey } from "@tarragon/i18n";
import { answersFromRows, focusFromAnswers } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

/**
 * Home cards that follow the person's own onboarding answers (S41, spec 1.10). Reads the signed-in patient's own
 * `onboarding_answers` rows (RLS: own rows only) and shows at most three cards, in a fixed order. It only changes what leads:
 * every other card on Home is unchanged, and the cards link to pages that already exist. Renders nothing when there are no
 * answers (an older account, or the save failed) and never when acting for someone else, whose answers are theirs alone.
 */
export async function YourFocusCard({ patientId, acting }: { patientId: string; acting: boolean }) {
  if (acting) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("onboarding_answers").select("question_code, answer").eq("patient_id", patientId);
  const answers = answersFromRows(data);
  if (!answers) return null;
  const items = focusFromAnswers(answers);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("onb.focus.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="block min-h-11 rounded-xl border border-charcoal-ink/10 p-3 hover:border-brand-green/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
              >
                <span className="block text-sm font-semibold text-charcoal-ink">{t(`onb.focus.${item.id}.title` as MessageKey)}</span>
                <span className="mt-0.5 block text-xs text-charcoal-ink/60">{t(`onb.focus.${item.id}.body` as MessageKey)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
