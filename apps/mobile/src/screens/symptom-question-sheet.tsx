import { useEffect, useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { QUESTION_SYMPTOMS, type QuestionSymptom } from "@/lib/symptom-question";
import { MIN_TARGET, radii, space, useTheme } from "@/ui/design";
import { AppText, Button, Icon, InlineAlert, PressableScale } from "@/ui/kit";

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * The emergency-symptom question for a very high reading (TRI-008, rule BP-X1).
 *
 * Shown over the blood pressure form after a reading at or above the rule set's question line (params.extreme: 200/130 in the approved version 3, 180/120 in the draft version 4), before it is graded. The reading is already
 * being saved behind it; this only decides what the patient is told next. Two answers, nothing to skip:
 *  - "Yes, I have at least one" (enabled once a symptom is chosen): the symptoms are saved and the emergency guidance shows.
 *  - "No, none of these": medicine, rest and a recheck after 2 hours.
 * Colour is never the only signal: a chosen row carries a tick and the checkbox state is read out.
 * The Android back button does nothing here on purpose; the question has two short answers.
 */
export function SymptomQuestionSheet({
  visible,
  tr,
  busy,
  failed,
  onAnswer,
}: {
  visible: boolean;
  tr: Tr;
  busy: boolean;
  /** The last answer could not be saved or graded; the patient can try again. */
  failed: boolean;
  onAnswer: (symptoms: QuestionSymptom[]) => void;
}) {
  const { colors } = useTheme();
  const [chosen, setChosen] = useState<QuestionSymptom[]>([]);
  useEffect(() => {
    if (visible) setChosen([]);
  }, [visible]);
  const toggle = (s: QuestionSymptom) => setChosen((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingTop: 56, gap: space.lg }}>
          <AppText variant="headline" heading>
            {tr("triage.tri_008.title" as MessageKey)}
          </AppText>
          <AppText variant="body">{tr("triage.tri_008.body" as MessageKey)}</AppText>
          <AppText variant="caption" tone="textMuted">
            {tr("triage.question.pick" as MessageKey)}
          </AppText>
          <View accessibilityLabel={tr("triage.question.list_label" as MessageKey)} style={{ gap: space.xs }}>
            {QUESTION_SYMPTOMS.map((s) => {
              const checked = chosen.includes(s);
              return (
                <PressableScale
                  key={s}
                  onPress={() => toggle(s)}
                  accessibilityRole="checkbox"
                  accessibilityLabel={tr(`vitals.symptom.${s}` as MessageKey)}
                  accessibilityState={{ checked, disabled: busy }}
                  disabled={busy}
                  scaleTo={0.98}
                  style={{
                    minHeight: MIN_TARGET,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    paddingHorizontal: space.md,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: checked ? colors.brand : colors.border,
                    backgroundColor: checked ? colors.surfaceMuted : colors.surface,
                  }}
                >
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: radii.sm,
                      borderWidth: 2,
                      borderColor: checked ? colors.brand : colors.border,
                      backgroundColor: checked ? colors.brand : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {checked ? <Icon name="done" size={16} tone="textOnBrand" /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="body">{tr(`vitals.symptom.${s}` as MessageKey)}</AppText>
                  </View>
                </PressableScale>
              );
            })}
          </View>
          {failed ? <InlineAlert tone="danger" message={tr("triage.question.error" as MessageKey)} /> : null}
          <View style={{ gap: space.sm }}>
            <Button
              title={busy ? tr("triage.question.saving" as MessageKey) : tr("triage.question.yes" as MessageKey)}
              onPress={() => onAnswer(chosen)}
              loading={busy}
              disabled={busy || chosen.length === 0}
            />
            <Button title={tr("triage.question.none" as MessageKey)} variant="secondary" onPress={() => onAnswer([])} disabled={busy} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
