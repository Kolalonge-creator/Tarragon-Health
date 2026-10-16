import { useCallback, useEffect, useState } from "react";
import { Share, Text, TextInput, View } from "react-native";
import { asLocale } from "@tarragon/i18n";
import { useLegacyColors } from "@/ui/design";
import { ErrorText, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";
import { radius } from "@/ui/theme";
import { supabase } from "@/lib/supabase";
import { API_BASE_URL } from "@/lib/api";
import { useUiLanguage } from "@/lib/ui-language";
import { ta } from "@/lib/auth/auth-locale";
import {
  backupCodesRunningLow,
  backupCodesShareText,
  fetchBackupCodeStatus,
  generateBackupCodesRemote,
  type BackupCodeStatus,
} from "@/lib/auth/backup-codes";

type FetchArg = Parameters<typeof fetchBackupCodeStatus>[1];

async function currentToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Backup codes in Settings (S03b follow-up). Shows how many codes are left, and makes a new set after a confirmation step and a
 * password re-check done by the server. The codes live in this component's state only while they are on screen: they are never
 * stored, logged, or put in a URL, and leaving the "saved" step clears them.
 */
export function BackupCodesSection() {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [status, setStatus] = useState<BackupCodeStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  const refresh = useCallback(async () => {
    const out = await fetchBackupCodeStatus(await currentToken(), fetch as unknown as FetchArg, API_BASE_URL);
    if (out.kind === "ok") {
      setStatus(out.status);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function make() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const out = await generateBackupCodesRemote(
      { token: await currentToken(), password, confirmed: confirming },
      fetch as unknown as FetchArg,
      API_BASE_URL,
    );
    setBusy(false);
    // The password is never kept after the attempt, success or not.
    setPassword("");
    if (out.kind === "ok") {
      setCodes(out.codes);
      setConfirming(false);
      void refresh();
    } else {
      setError(ta(out.key, locale));
      // A lost answer can follow a made set: show the real count again.
      void refresh();
    }
  }

  function done() {
    setCodes(null);
  }

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    padding: 14,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.card,
  } as const;

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{ta("account.backup_codes.title", locale)}</SectionLabel>
      <MutedText>{ta("account.backup_codes.intro", locale)}</MutedText>
      {codes ? (
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="alert" style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>
            {ta("account.backup_codes.shown_title", locale)}
          </Text>
          <MutedText>{ta("account.backup_codes.shown_guidance", locale)}</MutedText>
          <View accessibilityLabel={ta("account.backup_codes.title", locale)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {codes.map((code) => (
              <Text
                key={code}
                selectable={false}
                style={{
                  fontFamily: "Courier",
                  fontSize: 16,
                  color: colors.ink,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.control,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                }}
              >
                {code}
              </Text>
            ))}
          </View>
          <SecondaryButton
            title={ta("account.backup_codes.share", locale)}
            onPress={() => {
              void Share.share({ message: backupCodesShareText(codes) }).catch(() => undefined);
            }}
          />
          <PrimaryButton title={ta("account.backup_codes.saved", locale)} onPress={done} />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {loadFailed && !status ? (
            <MutedText>{ta("account.backup_codes.load_failed", locale)}</MutedText>
          ) : status ? (
            <MutedText>
              {status.total === 0
                ? ta("account.backup_codes.none", locale)
                : ta("account.backup_codes.count", locale, { remaining: status.remaining, total: status.total })}
              {backupCodesRunningLow(status) ? ` ${ta("account.backup_codes.low", locale)}` : ""}
            </MutedText>
          ) : null}
          {confirming ? (
            <View style={{ gap: 10 }}>
              <MutedText>
                {status && status.total > 0
                  ? ta("account.backup_codes.confirm_replace", locale)
                  : ta("account.backup_codes.confirm_first", locale)}
              </MutedText>
              <TextInput
                accessibilityLabel={ta("account.backup_codes.password_label", locale)}
                placeholder={ta("account.backup_codes.password_label", locale)}
                placeholderTextColor={colors.subtle}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                value={password}
                onChangeText={setPassword}
                style={inputStyle}
              />
              {error ? <ErrorText>{error}</ErrorText> : null}
              <PrimaryButton
                title={busy ? ta("account.backup_codes.making", locale) : ta("account.backup_codes.submit", locale)}
                onPress={() => void make()}
                loading={busy}
              />
              <SecondaryButton
                title={ta("account.backup_codes.cancel", locale)}
                onPress={() => {
                  setConfirming(false);
                  setPassword("");
                  setError(null);
                }}
              />
            </View>
          ) : (
            <SecondaryButton
              title={status && status.total > 0 ? ta("account.backup_codes.remake", locale) : ta("account.backup_codes.make", locale)}
              onPress={() => setConfirming(true)}
            />
          )}
        </View>
      )}
    </View>
  );
}
