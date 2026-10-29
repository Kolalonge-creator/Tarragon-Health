import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { portionUnitLabel, type FoodCatalogueItem, type FoodPortionUnit } from "@tarragon/shared";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";
import { radius, typeScale } from "@/ui/theme";
import { useLegacyColors, useTheme } from "@/ui/design";
import { lookupBarcode, loadFoodList, loadFavourites, queueMeal, removeFavourite, saveFavourite, touchFavourite, type Favourite } from "@/lib/food-diary";
import {
  defaultUnit,
  foodPhrase,
  mealTypeForLagosHour,
  recentDistinctMeals,
  searchFoods,
  type DiaryEntryLike,
  type Guidance,
  type MealType,
} from "@/lib/food-diary-model";
import { AppText } from "@/ui/kit/AppText";

/**
 * The S49a additions to the Meals screen: daily targets, pick-from-list, barcode number, and one-tap repeat with favourites.
 * Logic lives in lib/food-diary(-model).ts; this file is layout only. All copy is plain English (see tracker-screens.tsx on why).
 */

const TOUCH = 44;

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useLegacyColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      style={{ minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.control, backgroundColor: selected ? colors.brand : colors.groupBg }}
    >
      <Text style={{ fontSize: typeScale.body, fontWeight: "600", color: selected ? "#FFFFFF" : colors.ink }}>{label}</Text>
    </Pressable>
  );
}

/** Daily targets with today's progress. Renders NOTHING when the server says targets are not for this person. */
export function TargetsCard({ guidance }: { guidance: Guidance }) {
  const colors = useLegacyColors();
  if (guidance.state === "hidden") return null;
  if (guidance.state === "needs_profile") {
    return (
      <Card style={{ gap: 6 }}>
        <SectionLabel>Daily targets</SectionLabel>
        <MutedText>Add your date of birth, sex, height and weight to your profile to see daily targets.</MutedText>
      </Card>
    );
  }
  const { targets, totals } = guidance;
  const rows: { label: string; done: number; target: number; unit: string; limit: boolean }[] = [
    { label: "Energy", done: totals.caloriesKcal, target: targets.energyKcal, unit: "kcal", limit: false },
    { label: "Carbohydrate", done: totals.carbsG, target: targets.carbsG, unit: "g", limit: false },
    { label: "Protein", done: totals.proteinG, target: targets.proteinG, unit: "g", limit: false },
    { label: "Fat", done: totals.fatG, target: targets.fatG, unit: "g", limit: false },
    { label: "Fibre", done: totals.fibreG, target: targets.fibreG, unit: "g", limit: false },
    { label: "Salt", done: Math.round(((totals.sodiumMg * 2.5) / 1000) * 10) / 10, target: targets.saltGMax, unit: "g", limit: true },
    { label: "Sugar", done: totals.sugarG, target: targets.sugarGMax, unit: "g", limit: true },
  ];
  return (
    <Card style={{ gap: 8 }}>
      <SectionLabel>Today against your daily targets</SectionLabel>
      {rows.map((r) => {
        const over = r.done > r.target;
        const pct = r.target > 0 ? Math.min(100, Math.round((r.done / r.target) * 100)) : 0;
        return (
          <View key={r.label} style={{ gap: 4 }} accessible accessibilityLabel={`${r.label}: ${Math.round(r.done)} of ${Math.round(r.target * 10) / 10} ${r.unit}${r.limit ? ", keep under" : ""}${over ? ", over" : ""}`}>
            <AppText variant="body">
              {`${r.label}: ${Math.round(r.done)} of ${Math.round(r.target * 10) / 10} ${r.unit}${r.limit ? " (keep under)" : ""}${over ? (r.limit ? " - over the limit" : " - over the target") : ""}`}
            </AppText>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border }}>
              <View style={{ height: 6, borderRadius: 3, width: `${pct}%`, backgroundColor: colors.brand }} />
            </View>
          </View>
        );
      })}
      {totals.uncountedMeals > 0 ? <MutedText>Some meals today were not matched to our food list, so these totals may be lower than the real total.</MutedText> : null}
      <MutedText>
        These are rough daily guides for staying where you are, not a diet and not medical advice. If you take medicines or have a condition, follow your care team.
        {guidance.floorApplied ? " Your energy guide is held at a safe minimum." : ""}
      </MutedText>
    </Card>
  );
}

/** Search the food list on the phone (works offline once it has been downloaded), pick a measure, add it to the meal. */
export function FoodPickerBlock({ onAdd }: { onAdd: (phrase: string) => void }) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const [foods, setFoods] = useState<FoodCatalogueItem[]>([]);
  const [source, setSource] = useState<"network" | "cache" | "none">("none");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<FoodCatalogueItem | null>(null);
  const [unit, setUnit] = useState<FoodPortionUnit>("serving");
  const [qty, setQty] = useState(1);

  useEffect(() => {
    let alive = true;
    void loadFoodList().then((r) => {
      if (!alive) return;
      setFoods(r.foods);
      setSource(r.source);
    });
    return () => {
      alive = false;
    };
  }, []);

  const matches = useMemo(() => searchFoods(foods, query), [foods, query]);
  const grams = picked ? (picked.portions.find((p) => p.unit === unit)?.grams ?? null) : null;

  if (source === "none") return null; // no list yet and no signal: typing still works

  return (
    <View style={{ gap: 8 }}>
      <AppText variant="bodyStrong">Or pick from the list</AppText>
      <TextInput
        keyboardAppearance={scheme}
        accessibilityLabel="Search foods"
        value={query}
        onChangeText={setQuery}
        placeholder="Search, for example eba or moi moi"
        placeholderTextColor={colors.subtle}
        autoCorrect={false}
        style={{ minHeight: TOUCH, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: 12, fontSize: typeScale.body, color: colors.ink, backgroundColor: colors.card }}
      />
      {matches.map((f) => (
        <Pressable
          key={f.code}
          accessibilityRole="button"
          onPress={() => {
            setPicked(f);
            setUnit(defaultUnit(f));
            setQty(1);
            setQuery("");
          }}
          style={{ minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.control, backgroundColor: colors.groupBg }}
        >
          <AppText variant="body">{`${f.name}${f.highSalt ? " (high salt)" : ""}${f.highSugar ? " (high sugar)" : ""}`}</AppText>
        </Pressable>
      ))}
      {picked ? (
        <View style={{ gap: 8 }}>
          <AppText variant="bodyStrong">{picked.name}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {picked.portions.map((p) => (
              <Chip key={p.unit} label={portionUnitLabel(p.unit, qty)} selected={unit === p.unit} onPress={() => setUnit(p.unit)} />
            ))}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <SecondaryButton title="One fewer" onPress={() => setQty((q) => Math.max(1, q - 1))} />
            <AppText variant="bodyStrong">{qty}</AppText>
            <SecondaryButton title="One more" onPress={() => setQty((q) => Math.min(20, q + 1))} />
          </View>
          {/* The size photos for each measure are not supplied yet (the slots exist); until then the size is said in words. */}
          {grams != null ? <MutedText>{`One ${portionUnitLabel(unit, 1)} is about ${Math.round(grams)} g.`}</MutedText> : null}
          <PrimaryButton
            title="Add"
            onPress={() => {
              onAdd(foodPhrase(picked, unit, qty));
              setPicked(null);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Type the number printed under a barcode. Camera scanning is not in this version of the app. */
export function BarcodeBlock({ onAdd }: { onAdd: (phrase: string) => void }) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function find() {
    setBusy(true);
    setMessage(null);
    const res = await lookupBarcode(code);
    setBusy(false);
    if ("error" in res) return setMessage(res.error);
    if (res.result.status === "invalid") return setMessage("That code does not look right. Check the numbers under the barcode.");
    if (res.result.status === "not_found") return setMessage("We do not have this product yet. Type what you ate instead.");
    if (res.result.status === "found") {
      onAdd(`1 serving of ${res.result.foodName.toLowerCase()}`);
      setMessage(`${res.result.productName}${res.result.nafdacNumber ? ` (NAFDAC ${res.result.nafdacNumber})` : ""} added.`);
      setCode("");
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <AppText variant="bodyStrong">Packaged food? Enter the barcode number</AppText>
      <TextInput
        keyboardAppearance={scheme}
        accessibilityLabel="Barcode number"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        placeholder="The number under the barcode"
        placeholderTextColor={colors.subtle}
        style={{ minHeight: TOUCH, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: 12, fontSize: typeScale.body, color: colors.ink, backgroundColor: colors.card }}
      />
      <SecondaryButton title="Look up" onPress={() => void find()} disabled={busy || code.trim().length < 8} />
      {message ? <MutedText>{message}</MutedText> : null}
    </View>
  );
}

/** Recent meals and favourites, each logged again in one tap. Works offline: the meal is queued on the phone and sent when there is signal. */
export function RepeatAndFavouritesCard({ patientId, entries, onLogged }: { patientId: string; entries: (DiaryEntryLike & { loggedAt: string })[]; onLogged: () => void }) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshFavourites() {
    const r = await loadFavourites(patientId);
    setFavourites(r.favourites);
  }
  useEffect(() => {
    void refreshFavourites();
  }, [patientId]);

  const recent = useMemo(() => recentDistinctMeals(entries, 5), [entries]);
  if (recent.length === 0 && favourites.length === 0) return null;

  async function logAgain(description: string, mealType: MealType | null, favouriteId?: string) {
    if (busy) return; // a second tap while the first is saving must not queue a second meal
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await queueMeal(patientId, { mealType: mealType ?? mealTypeForLagosHour(new Date()), description });
      setMessage("Saved on your phone. It will be added to your record when there is signal.");
      if (favouriteId) void touchFavourite(patientId, favouriteId);
      onLogged();
    } catch {
      setError("We could not save that on your phone. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <SectionLabel>Log again in one tap</SectionLabel>
      {favourites.map((f) => (
        <View key={f.id} style={{ gap: 6 }}>
          <AppText variant="bodyStrong">{f.name}</AppText>
          <MutedText>{f.description}</MutedText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Log" disabled={busy} onPress={() => void logAgain(f.description, f.mealType, f.id)} />
            </View>
            <View style={{ flex: 1 }}>
              <SecondaryButton
                title="Remove"
                onPress={() =>
                  void removeFavourite(patientId, f.id).then(async (r) => {
                    if (r.error) setError(r.error);
                    else await refreshFavourites();
                  })
                }
              />
            </View>
          </View>
        </View>
      ))}
      {recent.length > 0 ? <SectionLabel>Recent meals</SectionLabel> : null}
      {recent.map((e) => (
        <View key={e.id} style={{ gap: 6 }}>
          <AppText variant="body">{e.description}</AppText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Log again" disabled={busy} onPress={() => void logAgain(e.description ?? "", e.mealType)} />
            </View>
            <View style={{ flex: 1 }}>
              <SecondaryButton title="Save" onPress={() => { setNaming(naming === e.id ? null : e.id); setName(""); }} />
            </View>
          </View>
          {naming === e.id ? (
            <View style={{ gap: 6 }}>
              <TextInput
                keyboardAppearance={scheme}
                accessibilityLabel="Favourite name"
                value={name}
                onChangeText={setName}
                maxLength={60}
                placeholder="Name, for example My usual breakfast"
                placeholderTextColor={colors.subtle}
                style={{ minHeight: TOUCH, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: 12, fontSize: typeScale.body, color: colors.ink, backgroundColor: colors.card }}
              />
              <PrimaryButton
                title="Save favourite"
                disabled={name.trim().length === 0}
                onPress={() =>
                  void saveFavourite(patientId, { name, description: e.description ?? "", mealType: e.mealType }).then(async (r) => {
                    if (r.error) return setError(r.error);
                    setNaming(null);
                    setName("");
                    setMessage("Saved to your favourites.");
                    await refreshFavourites();
                  })
                }
              />
            </View>
          ) : null}
        </View>
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <MutedText>{message}</MutedText> : null}
    </Card>
  );
}

