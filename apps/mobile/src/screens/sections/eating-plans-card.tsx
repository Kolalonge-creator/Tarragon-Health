import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { REASON_KIND_LABEL, type EatingGuidance, type EatingPlan, type FoodCatalogueItem, type FoodSwap, type SwapReasonKind } from "@tarragon/shared";
import { Card, MutedText, SectionLabel } from "@/ui/legacy-kit";
import { typeScale } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { isOwnAccount, loadEatingPlans, loadNutritionReferral, type ReferralStatus } from "@/lib/eating-plans";
import { recordSyncError } from "@/lib/sync-diagnostics";
import { referralStatusLabel, referralStatusText } from "@/lib/eating-plans-model";
import { loadFoodList } from "@/lib/food-diary";
import { AppText } from "@/ui/kit/AppText";

/**
 * Eating plans, food swaps and the dietitian request status (S50a, read only). Renders NOTHING when the server says the plans are not for this
 * person or not signed yet (it never says which), so the absence tells nobody anything. Plans are words only; a swap is an idea with a reason,
 * never a verdict on a food. Booking a dietitian visit and requesting nutrition support are done on the web app or through the care team.
 */
const TOUCH = 44;
const KIND_ORDER: SwapReasonKind[] = ["less_salt", "less_refined_carbohydrate", "more_fibre", "less_sugar", "lighter_cooking"];

function foodName(code: string, foods: readonly FoodCatalogueItem[]): string {
  return (foods.find((f) => f.code === code)?.name ?? code.replace(/_/g, " ")).toLowerCase();
}

export function swapSentence(swap: FoodSwap, foods: readonly FoodCatalogueItem[]): string {
  return `You could try ${swap.toFoodCodes.map((c) => foodName(c, foods)).join(" or ")} instead of ${foodName(swap.fromFoodCode, foods)}. ${swap.reason}`;
}

function PlanBlock({ plan }: { plan: EatingPlan }) {
  const colors = useLegacyColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${plan.title}, ${open ? "hide" : "show"}`}
        onPress={() => setOpen((v) => !v)}
        style={{ minHeight: TOUCH, justifyContent: "center" }}
      >
        <AppText variant="bodyStrong">{`${plan.title} (${open ? "hide" : "show"})`}</AppText>
      </Pressable>
      {open ? (
        <View style={{ gap: 6 }}>
          <MutedText>{plan.intro}</MutedText>
          {plan.tips.map((t) => (
            <Text key={t.heading} style={{ fontSize: typeScale.body, color: colors.ink }}>{`${t.heading}. ${t.body}`}</Text>
          ))}
          <MutedText>{plan.careTeamPrompt}</MutedText>
        </View>
      ) : null}
    </View>
  );
}

export function EatingPlansCard({ patientId }: { patientId: string }) {
  const [guidance, setGuidance] = useState<EatingGuidance>({ state: "unavailable" });
  const [fromCache, setFromCache] = useState(false);
  const [foods, setFoods] = useState<FoodCatalogueItem[]>([]);
  const [referral, setReferral] = useState<ReferralStatus | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        // The plans answer only for the signed-in person. On a supported person's screen (acting for someone) nothing is drawn: it would be the
        // caregiver's own plan under someone else's name, and the gate withholds from the supported person, not from the caregiver.
        if (!(await isOwnAccount(patientId))) return;
        // each loader is guarded on its own, so one failure cannot hide the others
        const [plans, list, ref] = await Promise.all([
          loadEatingPlans().catch((e: unknown) => {
            recordSyncError("food_diary", "eatingPlans", e);
            return null;
          }),
          loadFoodList().catch(() => ({ foods: [] as FoodCatalogueItem[], source: "none" as const })),
          loadNutritionReferral(patientId).catch((e: unknown) => {
            recordSyncError("food_diary", "eatingReferral", e);
            return null;
          }),
        ]);
        if (!alive) return;
        if (plans) {
          setGuidance(plans.guidance);
          setFromCache(plans.fromCache);
        }
        setFoods(list.foods);
        setReferral(ref);
      } catch (e) {
        recordSyncError("food_diary", "eatingPlansCard", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [patientId]);

  const referralText = referral ? referralStatusText(referral.status) : null;
  if (guidance.state !== "ok" && !referralText) return null;

  const kinds = guidance.state === "ok" ? KIND_ORDER.filter((k) => guidance.swaps.some((s) => s.reasonKind === k)) : [];
  return (
    <>
      {guidance.state === "ok" ? (
        <Card style={{ gap: 12 }}>
          <SectionLabel>Eating plans and swaps</SectionLabel>
          {fromCache ? <MutedText>You are offline, so this is the copy saved on your phone.</MutedText> : null}
          {guidance.plans.map((p) => (
            <PlanBlock key={p.code} plan={p} />
          ))}
          {kinds.length > 0 ? <AppText variant="bodyStrong">Ideas for swaps</AppText> : null}
          {kinds.map((kind) => (
            <View key={kind} style={{ gap: 4 }}>
              <AppText variant="bodyStrong">{REASON_KIND_LABEL[kind]}</AppText>
              {guidance.swaps
                .filter((s) => s.reasonKind === kind)
                .map((s) => (
                  <MutedText key={s.code}>{swapSentence(s, foods)}</MutedText>
                ))}
            </View>
          ))}
        </Card>
      ) : null}
      {referral && referralText ? (
        <Card style={{ gap: 6 }}>
          <SectionLabel>{`Nutrition support: ${referralStatusLabel(referral.status)}`}</SectionLabel>
          <MutedText>{referralText}</MutedText>
        </Card>
      ) : null}
    </>
  );
}
