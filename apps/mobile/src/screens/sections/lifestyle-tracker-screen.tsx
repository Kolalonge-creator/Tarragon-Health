import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Card,
  ErrorText,
  GroupedList,
  GroupedListRow,
  MutedText,
  PrimaryButton,
  ScreenTitle,
  SectionLabel,
} from "@/ui/components";
import { colors, radius, spacing, typeScale } from "@/ui/theme";
import { useT } from "@/lib/ui-language";

/**
 * One shell for all the daily lifestyle trackers (sleep, alcohol, smoking,
 * activity), which previously had no native screen at all: the Lifestyle hub
 * listed them and opened each in the SYSTEM browser, dropping the patient out
 * of the app into different chrome with a URL bar and no tab bar. That is the
 * most jarring "I have left the app" moment in the product, and it sat on the
 * features somebody is meant to touch daily.
 *
 * Deliberately ONE component rather than four screens: these trackers differ
 * only in which numbers they collect, and building them separately is how
 * four surfaces that should feel identical slowly stop looking alike. The
 * per-tracker parts are the fields and the summary line; everything else --
 * layout, spacing, the empty state, the history list, error handling -- is
 * shared by construction.
 */
export interface TrackerField {
  key: string;
  label: string;
  /** Shown under the input, e.g. "Hours, like 7.5". */
  hint?: string;
  keyboard?: "numeric" | "default";
  required?: boolean;
  /** Renders a row of chips instead of a text field. Added for the meal-type
   * picker: a patient choosing breakfast/lunch/dinner should tap, not type,
   * and putting it in the shared shell keeps that screen looking like its
   * four siblings rather than becoming a one-off. */
  choices?: { value: string; label: string }[];
}

export interface TrackerHistoryItem {
  id: string;
  title: string;
  subtitle?: string;
}

export interface LifestyleTrackerConfig<S> {
  title: string;
  /** One plain sentence: what this is for, in the patient's terms. */
  blurb: string;
  fields: TrackerField[];
  submitLabel: string;
  load: () => Promise<{ ok: true; data: S } | { ok: false; error: string }>;
  /** Values are raw strings straight from the inputs; the tracker parses. */
  submit: (values: Record<string, string>) => Promise<{ error?: string }>;
  /** The one number worth showing at the top, if there is one. */
  summary: (state: S) => { label: string; value: string } | null;
  history: (state: S) => TrackerHistoryItem[];
  emptyHistory: string;
}

export function LifestyleTrackerScreen<S>({ config }: { config: LifestyleTrackerConfig<S> }) {
  const t = useT();
  const [state, setState] = useState<S | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const result = await config.load();
    if (result.ok) {
      setState(result.data);
      setLoadError(null);
    } else {
      // Never render a failed read as "you have logged nothing" -- that reads
      // to the patient as data loss.
      setLoadError(result.error);
    }
    setLoading(false);
    setRefreshing(false);
  }, [config]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const missing = config.fields.find((f) => f.required && !values[f.key]?.trim());
    if (missing) {
      setSaveError(`${missing.label} is needed.`);
      setSaving(false);
      return;
    }
    const result = await config.submit(values);
    if (result.error) {
      setSaveError(result.error);
    } else {
      setValues({});
      setSaved(true);
      await load();
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const summary = state ? config.summary(state) : null;
  const history = state ? config.history(state) : [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 14 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.brand}
        />
      }
    >
      <View>
        <ScreenTitle>{config.title}</ScreenTitle>
        <MutedText>{config.blurb}</MutedText>
      </View>

      {loadError ? <ErrorText>{loadError}</ErrorText> : null}

      {summary ? (
        <Card>
          <Text style={{ fontSize: typeScale.caption, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", color: colors.muted }}>
            {summary.label}
          </Text>
          <Text style={{ fontSize: typeScale.hero, fontWeight: "700", color: colors.ink, marginTop: 2 }}>
            {summary.value}
          </Text>
        </Card>
      ) : null}

      <Card style={{ gap: 12 }}>
        {config.fields.map((field) => (
          <View key={field.key} style={{ gap: 6 }}>
            <Text style={{ fontSize: typeScale.body, fontWeight: "600", color: colors.ink }}>
              {field.label}
            </Text>
            {field.choices ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {field.choices.map((choice) => {
                  const selected = values[field.key] === choice.value;
                  return (
                    <Pressable
                      key={choice.value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, checked: selected }}
                      onPress={() => setValues((v) => ({ ...v, [field.key]: choice.value }))}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 16,
                        borderRadius: radius.control,
                        backgroundColor: selected ? colors.brand : colors.groupBg,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: typeScale.body,
                          fontWeight: "600",
                          color: selected ? "#FFFFFF" : colors.ink,
                        }}
                      >
                        {choice.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
            <TextInput
              accessibilityLabel={field.label}
              value={values[field.key] ?? ""}
              onChangeText={(text) => setValues((v) => ({ ...v, [field.key]: text }))}
              keyboardType={field.keyboard === "numeric" ? "decimal-pad" : "default"}
              placeholderTextColor={colors.faint}
              placeholder={field.hint}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.control,
                paddingHorizontal: 12,
                // Keeps the field itself above the 44pt touch-target floor.
                paddingVertical: 12,
                fontSize: typeScale.body,
                color: colors.ink,
                backgroundColor: colors.card,
              }}
            />
            )}
          </View>
        ))}
        <PrimaryButton title={config.submitLabel} onPress={() => void onSubmit()} loading={saving} />
        {saveError ? <ErrorText>{saveError}</ErrorText> : null}
        {saved ? <MutedText>{t("Saved.")}</MutedText> : null}
      </Card>

      <View style={{ gap: 10 }}>
        <SectionLabel>{t("Last 30 days")}</SectionLabel>
        {history.length === 0 ? (
          <MutedText>{config.emptyHistory}</MutedText>
        ) : (
          <GroupedList>
            {history.map((item) => (
              <GroupedListRow
                key={item.id}
                title={item.title}
                subtitle={item.subtitle}
                trailing={null}
              />
            ))}
          </GroupedList>
        )}
      </View>
    </ScrollView>
  );
}
