import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { t } from "@tarragon/i18n";
import {
  confirmReportedDraft,
  loadReportedDrafts,
  planReportedConfirm,
  type ReportedDraft,
} from "@/lib/reported-values";
import { space } from "@/ui/design";
import { AppText, Button, Card, Field, InlineAlert } from "@/ui/kit";

/**
 * "Confirm the numbers from your uploaded reports." Shown only on the person's OWN results screen. Each report gets its date and its
 * numbers, editable; confirming puts them on the person's own chart marked as reported by them. Nothing here grades, flags or explains a
 * number, and the card says plainly that a doctor has not checked them.
 */
export function ReportedValuesCard({ onConfirmed }: { onConfirmed: () => void }) {
  const [drafts, setDrafts] = useState<ReportedDraft[]>([]);

  const refresh = useCallback(async () => {
    setDrafts(await loadReportedDrafts());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (drafts.length === 0) return null;
  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: space.xs }} accessible accessibilityRole="header">
        <AppText variant="title">{t("biomarkers.reported.title")}</AppText>
      </View>
      <AppText variant="body" tone="textMuted">{t("biomarkers.reported.intro")}</AppText>
      {drafts.map((d) => (
        <DraftCard
          key={d.extractionId}
          draft={d}
          onSaved={() => {
            void refresh();
            onConfirmed();
          }}
        />
      ))}
      <AppText variant="caption" tone="textMuted">{t("biomarkers.reported.note")}</AppText>
    </View>
  );
}

function DraftCard({ draft, onSaved }: { draft: ReportedDraft; onSaved: () => void }) {
  const [date, setDate] = useState(draft.reportDate ?? "");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(draft.rows.map((r) => [r.code, String(r.value)])));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(
    draft.confirmed ? { tone: "info", text: t("biomarkers.reported.done") } : null,
  );

  async function save() {
    setMessage(null);
    const plan = planReportedConfirm(draft, values, date);
    if (!plan.ok) {
      setMessage({ tone: "danger", text: t("biomarkers.reported.error") });
      return;
    }
    setSaving(true);
    const result = await confirmReportedDraft(plan.args);
    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: "danger", text: result.message });
      return;
    }
    setMessage({ tone: "info", text: t("biomarkers.reported.done") });
    onSaved();
  }

  return (
    <Card>
      <View style={{ gap: space.md }}>
        {draft.filename ? <AppText variant="bodyStrong">{draft.filename}</AppText> : null}
        <Field
          label={t("biomarkers.reported.date")}
          hint="Year, month, day, for example 2026-10-01"
          value={date}
          onChangeText={setDate}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
        {draft.rows.map((r) => (
          <Field
            key={r.code}
            label={r.unit ? `${r.label} (${r.unit})` : r.label}
            value={values[r.code] ?? ""}
            onChangeText={(v) => setValues((prev) => ({ ...prev, [r.code]: v }))}
            keyboardType="decimal-pad"
          />
        ))}
        {message ? <InlineAlert tone={message.tone} message={message.text} /> : null}
        <Button title={t("biomarkers.reported.confirm")} onPress={() => void save()} loading={saving} />
      </View>
    </Card>
  );
}
