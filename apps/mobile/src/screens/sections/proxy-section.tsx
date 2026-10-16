import { useCallback, useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { normalisePhoneWithCountry } from "@tarragon/auth/phone";
import { t } from "@tarragon/i18n";
import { endProxyAccess, loadProxyArrangements, startProxySetup, type ProxyArrangement } from "@/lib/proxy";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "");

/**
 * "Set up for my parent" (v5 1.19) from the phone. The parent gets a code on their own phone and decides what you see; you
 * see nothing of them until they do (safety case 23). The number is entered as a Nigerian number by default.
 */
export function ProxySetupCard() {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentHours, setSentHours] = useState<number | null>(null);

  async function submit() {
    setError(null);
    setSentHours(null);
    const normalised = normalisePhoneWithCountry("+234", phone);
    if (!name.trim() || !normalised.ok) {
      setError(t("proxy.setup.error.invalid"));
      return;
    }
    setBusy(true);
    const result = await startProxySetup(name.trim(), normalised.e164);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSentHours(result.data.hours);
    setName("");
    setPhone("");
  }

  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("proxy.setup.title")}</Text>
      <MutedText>{t("proxy.setup.intro")}</MutedText>
      <TextInput
        keyboardAppearance={scheme}
        placeholderTextColor={placeholderColorFor(scheme)}
        value={name}
        onChangeText={setName}
        placeholder={t("proxy.setup.name_label")}
        style={textInputStyle}
        accessibilityLabel={t("proxy.setup.name_label")}
      />
      <TextInput
        keyboardAppearance={scheme}
        placeholderTextColor={placeholderColorFor(scheme)}
        value={phone}
        onChangeText={setPhone}
        placeholder={t("proxy.setup.phone_label")}
        keyboardType="phone-pad"
        style={textInputStyle}
        accessibilityLabel={t("proxy.setup.phone_label")}
      />
      {error && <ErrorText>{error}</ErrorText>}
      {sentHours !== null && <MutedText>{t("proxy.setup.sent", "en", { hours: sentHours })}</MutedText>}
      <PrimaryButton title={t("proxy.setup.submit")} onPress={() => void submit()} loading={busy} />
    </Card>
  );
}

/** Who set up access to this account, always visible, with an instant way to end it (OQ-48). Nothing when there is none. */
export function ProxyArrangementsCard() {
  const colors = useLegacyColors();
  const [items, setItems] = useState<ProxyArrangement[]>([]);
  const [armed, setArmed] = useState<string | null>(null);
  const [ended, setEnded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setItems(await loadProxyArrangements()), []);
  useEffect(() => {
    void load();
  }, [load]);

  if (items.length === 0 && ended.length === 0) return null;
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("proxy.arrangement.title")}</Text>
      <MutedText>{t("proxy.arrangement.note")}</MutedText>
      {items.map((a) => (
        <View key={a.grantId} style={{ gap: 6 }}>
          <Text style={{ fontSize: 13.5, color: colors.ink }}>
            {ended.includes(a.grantId) ? t("proxy.arrangement.ended") : t("proxy.arrangement.line", "en", { name: a.setUpBy, date: when(a.since) })}
          </Text>
          {!ended.includes(a.grantId) &&
            (armed === a.grantId ? (
              <SecondaryButton
                title={t("proxy.arrangement.end_confirm")}
                disabled={busy}
                onPress={() => {
                  setBusy(true);
                  setError(null);
                  void endProxyAccess(a.grantId).then((r) => {
                    setBusy(false);
                    setArmed(null);
                    if (r.ok) setEnded((e) => [...e, a.grantId]);
                    else setError(r.error);
                  });
                }}
              />
            ) : (
              <SecondaryButton title={t("proxy.arrangement.end")} disabled={busy} onPress={() => setArmed(a.grantId)} />
            ))}
        </View>
      ))}
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}
