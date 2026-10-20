import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Share, View } from "react-native";
import { t } from "@tarragon/i18n";
import {
  SHARE_MAX_VIEWS_CHOICES,
  SHARE_SECTIONS,
  createShare,
  expiryLabel,
  fetchShareLink,
  getSharingConfig,
  loadShares,
  revokeShare,
  sectionLabel,
  shareFailureMessage,
  shareMessage,
  viewsLeft,
  type CreatedShare,
  type ShareSummary,
} from "@/lib/record-shares";
import { formatPassportDateTime } from "@/lib/passport-format";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, Card, Chip, Field, InlineAlert, Screen } from "@/ui/kit";
import { LoadFailed, PassportHeader, StaleNotice, ToggleRow } from "@/screens/sections/passport-parts";

interface Props {
  userId: string;
  /** Links are the signed-in person's own. While acting for someone else the screen is not offered (it would make links for the helper). */
  acting: boolean;
}

type ListState =
  | { kind: "loading" }
  | { kind: "failed"; offline: boolean; refused: boolean }
  | { kind: "ready"; shares: ShareSummary[]; stale: { offline: boolean; savedAt: string } | null };

function badges(s: ShareSummary): string[] {
  const left = viewsLeft(s.maxViews, s.viewCount);
  return [s.pinProtected ? t("share.badge.pin") : null, s.oneSession ? t("share.badge.session") : null, left !== null ? t("sharelink.badge.views_left", "en", { count: String(left) }) : null].filter(
    (b): b is string => b !== null
  );
}

export function ShareRecordsScreen({ userId, acting }: Props) {
  const { colors } = useTheme();
  const config = getSharingConfig();
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expiry, setExpiry] = useState(config.default_expiry_hours);
  const [label, setLabel] = useState("");
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [usePin, setUsePin] = useState(false);
  const [oneSession, setOneSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    const r = await loadShares(userId);
    if (mine !== latest.current) return;
    if (!r.ok) setList({ kind: "failed", offline: r.offline, refused: r.refused });
    else setList({ kind: "ready", shares: r.data, stale: r.stale ? { offline: r.offline, savedAt: r.savedAt } : null });
  }, [userId]);

  useEffect(() => {
    if (!acting) void load();
  }, [acting, load]);

  const live = list.kind === "ready" && list.stale === null;

  async function create() {
    setMessage(null);
    setBusy(true);
    const r = await createShare({ sections: [...selected], expiresInHours: expiry, usePin, oneSession, recipientLabel: label, maxViews });
    setBusy(false);
    if (!r.ok) {
      setMessage(shareFailureMessage(r.reason));
      return;
    }
    setCreated(r.share);
    setSelected(new Set());
    setUsePin(false);
    setOneSession(false);
    setLabel("");
    setMaxViews(null);
    void load();
  }

  async function sendAgain(id: string) {
    setMessage(null);
    const r = await fetchShareLink(id);
    if (!r.ok) {
      setMessage(shareFailureMessage(r.reason));
      return;
    }
    await Share.share({ message: shareMessage(r.token) }).catch(() => {});
  }

  function confirmStop(id: string) {
    Alert.alert(t("mpass.share.stop_title"), t("mpass.share.stop_body"), [
      { text: t("mpass.history.keep"), style: "cancel" },
      {
        text: t("share.revoke"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            setMessage(null);
            const r = await revokeShare(id);
            if (!r.ok) setMessage(shareFailureMessage(r.reason));
            else await load();
          })(),
      },
    ]);
  }

  const toggle = (section: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  if (acting) {
    return (
      <Screen edges={[]}>
        <PassportHeader title={t("passport.nav.share")} />
        <InlineAlert tone="info" message={t("mpass.own_only")} />
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <PassportHeader title={t("share.title")} description={t("share.description")} />
      {message ? <InlineAlert tone="danger" message={message} /> : null}

      {created ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {t("share.created.title")}
          </AppText>
          <AppText tone="textMuted">{t("mpass.share.created_body", "en", { when: formatPassportDateTime(created.expiresAt) })}</AppText>
          <Button title={t("mpass.share.send_link")} onPress={() => void Share.share({ message: shareMessage(created.token) }).catch(() => {})} />
          {created.pin ? (
            <View style={{ gap: space.sm }}>
              <InlineAlert tone="warn" message={t("share.created.pin_warning")} />
              <AppText variant="bodyStrong">{t("share.created.pin_title")}</AppText>
              <AppText variant="hero" selectable accessibilityLabel={created.pin.split("").join(" ")}>
                {created.pin}
              </AppText>
              <Button title={t("mpass.share.send_pin")} variant="secondary" onPress={() => void Share.share({ message: created.pin ?? "" }).catch(() => {})} />
            </View>
          ) : null}
          <Button title={t("share.created.done")} variant="ghost" onPress={() => setCreated(null)} />
        </Card>
      ) : null}

      <Card style={{ gap: space.md }}>
        <AppText variant="bodyStrong">{t("mpass.share.what")}</AppText>
        {SHARE_SECTIONS.map((section) => (
          <ToggleRow key={section} label={sectionLabel(section)} value={selected.has(section)} onChange={() => toggle(section)} />
        ))}

        <AppText variant="bodyStrong">{t("share.expiry.label")}</AppText>
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {config.expiry_options_hours.map((h) => (
            <Chip key={h} label={expiryLabel(h)} selected={expiry === h} onPress={() => setExpiry(h)} />
          ))}
        </View>

        <Field label={t("sharelink.recipient.label")} hint={t("sharelink.recipient.hint")} value={label} onChangeText={setLabel} maxLength={80} placeholder={t("sharelink.recipient.placeholder")} />

        <AppText variant="bodyStrong">{t("sharelink.max_views.label")}</AppText>
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <Chip label={t("sharelink.max_views.any")} selected={maxViews === null} onPress={() => setMaxViews(null)} />
          {SHARE_MAX_VIEWS_CHOICES.map((n) => (
            <Chip key={n} label={n === 1 ? t("sharelink.max_views.one") : t("sharelink.max_views.n", "en", { count: String(n) })} selected={maxViews === n} onPress={() => setMaxViews(n)} />
          ))}
        </View>

        <ToggleRow label={t("share.pin.label")} hint={t("share.pin.hint", "en", { digits: String(config.pin_digits) })} value={usePin} onChange={setUsePin} />
        <ToggleRow label={t("share.session.label")} hint={t("share.session.hint", "en", { minutes: String(config.one_session_window_minutes) })} value={oneSession} onChange={setOneSession} />

        <AppText variant="caption" tone="textMuted">
          {t("share.consent_notice")}
        </AppText>
        <Button title={t("share.create")} loading={busy} disabled={selected.size === 0} onPress={() => void create()} />
      </Card>

      <AppText variant="title" heading>
        {t("share.active_shares")}
      </AppText>
      {list.kind === "loading" ? <ActivityIndicator color={colors.brand} accessibilityLabel={t("mpass.loading")} /> : null}
      {list.kind === "failed" ? <LoadFailed offline={list.offline} refused={list.refused} onRetry={() => void load()} /> : null}
      {list.kind === "ready" ? (
        <>
          {list.stale ? <StaleNotice offline={list.stale.offline} savedAt={list.stale.savedAt} /> : null}
          {list.shares.length === 0 ? (
            <AppText tone="textMuted">{t("share.no_active_shares")}</AppText>
          ) : (
            list.shares.map((s) => (
              <Card key={s.id} style={{ gap: space.xs }}>
                <AppText variant="bodyStrong">{s.sections.map(sectionLabel).join(", ")}</AppText>
                {s.recipientLabel ? <AppText variant="caption" tone="textMuted">{s.recipientLabel}</AppText> : null}
                {badges(s).length > 0 ? (
                  <AppText variant="caption" tone="textMuted">
                    {badges(s).join(" · ")}
                  </AppText>
                ) : null}
                <AppText variant="caption" tone="textMuted">
                  {t("share.expires", "en", { date: formatPassportDateTime(s.expiresAt) })} · {t("share.views", "en", { count: String(s.viewCount) })}
                </AppText>
                {s.locked ? (
                  <AppText variant="caption" tone="dangerText">
                    {t("share.locked")}
                  </AppText>
                ) : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm }}>
                  <Button title={t("mpass.share.send_again")} accessibilityLabel={t("mpass.share.send_again_aria", "en", { what: s.sections.map(sectionLabel).join(", ") })} variant="secondary" fullWidth={false} disabled={!live} onPress={() => void sendAgain(s.id)} />
                  <Button title={t("share.revoke")} accessibilityLabel={t("mpass.share.stop_aria", "en", { what: s.sections.map(sectionLabel).join(", ") })} variant="secondary" fullWidth={false} disabled={!live} onPress={() => confirmStop(s.id)} />
                </View>
              </Card>
            ))
          )}
          {!live && list.shares.length > 0 ? <InlineAlert tone="info" message={t("mpass.needs_connection")} /> : null}
        </>
      ) : null}
    </Screen>
  );
}
