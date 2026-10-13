import { useCallback, useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { createClient } from "@supabase/supabase-js";
import { COUNTRY_CALLING_CODES, Constants } from "@tarragon/shared";
import { normalisePhoneWithCountry } from "@tarragon/auth/phone";
import { t, type MessageKey } from "@tarragon/i18n";
import { supabase } from "@/lib/supabase";
import {
  answerProxySetup,
  loadPendingProxySetups,
  startProxySetup,
  type CodeSender,
  type PendingProxySetup,
  type RpcCall,
} from "@/lib/proxy-setup";
import { useLegacyColors, useTextInputStyle, useTheme, placeholderColorFor } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

const CATEGORIES = Constants.public.Enums.care_access_category;

const rpc: RpcCall = (fn, args) => (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => PromiseLike<never>)(fn, args);

/**
 * The code goes to the PARENT's phone through a stateless client that never reads or writes this phone's own session,
 * and never creates an account (shouldCreateUser false, OQ-52).
 */
const sendCode: CodeSender = (phone) => {
  const sender = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return sender.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
};

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const colors = useLegacyColors();
  return (
    <Text
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={{
        fontSize: 13,
        fontWeight: "600",
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 999,
        backgroundColor: on ? colors.brand : colors.groupBg,
        color: on ? "#FFFFFF" : colors.ink,
      }}
    >
      {label}
    </Text>
  );
}

/** What the parent sees on their own phone. Every box starts unticked: the default is to share nothing. */
function PendingRequest({ setup, onDone }: { setup: PendingProxySetup; onDone: () => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const name = setup.requester_first_name || "Someone";

  async function answer(accept: boolean) {
    setBusy(true);
    setError(false);
    const ok = await answerProxySetup(rpc, { setupId: setup.id, categories: chosen, accept });
    setBusy(false);
    if (!ok) {
      setError(true);
      return;
    }
    onDone();
  }

  return (
    <Card>
      <Text style={{ fontSize: 16, fontWeight: "700" }}>{t("proxy.confirm.title", "en", { name })}</Text>
      <MutedText>{t("proxy.confirm.body", "en", { name })}</MutedText>
      <Text style={{ fontSize: 13, fontWeight: "600" }}>{t("proxy.confirm.categories_label", "en", { name })}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {CATEGORIES.map((category) => (
          <Toggle
            key={category}
            label={t(`care_category.${category}` as MessageKey, "en")}
            on={chosen.includes(category)}
            onPress={() => setChosen((c) => (c.includes(category) ? c.filter((x) => x !== category) : [...c, category]))}
          />
        ))}
      </View>
      <MutedText>{t("proxy.confirm.none_note", "en", { name })}</MutedText>
      {error ? <ErrorText>{t("proxy.confirm.error", "en")}</ErrorText> : null}
      <PrimaryButton title={t("proxy.confirm.confirm", "en")} onPress={() => answer(true)} loading={busy} />
      <SecondaryButton title={t("proxy.confirm.decline", "en")} onPress={() => answer(false)} disabled={busy} />
    </Card>
  );
}

export function ProxySetupSection() {
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [pending, setPending] = useState<PendingProxySetup[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState<string>(COUNTRY_CALLING_CODES[0].dialCode);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [sentHours, setSentHours] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const list = await loadPendingProxySetups(rpc);
    setLoadFailed(list === null);
    setPending(list ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit() {
    setError(null);
    const normalised = normalisePhoneWithCountry(code, phone);
    if (!normalised.ok) {
      setError("proxy.setup.error.invalid");
      return;
    }
    setBusy(true);
    const outcome = await startProxySetup({ rpc, sendCode }, { fullName: name, phone: normalised.e164 });
    setBusy(false);
    if (outcome.kind === "error") {
      setError(outcome.key);
      return;
    }
    setSentHours(outcome.hours);
  }

  return (
    <View style={{ gap: 12 }}>
      {pending.map((setup) => (
        <PendingRequest key={setup.id} setup={setup} onDone={() => void refresh()} />
      ))}
      {loadFailed ? <MutedText>We could not check for requests just now.</MutedText> : null}
      <Card>
        <Text style={{ fontSize: 16, fontWeight: "700" }}>{t("proxy.setup.title", "en")}</Text>
        <MutedText>{t("proxy.setup.intro", "en")}</MutedText>
        {sentHours !== null ? (
          <Text accessibilityRole="alert">{t("proxy.setup.sent", "en", { hours: String(sentHours) })}</Text>
        ) : (
          <>
            <Text style={{ fontSize: 12.5, fontWeight: "600" }}>{t("proxy.setup.name_label", "en")}</Text>
            <TextInput
              keyboardAppearance={scheme}
              placeholderTextColor={placeholderColorFor(scheme)}
              value={name}
              onChangeText={setName}
              maxLength={200}
              style={textInputStyle}
            />
            <Text style={{ fontSize: 12.5, fontWeight: "600" }}>{t("proxy.setup.phone_label", "en")}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                keyboardAppearance={scheme}
                value={code}
                onChangeText={setCode}
                keyboardType="phone-pad"
                maxLength={5}
                style={[textInputStyle, { width: 76 }]}
              />
              <TextInput
                keyboardAppearance={scheme}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="off"
                style={[textInputStyle, { flex: 1 }]}
              />
            </View>
            {error ? <ErrorText>{t(error, "en")}</ErrorText> : null}
            <PrimaryButton title={t("proxy.setup.submit", "en")} onPress={submit} loading={busy} />
          </>
        )}
      </Card>
    </View>
  );
}
