import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { ta } from "@/lib/auth/auth-locale";
import { DEFAULT_LOCALE } from "@tarragon/i18n";
import { planDemographicsUpdate, SEX_OPTIONS, type DemographicsReason } from "@/lib/demographics";
import { colors, radius, spacing } from "@/ui/theme";
import { ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  padding: 14,
  fontSize: 16,
  color: colors.ink,
  backgroundColor: colors.card,
} as const;

const REASON_TEXT: Record<DemographicsReason, string> = {
  sex_required: "Choose female or male.",
  dob_invalid: "",
  dob_underage: "",
};

/**
 * "One more step" before the app opens, for a patient whose sex or date of birth is not on file. The health checks that are right for a
 * person, and the ranges that apply to them, depend on both, so the app will not open without them. It only ever fills in what is
 * missing: a value already on file is left alone (changing it goes through the care team).
 */
export function ProfileDetailsScreen({
  userId,
  current,
  onDone,
  onSignOut,
}: {
  userId: string;
  current: { sex: string | null; dateOfBirth: string | null };
  onDone: (saved: { sex: string | null; dateOfBirth: string | null }) => void;
  /** This screen stops the app opening, so it must never trap anyone: they can always sign out. */
  onSignOut: () => void;
}) {
  const locale = DEFAULT_LOCALE;
  const [sex, setSex] = useState<string | null>(current.sex);
  const [dateOfBirth, setDateOfBirth] = useState(current.dateOfBirth ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    const plan = planDemographicsUpdate(current, { sex, dateOfBirth });
    if (!plan.ok) {
      setError(
        plan.reason === "dob_underage" ? ta("auth.error.adult_only", locale)
        : plan.reason === "dob_invalid" ? ta("auth.error.invalid_dob", locale)
        : REASON_TEXT[plan.reason],
      );
      return;
    }
    setSaving(true);
    let query = supabase.from("profiles").update(plan.patch).eq("id", userId);
    // Fill in only what is still empty: if another device saved it first, this writes nothing instead of overwriting.
    for (const column of plan.onlyIfNull) query = query.is(column, null);
    const { data, error: updateError } = await query.select("sex, date_of_birth");
    setSaving(false);
    if (updateError || !data || data.length === 0) {
      setError("We could not save that just now. Check your connection and try again.");
      return;
    }
    onDone({ sex: data[0].sex ?? sex, dateOfBirth: data[0].date_of_birth ?? current.dateOfBirth });
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: spacing.screen }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>One more step</Text>
        <MutedText>
          We use your sex and date of birth to work out which health checks are right for you and which ranges apply to you. We cannot open
          your health record without them. If you need to change them later, your care team can do that.
        </MutedText>
      </View>

      {!current.sex && (
        <View style={{ gap: 8 }} accessibilityRole="radiogroup">
          <Text style={{ fontWeight: "600", color: colors.ink }}>Sex</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {SEX_OPTIONS.map((o) => {
              const selected = sex === o.value;
              return (
                <Pressable
                  key={o.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={o.label}
                  onPress={() => setSex(o.value)}
                  style={{
                    flex: 1,
                    alignItems: "center",
                    paddingVertical: 14,
                    borderRadius: radius.control,
                    borderWidth: 1,
                    borderColor: selected ? colors.brand : colors.border,
                    backgroundColor: selected ? colors.brand : "transparent",
                  }}
                >
                  <Text style={{ fontWeight: "600", color: selected ? "#FFFFFF" : colors.ink }}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {!current.dateOfBirth && (
        <View style={{ gap: 6 }}>
          <TextInput
            accessibilityLabel={ta("auth.field.dob", locale)}
            placeholder={ta("auth.field.dob", locale)}
            placeholderTextColor={colors.subtle}
            keyboardType="numbers-and-punctuation"
            autoComplete="birthdate-full"
            maxLength={10}
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            style={inputStyle}
          />
          <MutedText>{ta("auth.field.dob_hint", locale)}</MutedText>
        </View>
      )}

      {error ? <ErrorText>{error}</ErrorText> : null}
      <PrimaryButton title="Continue" onPress={() => void save()} loading={saving} />

      {/* A gate that stops the app opening must not stand between a person and help. Wording for the CMO to confirm. */}
      <MutedText>If this is an emergency, call 112 or go to the nearest hospital now.</MutedText>
      <SecondaryButton title="Sign out" onPress={onSignOut} />
    </ScrollView>
  );
}
