import { useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { buildLifestyleEntry, INHALER_REASONS, LIFESTYLE_KINDS, type InhalerReason, type LifestyleKind } from "@/lib/lifestyle-entry";
import { readExtendedObservationsEnabled } from "@/lib/extended-observations";
import { logOtherVital } from "@/lib/vitals";
import { space } from "@/ui/design";
import { AppText, Button, Card, Chip, Field, InlineAlert, useToast } from "@/ui/kit";

/**
 * S47a (BUILD-SPEC-v5 4.2, 6.6): the quick-log entries for water, sleep, mood and inhaler use. Offline-first through the same outbox as every other
 * reading (logOtherVital), so a log made with no signal waits on the phone and is sent later, idempotent by its client id.
 *
 * Shown only while the platform module `extended_observations` is on (born off). Nothing here pages anyone: these types have no rule set. No inhaler
 * advice is shown: the wording for frequent reliever use is the CMO's to supply (OQ-S47A-2) and would need a reviewed-strings ledger entry. Colour is never the only signal: every chip and message is also words.
 */
const LABEL_KEY: Record<LifestyleKind, MessageKey> = {
  water_ml: "observation.type.water_ml",
  sleep_hours: "observation.type.sleep_hours",
  mood: "observation.type.mood",
  inhaler_use: "observation.type.inhaler_use",
};

const FIELD_LABEL: Record<LifestyleKind, string> = {
  water_ml: "ml",
  sleep_hours: "hours",
  mood: "1 to 5",
  inhaler_use: "puffs",
};

export function LifestyleLogCard({ beneficiaryProfileId, signedInUserId }: { beneficiaryProfileId?: string; signedInUserId: string }) {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [kind, setKind] = useState<LifestyleKind>("water_ml");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<InhalerReason | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [warnKey, setWarnKey] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void readExtendedObservationsEnabled(signedInUserId).then((on) => {
      if (alive) setEnabled(on);
    });
    return () => {
      alive = false;
    };
  }, [signedInUserId]);

  if (!enabled) return null;

  function pickKind(next: LifestyleKind) {
    setKind(next);
    setValue("");
    setReason(null);
    setErrorKey(null);
    setSaveError(null);
    setWarnKey(null);
  }

  async function handleSave() {
    const entry = buildLifestyleEntry(kind, value, reason);
    if (!entry.ok) {
      setSaveError(null);
      setWarnKey(null);
      setErrorKey(entry.errorKey);
      return;
    }
    setErrorKey(null);
    setSaveError(null);
    // An unusual (not impossible) number asks for a second tap and is never refused.
    if (entry.warn && warnKey !== entry.warn) {
      setWarnKey(entry.warn);
      return;
    }
    setWarnKey(null);
    setSaving(true);
    const result = await logOtherVital(entry.payload, beneficiaryProfileId);
    setSaving(false);
    if (result.error) {
      setSaveError(result.error);
      return;
    }
    toast.show(result.synced ? { message: tr("vitals.other.saved", { value, unit: FIELD_LABEL[kind] }), tone: "success" } : { message: t("outbox.saved_on_phone", locale), tone: "info" });
    setValue("");
    setReason(null);
  }

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {tr("observation.type.water_ml")}, {tr("observation.type.sleep_hours").toLowerCase()}, {tr("observation.type.mood").toLowerCase()}, {tr("observation.type.inhaler_use").toLowerCase()}
      </AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel={tr("vitals.other.group")} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {LIFESTYLE_KINDS.map((k) => (
          <Chip key={k} label={tr(LABEL_KEY[k])} selected={kind === k} onPress={() => pickKind(k)} />
        ))}
      </View>
      <Field
        label={kind === "mood" ? tr("observation.mood_label") : tr("vitals.other.value_label", { unit: FIELD_LABEL[kind] })}
        keyboardType={kind === "sleep_hours" ? "decimal-pad" : "number-pad"}
        value={value}
        onChangeText={(v) => {
          setValue(v);
          setWarnKey(null);
        }}
      />
      {kind === "mood" ? <AppText variant="caption" tone="textSubtle">{tr("observation.mood_hint")}</AppText> : null}
      {kind === "inhaler_use" ? (
        <>
          <View accessibilityRole="radiogroup" accessibilityLabel={tr("observation.inhaler.reason_group")} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {INHALER_REASONS.map((r) => (
              <Chip key={r} label={tr(`observation.inhaler.reason.${r}` as MessageKey)} selected={reason === r} onPress={() => setReason(r)} />
            ))}
          </View>
        </>
      ) : null}
      {errorKey ? <InlineAlert tone="danger" message={tr(errorKey)} /> : null}
      {saveError ? <InlineAlert tone="danger" message={saveError} /> : null}
      {warnKey ? <InlineAlert tone="warn" message={tr(warnKey)} /> : null}
      <Button title={tr("vitals.other.save")} onPress={handleSave} loading={saving} />
    </Card>
  );
}

