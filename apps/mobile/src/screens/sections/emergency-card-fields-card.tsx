import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { EMERGENCY_CARD_FIELDS, EMERGENCY_DEFAULT_CHOICES, EMERGENCY_MINIMAL_CHOICES, type EmergencyCardChoices } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { loadCardChoices, saveCardChoices } from "@/lib/emergency-card-choices";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, Card, InlineAlert } from "@/ui/kit";
import { ToggleRow } from "@/screens/sections/passport-parts";

interface Props {
  patientId: string;
  organisationId: string;
  /** Called after a save, so the card on this screen (and its saved copy) is rebuilt from the new choices. */
  onSaved: () => void;
}

/**
 * The person decides what a stranger can see on their emergency card (S43 spec 2.7). Starts from what the card shows today, "use the minimum" is
 * one tap, and the lock screen is its own switch, off unless chosen, beside the shared-phone warning. Changing it needs a connection and says so;
 * the card itself keeps working offline.
 */
export function EmergencyCardFieldsCard({ patientId, organisationId, onSaved }: Props) {
  const { colors } = useTheme();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "failed"; offline: boolean } | { kind: "ready" }>({ kind: "loading" });
  const [choices, setChoices] = useState<EmergencyCardChoices>(EMERGENCY_DEFAULT_CHOICES);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const r = await loadCardChoices(patientId);
    if (!r.ok) {
      setState({ kind: "failed", offline: r.reason === "offline" });
      return;
    }
    setChoices(r.choices);
    setState({ kind: "ready" });
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any change after a save clears "Saved.": the screen must never say saved while what is shown differs from what was stored.
  const change = (fn: (c: EmergencyCardChoices) => EmergencyCardChoices) => {
    setMessage(null);
    setChoices(fn);
  };

  async function save() {
    setMessage(null);
    setBusy(true);
    const r = await saveCardChoices(patientId, organisationId, choices);
    setBusy(false);
    if (!r.ok) {
      setMessage({ tone: "danger", text: r.reason === "offline" ? t("mpass.needs_connection") : t("ecf.error") });
      return;
    }
    setMessage({ tone: "info", text: t("ecf.saved") });
    onSaved();
  }

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {t("ecf.title")}
      </AppText>
      <AppText tone="textMuted">{t("ecf.description")}</AppText>
      {state.kind === "loading" ? <ActivityIndicator color={colors.brand} accessibilityLabel={t("mpass.loading")} /> : null}
      {state.kind === "failed" ? (
        <View style={{ gap: space.md }}>
          <InlineAlert tone={state.offline ? "info" : "danger"} message={state.offline ? t("mpass.needs_connection") : t("mpass.load_failed")} />
          <Button title={t("common.try_again")} variant="secondary" onPress={() => void load()} />
        </View>
      ) : null}
      {state.kind === "ready" ? (
        <>
          {EMERGENCY_CARD_FIELDS.map((f) => (
            <ToggleRow key={f} label={t(`ecf.field.${f}` as MessageKey)} value={choices[f]} onChange={(v) => change((c) => ({ ...c, [f]: v }))} />
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <Button title={t("ecf.preset_minimal")} variant="secondary" fullWidth={false} onPress={() => change((c) => ({ ...EMERGENCY_MINIMAL_CHOICES, lock_screen_opt_in: c.lock_screen_opt_in }))} />
            <Button title={t("mpass.ecf.preset_standard")} variant="secondary" fullWidth={false} onPress={() => change((c) => ({ ...EMERGENCY_DEFAULT_CHOICES, lock_screen_opt_in: c.lock_screen_opt_in }))} />
          </View>
          <InlineAlert tone="warn" message={t("ecf.lock_screen_help")} />
          <ToggleRow label={t("ecf.lock_screen")} value={choices.lock_screen_opt_in} onChange={(v) => change((c) => ({ ...c, lock_screen_opt_in: v }))} />
          {message ? <InlineAlert tone={message.tone} message={message.text} /> : null}
          <Button title={t("ecf.save")} loading={busy} onPress={() => void save()} />
        </>
      ) : null}
    </Card>
  );
}
