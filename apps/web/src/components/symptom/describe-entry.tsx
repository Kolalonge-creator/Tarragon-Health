"use client";

import { useState } from "react";
import { isSelfHarmScreen, screenAssistantMessage } from "@tarragon/clinical/assistant-danger-screen";
import { describeEntry, MAX_DESCRIBE_CHARS, type DescribeTable } from "@tarragon/symptom-triage-engine";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * S59c: "describe it in your own words". Deterministic, on this device, no model, no network.
 *
 * ORDER (the safety rule): the shared danger-phrase screen runs over the raw text FIRST. A hit calls `onDanger` at once, and the text is
 * thrown away; no synonym, however exact, can outrank it. Only then is the synonym table consulted. A weak, ambiguous or missing match
 * sends the person to the ordinary safety checklist and the picker: never to reassurance.
 *
 * PRIVACY: the text lives in this component's state only. It is not stored, not logged, not put in a URL and never sent anywhere; it is
 * cleared as soon as it has been used or when the person presses clear. If a summary is sent to the care team later, that is built from the
 * structured answers, never from this text.
 *
 * `table` is the synonym table in force (signed and matching the live one) or null. With null the box still screens for danger, and
 * the person is told we could not match it and shown the normal checklist.
 */
export type DescribeChoice = { key: string; label: string };

export function DescribeEntry({
  complaints,
  table,
  onChoose,
  onDanger,
}: {
  complaints: readonly DescribeChoice[];
  table: DescribeTable | null;
  onChoose: (complaintKey: string) => void;
  onDanger: (selfHarm: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<{ kind: "none" } | { kind: "match"; key: string } | { kind: "ambiguous"; keys: string[] } | { kind: "no_match" }>({ kind: "none" });
  const labelOf = (key: string) => complaints.find((c) => c.key === key)?.label ?? key;

  function find() {
    const r = describeEntry(text, {
      dangerScreen: (s) => {
        const screen = screenAssistantMessage(s);
        return { redFlag: screen.redFlag, selfHarm: isSelfHarmScreen(screen) };
      },
      table,
      available: complaints.map((c) => c.key),
    });
    if (r.kind === "danger") {
      setText(""); // thrown away at once
      setOutcome({ kind: "none" });
      onDanger(r.selfHarm);
      return;
    }
    if (r.kind === "match") setOutcome({ kind: "match", key: r.pathwayKey });
    else if (r.kind === "ambiguous") setOutcome({ kind: "ambiguous", keys: r.candidates });
    else setOutcome({ kind: "no_match" });
    // the words have done their job; only the decision is kept
    setText("");
  }

  return (
    <section aria-labelledby="symptom-describe-title" className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <h3 id="symptom-describe-title" className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
        {t("symptom.describe.title")}
      </h3>
      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("symptom.describe.intro")}</p>
      <Label htmlFor="symptom-describe-text">{t("symptom.describe.label")}</Label>
      <textarea
        id="symptom-describe-text"
        value={text}
        maxLength={MAX_DESCRIBE_CHARS}
        rows={3}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setOutcome({ kind: "none" });
        }}
        className="w-full rounded border border-charcoal-ink/20 bg-transparent p-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={text.trim().length === 0} onClick={find}>
          {t("symptom.describe.button")}
        </Button>
        {text.length > 0 && (
          <Button type="button" variant="outline" onClick={() => setText("")}>
            {t("symptom.describe.clear")}
          </Button>
        )}
      </div>
      {outcome.kind === "match" && (
        <div className="space-y-2" role="status">
          <p className="text-sm text-charcoal-ink dark:text-night-ink">{t("symptom.describe.match", "en", { name: labelOf(outcome.key) })}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => onChoose(outcome.key)}>
              {t("symptom.describe.match_yes")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOutcome({ kind: "none" })}>
              {t("symptom.describe.match_no")}
            </Button>
          </div>
        </div>
      )}
      {outcome.kind === "ambiguous" && (
        <div className="space-y-2" role="status">
          <p className="text-sm text-charcoal-ink dark:text-night-ink">{t("symptom.describe.ambiguous")}</p>
          <div className="flex flex-wrap gap-2">
            {outcome.keys.map((k) => (
              <Button key={k} type="button" variant="outline" onClick={() => onChoose(k)}>
                {labelOf(k)}
              </Button>
            ))}
          </div>
        </div>
      )}
      {outcome.kind === "no_match" && (
        <p className="text-sm text-charcoal-ink dark:text-night-ink" role="status">
          {t("symptom.describe.no_match")}
        </p>
      )}
    </section>
  );
}
