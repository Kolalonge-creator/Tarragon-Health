import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { withoutCrossOrganisation } from "@tarragon/shared";
import { acceptInvite, declineInvite, previewInvite } from "@/lib/care-circle/api";
import { PermissionSummary } from "./circle-tools";
import { clearPendingJoinToken, usePendingJoinToken } from "@/lib/care-circle/join-link";
import { permissionKey, type InvitePreview } from "@/lib/care-circle/parse";
import { useLegacyColors } from "@/ui/design";
import { ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

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
  const [notNow, setNotNow] = useState<"done" | "error" | null>(null);

  useEffect(() => {
    setPreview(undefined);
    setJoined(false);
    setFailed(false);
    setUnreachable(false);
    setNotNow(null);
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
        <AppText variant="title" accessibilityRole="header">{t("circle.join.title", locale)}</AppText>
        {unreachable ? (
          <View style={{ gap: 12 }}>
            <ErrorText>{t("joinlink.network", locale)}</ErrorText>
            <PrimaryButton title={t("joinlink.retry", locale)} onPress={() => setTries((n) => n + 1)} />
            <SecondaryButton title={t("circle.join.decline", locale)} onPress={close} />
          </View>
        ) : notNow === "done" ? (
          <View style={{ gap: 12 }}>
            {/* silent for the person who asked: this says only that nothing was shared */}
            <AppText variant="body" accessibilityRole="alert">{t("cctools.join.not_now_done", locale)}</AppText>
            <SecondaryButton title={t("circle.invite.done", locale)} onPress={close} />
          </View>
        ) : preview === undefined ? (
          <ActivityIndicator />
        ) : joined ? (
          <View style={{ gap: 12 }}>
            <AppText variant="body" accessibilityRole="alert">{t("circle.join.done", locale)}</AppText>
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
            <AppText variant="body">{t("circle.join.body", locale, { name: preview.inviterFirstName, relationship: preview.relationship })}</AppText>
            <PermissionSummary permissions={preview.crossOrganisation ? withoutCrossOrganisation(preview.permissions) : preview.permissions} audience="invitee" name={preview.inviterFirstName} />
            {preview.crossOrganisation ? <MutedText>{t("cctools.preview.cross_org", locale)}</MutedText> : null}
            <AppText variant="bodyStrong">{t("circle.join.sees", locale)}</AppText>
            {preview.permissions.map((perm) => <Text key={perm} style={{ color: colors.ink }}>{`\u2022 ${t(permissionKey(perm), locale)}`}</Text>)}
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
            <SecondaryButton
              title={t("cctools.join.not_now", locale)}
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void declineInvite(token).then((ok) => {
                  setBusy(false);
                  setNotNow(ok ? "done" : "error");
                });
              }}
            />
            {notNow === "error" ? <ErrorText>{t("cctools.join.not_now_error", locale)}</ErrorText> : null}
          </View>
        )}
      </ScrollView>
    </Modal>
  );
}
