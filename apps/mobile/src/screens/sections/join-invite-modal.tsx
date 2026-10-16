import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { acceptInvite, previewInvite } from "@/lib/care-circle/api";
import { clearPendingJoinToken, usePendingJoinToken } from "@/lib/care-circle/join-link";
import { permissionKey, type InvitePreview } from "@/lib/care-circle/parse";
import { useLegacyColors } from "@/ui/design";
import { ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

/**
 * S29e: a Care Circle invite opened from a link (the app scheme or the shared web link). It asks the database whether THIS signed-in
 * account may accept, shows exactly what is shared, and accepts only on the button. Every failure is the same message, as on the web.
 */
export function JoinInviteModal({ onJoined }: { onJoined?: () => void }) {
  const token = usePendingJoinToken();
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [preview, setPreview] = useState<InvitePreview | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    setPreview(undefined);
    setJoined(false);
    setFailed(false);
    setUnreachable(false);
    if (!token) return;
    let alive = true;
    void previewInvite(token).then((p) => {
      if (!alive) return;
      if (p === "unreachable") setUnreachable(true);
      else setPreview(p);
    });
    return () => {
      alive = false;
    };
  }, [token, tries]);

  if (!token) return null;
  const close = () => clearPendingJoinToken();

  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 20, paddingTop: 60, gap: 14 }}>
        <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>{t("circle.join.title", locale)}</Text>
        {unreachable ? (
          <View style={{ gap: 12 }}>
            <ErrorText>{t("circle.join.network", locale)}</ErrorText>
            <PrimaryButton title={t("circle.join.retry", locale)} onPress={() => setTries((n) => n + 1)} />
            <SecondaryButton title={t("circle.join.decline", locale)} onPress={close} />
          </View>
        ) : preview === undefined ? (
          <ActivityIndicator />
        ) : joined ? (
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="alert" style={{ color: colors.ink }}>{t("circle.join.done", locale)}</Text>
            <PrimaryButton title={t("circle.join.open", locale)} onPress={() => { close(); onJoined?.(); }} />
          </View>
        ) : !preview.ok || failed ? (
          <View style={{ gap: 12 }}>
            <ErrorText>{t("circle.join.invalid", locale)}</ErrorText>
            <MutedText>{t("circle.join.sign_in", locale)}</MutedText>
            <SecondaryButton title={t("circle.join.decline", locale)} onPress={close} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Text style={{ color: colors.ink }}>{t("circle.join.body", locale, { name: preview.inviterFirstName, relationship: preview.relationship })}</Text>
            <Text style={{ fontWeight: "600", color: colors.ink }}>{t("circle.join.sees", locale)}</Text>
            {preview.permissions.map((perm) => <Text key={perm} style={{ color: colors.ink }}>{`\u2022 ${t(permissionKey(perm), locale)}`}</Text>)}
            {preview.crossOrganisation ? <MutedText>{t("circle.join.cross_org", locale)}</MutedText> : null}
            <PrimaryButton
              title={t("circle.join.accept", locale)}
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void acceptInvite(token).then((r) => {
                  setBusy(false);
                  if (r === "unreachable") setUnreachable(true);
                  else if (r.ok) setJoined(true);
                  else setFailed(true);
                });
              }}
            />
            <SecondaryButton title={t("circle.join.decline", locale)} onPress={close} />
          </View>
        )}
      </ScrollView>
    </Modal>
  );
}
