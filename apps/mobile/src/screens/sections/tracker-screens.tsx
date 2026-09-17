import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  loadActivityState,
  loadAlcoholState,
  loadSleepState,
  loadSmokingState,
  logActivity,
  logAlcohol,
  logSleep,
  logSmoking,
  type ActivityState,
  type AlcoholState,
  type SleepState,
  type SmokingState,
  loadMealsState,
  logMeal,
  logMealWithPhoto,
  type MealsState,
  type MealType,
  type MealPhotoEstimate,
} from "@/lib/lifestyle-trackers";
import { LifestyleTrackerScreen } from "@/screens/sections/lifestyle-tracker-screen";
import {
  Badge,
  Card,
  ErrorText,
  GroupedList,
  GroupedListRow,
  MutedText,
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
  SectionLabel,
} from "@/ui/components";
import { colors, radius, spacing, typeScale } from "@/ui/theme";
import { useT } from "@/lib/ui-language";

/**
 * The five daily lifestyle trackers as native screens, each a thin
 * configuration of the shared shell. See lifestyle-tracker-screen.tsx for why
 * they share one component, and lib/lifestyle-trackers.ts for why sleep alone
 * writes through the server.
 *
 * Copy is deliberately plain: "How long did you sleep?", not "Sleep duration
 * (hours)". These are daily-use screens for people who are not filling in a
 * clinical form.
 *
 * Every question, blurb, button and empty state routes through `useT()` --
 * this is lifestyle logging, not clinical guidance, so it sits inside the
 * wayfinding boundary in packages/shared/src/ui-language.ts. Short stat-tile
 * labels (`{ label: "Your target", ... }`) and the meal-type chips are left
 * untranslated on purpose; see that file's comment above the entries for why.
 */

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Lagos",
  });
}

function num(values: Record<string, string>, key: string): number | undefined {
  const raw = values[key]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function SleepScreen({ patientId }: { patientId: string }) {
  const t = useT();
  return (
    <LifestyleTrackerScreen<SleepState>
      config={{
        title: t("Sleep"),
        blurb: t(
          "Log how you slept. Over a few weeks this shows a pattern you and your care team can see."
        ),
        fields: [
          { key: "hours", label: t("How long did you sleep?"), hint: "Hours, like 7.5", keyboard: "numeric", required: true },
          { key: "quality", label: t("How was it, 1 to 5?"), hint: "1 is poor, 5 is great", keyboard: "numeric" },
          { key: "sleepy", label: t("How sleepy were you in the day, 1 to 5?"), hint: "Optional", keyboard: "numeric" },
        ],
        submitLabel: t("Save tonight's sleep"),
        load: () => loadSleepState(patientId),
        submit: async (values) => {
          const hours = num(values, "hours");
          if (hours === undefined) return { error: "Enter how many hours you slept." };
          return logSleep({
            durationHours: hours,
            qualityRating: num(values, "quality"),
            daytimeSleepiness: num(values, "sleepy"),
          });
        },
        summary: (s) =>
          s.goal?.targetDurationHours
            ? { label: "Your target", value: `${s.goal.targetDurationHours} hours` }
            : s.entries[0]?.durationHours != null
              ? { label: "Last night", value: `${s.entries[0].durationHours} hours` }
              : null,
        history: (s) =>
          s.entries.map((e) => ({
            id: e.loggedOn,
            title: e.durationHours != null ? `${e.durationHours} hours` : "Logged",
            subtitle: [dayLabel(e.loggedOn), e.qualityRating != null ? `quality ${e.qualityRating}/5` : null]
              .filter(Boolean)
              .join(" · "),
          })),
        emptyHistory: t("Nothing logged yet. Tonight is a good place to start."),
      }}
    />
  );
}

export function AlcoholScreen({ patientId }: { patientId: string }) {
  const t = useT();
  return (
    <LifestyleTrackerScreen<AlcoholState>
      config={{
        title: t("Alcohol"),
        blurb: t("Keep a simple count of what you drink. No judgement, just the number."),
        fields: [
          { key: "drinks", label: t("How many drinks today?"), hint: "A number, like 2", keyboard: "numeric", required: true },
          { key: "context", label: t("Anything worth noting?"), hint: "Optional, like: with friends" },
        ],
        submitLabel: t("Save today"),
        load: () => loadAlcoholState(patientId),
        submit: async (values) => {
          const drinks = num(values, "drinks");
          if (drinks === undefined) return { error: "Enter how many drinks." };
          return logAlcohol(patientId, drinks, values.context?.trim() || undefined);
        },
        summary: (s) => ({
          label: "This week",
          value:
            s.targetDrinksPerWeek != null
              ? `${s.drinksThisWeek} of ${s.targetDrinksPerWeek}`
              : `${s.drinksThisWeek} drinks`,
        }),
        history: (s) =>
          s.entries.map((e) => ({
            id: e.loggedOn,
            title: `${e.drinks} ${e.drinks === 1 ? "drink" : "drinks"}`,
            subtitle: [dayLabel(e.loggedOn), e.context].filter(Boolean).join(" · "),
          })),
        emptyHistory: t("Nothing logged yet."),
      }}
    />
  );
}

export function SmokingScreen({ patientId }: { patientId: string }) {
  const t = useT();
  return (
    <LifestyleTrackerScreen<SmokingState>
      config={{
        title: t("Smoking"),
        blurb: t("Check in on how the day went. Cravings count too, even on a day you did not smoke."),
        fields: [
          { key: "cigarettes", label: t("How many cigarettes today?"), hint: "0 is a good answer", keyboard: "numeric", required: true },
          { key: "cravings", label: t("How strong were the cravings, 1 to 5?"), hint: "Optional", keyboard: "numeric" },
        ],
        submitLabel: t("Save today"),
        load: () => loadSmokingState(patientId),
        submit: async (values) => {
          const cigarettes = num(values, "cigarettes");
          if (cigarettes === undefined) return { error: "Enter a number, even if it is 0." };
          return logSmoking(patientId, cigarettes, num(values, "cravings"));
        },
        summary: (s) =>
          s.quitDate
            ? { label: "Quit date", value: dayLabel(s.quitDate) }
            : s.cigarettesPerDay != null
              ? { label: "Usual day", value: `${s.cigarettesPerDay} a day` }
              : null,
        history: (s) =>
          s.entries.map((e) => ({
            id: e.loggedOn,
            title: e.cigarettes != null ? `${e.cigarettes} cigarettes` : "Checked in",
            subtitle: [dayLabel(e.loggedOn), e.cravings != null ? `cravings ${e.cravings}/5` : null]
              .filter(Boolean)
              .join(" · "),
          })),
        emptyHistory: t("Nothing logged yet."),
      }}
    />
  );
}

export function ActivityScreen({ patientId }: { patientId: string }) {
  const t = useT();
  return (
    <LifestyleTrackerScreen<ActivityState>
      config={{
        title: t("Movement"),
        blurb: t("Anything counts: a walk, housework, football. Write what you did and for how long."),
        fields: [
          { key: "name", label: t("What did you do?"), hint: "Like: walked to the market", required: true },
          { key: "minutes", label: t("For how many minutes?"), hint: "A number, like 30", keyboard: "numeric", required: true },
        ],
        submitLabel: t("Save it"),
        load: () => loadActivityState(patientId),
        submit: async (values) => {
          const minutes = num(values, "minutes");
          const name = values.name?.trim();
          if (!name) return { error: "Say what you did." };
          if (minutes === undefined) return { error: "Enter how many minutes." };
          return logActivity(patientId, { activityName: name, durationMinutes: minutes });
        },
        summary: (s) =>
          s.dailyStepGoal != null ? { label: "Daily step goal", value: `${s.dailyStepGoal}` } : null,
        history: (s) =>
          s.entries.map((e, i) => ({
            id: `${e.loggedOn}:${i}`,
            title: e.activityName ?? "Activity",
            subtitle: [
              dayLabel(e.loggedOn),
              e.durationMinutes != null ? `${e.durationMinutes} min` : null,
              e.stepCount != null ? `${e.stepCount} steps` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          })),
        emptyHistory: t("Nothing logged yet."),
      }}
    />
  );
}

const MEAL_TYPE_CHOICES: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];

interface CapturedMealPhoto {
  uri: string;
  mimeType: string;
  fileName: string;
}

function estimateSummary(estimate: MealPhotoEstimate): string {
  const parts = [`~${Math.round(estimate.est_carbs_g)}g carbs`, `~${Math.round(estimate.est_calories)} kcal`];
  return parts.join(" · ");
}

/**
 * Meals is a bespoke screen rather than a LifestyleTrackerScreen config, the
 * one tracker of the five that isn't -- the shared shell's plain text/chip
 * fields have nowhere to put a camera affordance or an AI estimate result,
 * and forcing photo capture into it would mean bending the shell into a
 * meal-specific shape purely for this one screen (see that file's own
 * comment on why it's deliberately generic across sleep/alcohol/smoking/
 * activity). Text-only logging (logMeal, a direct RLS insert) is unchanged;
 * the photo path (logMealWithPhoto) is new -- see that function's own
 * comment in lib/lifestyle-trackers.ts for why it's a governed server call
 * rather than a client-side AI call.
 */
export function MealsScreen({ patientId }: { patientId: string }) {
  const t = useT();
  const [state, setState] = useState<MealsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mealType, setMealType] = useState<MealType | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<CapturedMealPhoto | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [lastEstimate, setLastEstimate] = useState<MealPhotoEstimate | null>(null);

  const load = useCallback(async () => {
    const result = await loadMealsState(patientId);
    if (result.ok) {
      setState(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
    setLoading(false);
    setRefreshing(false);
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Permission/validation copy stays plain English on purpose, matching every
  // other tracker's own submit-error strings and labs-screen.tsx's identical
  // camera-permission messages -- this dictionary carries wayfinding chrome
  // only (see ui-language.ts's own boundary comment), not ad-hoc errors.
  async function takePhoto() {
    setSaveError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setSaveError("Camera access is off. Enable it in your phone's Settings to photograph a meal.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPhoto({
      uri: asset.uri,
      mimeType: asset.mimeType ?? "image/jpeg",
      fileName: asset.fileName ?? `meal-${Date.now()}.jpg`,
    });
  }

  async function chooseFromLibrary() {
    setSaveError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setSaveError("Photo access is off. Enable it in your phone's Settings to choose a photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPhoto({
      uri: asset.uri,
      mimeType: asset.mimeType ?? "image/jpeg",
      fileName: asset.fileName ?? `meal-${Date.now()}.jpg`,
    });
  }

  async function onSubmit() {
    setSaveError(null);
    setSavedMessage(null);
    setLastEstimate(null);
    if (!mealType) {
      setSaveError("Pick which meal it was.");
      return;
    }
    setSaving(true);
    if (photo) {
      const result = await logMealWithPhoto({ mealType, description: description.trim(), photo });
      setSaving(false);
      if (result.error) {
        setSaveError(result.error);
        return;
      }
      setPhoto(null);
      setDescription("");
      setMealType(undefined);
      setSavedMessage(t("Saved."));
      if (result.aiStatus === "estimated" && result.aiEstimate) {
        setLastEstimate(result.aiEstimate);
      }
      await load();
      return;
    }

    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setSaving(false);
      setSaveError("Write what you ate.");
      return;
    }
    const result = await logMeal(patientId, { mealType, description: trimmedDescription });
    setSaving(false);
    if (result.error) {
      setSaveError(result.error);
      return;
    }
    setDescription("");
    setMealType(undefined);
    setSavedMessage(t("Saved."));
    await load();
  }

  const entries = state?.entries ?? [];

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
        <ScreenTitle>{t("Meals")}</ScreenTitle>
        <MutedText>
          {t(
            "Write down what you ate, or take a photo for an AI estimate of the carbs and calories. Over time it helps you and your care team see what is working."
          )}
        </MutedText>
      </View>

      {loadError ? <ErrorText>{loadError}</ErrorText> : null}

      <Card style={{ gap: 12 }}>
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: typeScale.body, fontWeight: "600", color: colors.ink }}>
            {t("Which meal?")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {MEAL_TYPE_CHOICES.map((choice) => {
              const selected = mealType === choice.value;
              return (
                <PrimaryButtonChip
                  key={choice.value}
                  label={choice.label}
                  selected={selected}
                  onPress={() => setMealType(choice.value)}
                />
              );
            })}
          </View>
        </View>

        {photo ? (
          <View style={{ gap: 8 }}>
            <Image
              source={{ uri: photo.uri }}
              style={{ width: "100%", height: 180, borderRadius: radius.control, backgroundColor: colors.border }}
              resizeMode="cover"
            />
            {/* "Remove photo" / "Take a photo" / "Choose from library" stay
                plain English, matching labs-screen.tsx's identical camera
                affordance -- neither that screen nor this one's photo path
                is part of the wayfinding-only pidgin dictionary. */}
            <SecondaryButton title="Remove photo" onPress={() => setPhoto(null)} disabled={saving} />
          </View>
        ) : null}

        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: typeScale.body, fontWeight: "600", color: colors.ink }}>
            {t("What did you eat?")}
          </Text>
          <TextInput
            accessibilityLabel={t("What did you eat?")}
            value={description}
            onChangeText={setDescription}
            placeholder="Like: jollof rice and chicken"
            placeholderTextColor={colors.faint}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.control,
              paddingHorizontal: 12,
              paddingVertical: 12,
              fontSize: typeScale.body,
              color: colors.ink,
              backgroundColor: colors.card,
            }}
          />
        </View>

        {!photo ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <SecondaryButton title="Take a photo" onPress={() => void takePhoto()} disabled={saving} />
            </View>
            <View style={{ flex: 1 }}>
              <SecondaryButton title="Choose from library" onPress={() => void chooseFromLibrary()} disabled={saving} />
            </View>
          </View>
        ) : null}

        <PrimaryButton title={t("Save this meal")} onPress={() => void onSubmit()} loading={saving} />
        {saveError ? <ErrorText>{saveError}</ErrorText> : null}
        {savedMessage ? <MutedText>{savedMessage}</MutedText> : null}
        {lastEstimate ? (
          // The AI estimate card, like the camera affordance above, is left
          // in plain English -- it's the one genuinely new surface this
          // change adds, and ui-language.ts's dictionary is deliberately
          // scoped to existing wayfinding chrome, not every new feature.
          <Card style={{ gap: 4, backgroundColor: colors.groupBg }}>
            <Badge tone="brand">AI estimate</Badge>
            <Text style={{ fontSize: typeScale.body, fontWeight: "600", color: colors.ink }}>
              {estimateSummary(lastEstimate)}
            </Text>
            {lastEstimate.items.length > 0 ? (
              <MutedText>
                {lastEstimate.items.map((item) => `${item.name} (${item.portion})`).join(", ")}
              </MutedText>
            ) : null}
            {lastEstimate.confidence === "low" ? (
              <MutedText>Low confidence — check this against what you actually ate.</MutedText>
            ) : null}
          </Card>
        ) : null}
      </Card>

      <View style={{ gap: 10 }}>
        <SectionLabel>{t("Last 30 days")}</SectionLabel>
        {loading ? null : entries.length === 0 ? (
          <MutedText>{t("Nothing logged yet. Your next meal is a fine place to start.")}</MutedText>
        ) : (
          <GroupedList>
            {entries.map((e) => (
              <GroupedListRow
                key={e.id}
                title={e.description ?? "Meal"}
                subtitle={`${e.mealType[0]!.toUpperCase()}${e.mealType.slice(1)} · ${dayLabel(e.loggedAt.slice(0, 10))}`}
                trailing={
                  e.aiStatus === "estimated" && e.aiEstimate ? (
                    <Badge tone="brand">{`~${Math.round(e.aiEstimate.est_carbs_g)}g carbs`}</Badge>
                  ) : (
                    "none"
                  )
                }
              />
            ))}
          </GroupedList>
        )}
      </View>
    </ScrollView>
  );
}

/** Meal-type chip with a selected/unselected state, matching the shared
 * LifestyleTrackerScreen shell's own `choices` chip styling exactly so this
 * one bespoke screen still looks like its siblings. */
function PrimaryButtonChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
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
        {label}
      </Text>
    </Pressable>
  );
}
