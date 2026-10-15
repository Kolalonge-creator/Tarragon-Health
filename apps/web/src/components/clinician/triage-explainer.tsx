import { t, type Locale } from "@tarragon/i18n";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CUFF_KEY, parseContext, readingLine, wordingKeys, type Explainer } from "@/lib/triage/explainer";

const day = (value: string): string => new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" });

/**
 * Why the engine raised this task (P6, decision-support transparency): the rule id, the rule set and its version, the grade,
 * and the facts the rule was given. It is a read of one audited function (INV-10, INV-12). It shows no model output because
 * none exists: the grade is a fixed rule (INV-01). A wrist cuff gets the upper-arm repeat hint; the grade is never lowered for it.
 */
export function TriageExplainer({ explainer, locale = "en" }: { explainer: Explainer | null; locale?: Locale }) {
  if (!explainer) {
    return <p role="alert" className="text-sm text-red-600">{t("explainer.load_error", locale)}</p>;
  }
  // A task that did not come from a triage rule (a manual or scheduled task) has nothing to explain; a denied read shows nothing.
  if (explainer.status !== "ok") return null;
  const e = explainer.triage_event;
  const c = parseContext(e.context);
  const words = wordingKeys(e.explanation_key);
  const reading = c ? readingLine(c) : null;
  return (
    <Card aria-labelledby="explainer-title">
      <CardHeader>
        <CardTitle id="explainer-title">{t("explainer.title", locale)}</CardTitle>
        <p className="text-xs text-charcoal-ink/60">{t("explainer.intro", locale)}</p>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p className="flex items-center gap-2">
          <Badge variant={e.grade === "red" ? "red" : e.grade === "amber" ? "amber" : "green"}>{e.grade}</Badge>
          <span>{t("explainer.rule", locale, { rule: e.rule_id ?? "-", code: e.rule_set_code, version: e.rule_set_version })}</span>
        </p>
        {words && <p className="text-charcoal-ink/80">{t(words.title, locale)}</p>}
        {reading && <p>{t("explainer.reading", locale, { reading })}</p>}
        {c?.cuffType && (
          <p>
            {t(CUFF_KEY[c.cuffType], locale)}
            {c.cuffType === "wrist" && <span className="block text-xs text-amber-700">{t("explainer.wrist_hint", locale)}</span>}
          </p>
        )}
        {c && c.reading && (c.symptoms && c.symptoms.length > 0
          ? <p>{t("explainer.symptoms", locale, { symptoms: c.symptoms.map((s) => s.replace(/_/g, " ")).join(", ") })}</p>
          : <p>{t("explainer.no_symptoms", locale)}</p>)}
        {c?.type === "silence" && (
          <p>
            {c.lastReadingAt
              ? t("explainer.silence", locale, { date: day(c.lastReadingAt) })
              : c.sinceAt ? t("explainer.silence_never", locale, { date: day(c.sinceAt) }) : null}
          </p>
        )}
        {c?.type === "adherence" && typeof c.percent7d === "number" && <p>{t("explainer.adherence", locale, { percent: c.percent7d })}</p>}
      </CardContent>
    </Card>
  );
}
