import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from "react-native";
import { t } from "@tarragon/i18n";
import {
  SHARE_MAX_VIEWS_CHOICES,
  SHARE_SECTIONS,
  SHARE_WINDOW_DAYS_CHOICES,
  createShare,
  expiryText,
  fetchShl,
  getSharingOffer,
  isUsedUp,
  loadMyShares,
  openShares,
  revokeShare,
  shareUrl,
  viewsLeft,
  type CreatedShare,
  type RecordShareRow,
  type RecordShareSection,
} from "@/lib/record-share";
import { supabase } from "@/lib/supabase";
import { API_BASE_URL } from "@/lib/api";
import { spacing, radius } from "@/ui/theme";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";

const OFFER = getSharingOffer();
type FetchArg = Parameters<typeof fetchShl>[2];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useLegacyColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        borderWidth: 1,
        borderColor: active ? colors.brand : colors.border,
        backgroundColor: active ? colors.brand : "transparent",
        borderRadius: radius.control,
        paddingVertical: 8,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ color: active ? "#fff" : colors.ink, fontSize: 13.5 }}>{label}</Text>
    </Pressable>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

/**
 * Share records, on the phone (S09 + share extras). Makes a time-limited link to chosen sections, with an optional PIN, a label for who it is
 * for, a limit on how many times it can be opened, and a date window for readings. The link and PIN go out through the phone's own share
 * sheet. Every rule is enforced by the database; this screen never decides who can see what.
 */
export function RecordShareScreen({ userId, acting }: { userId: string; acting: boolean }) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [shares, setShares] = useState<RecordShareRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sections, setSections] = useState<RecordShareSection[]>([]);
  const [expiry, setExpiry] = useState(OFFER.defaultExpiryHours);
  const [label, setLabel] = useState("");
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [windowDays, setWindowDays] = useState<number | null>(null);
  const [usePin, setUsePin] = useState(false);
  const [oneSession, setOneSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [shlNote, setShlNote] = useState<{ id: string; text: string } | null>(null);
  // An error from a button on one link's card shows on that card, where the person is looking.
  const [cardNote, setCardNote] = useState<{ id: string; text: string } | null>(null);

  // `quiet`: after a change, a refresh that cannot reach the server leaves the list as it is (never an error in place of the list, never an older list).
  const refresh = useCallback(
    async (quiet = false) => {
      const out = await loadMyShares(userId);
      if (out.ok) {
        setShares(out.data);
        setLoadFailed(false);
      } else if (!quiet) {
        setLoadFailed(true);
      }
    },
    [userId]
  );

  useEffect(() => {
    if (!acting) void refresh();
  }, [acting, refresh]);

  if (acting) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
        <ScreenTitle>{t("share.title")}</ScreenTitle>
        <Card>
          <MutedText>{t("sharelink.acting")}</MutedText>
        </Card>
      </ScrollView>
    );
  }

  const toggleSection = (id: RecordShareSection) => setSections((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));

  async function create() {
    if (sections.length === 0 || busy) return;
    setBusy(true);
    setCreateFailed(false);
    const out = await createShare({ sections, expiresInHours: expiry, usePin, oneSession, recipientLabel: label, maxViews, windowDays });
    setBusy(false);
    if (!out.ok) {
      // A lost answer is not proof nothing was made: the list is read again, and the person is told a link may already exist before they make another.
      setCreateFailed(true);
      void refresh(true);
      return;
    }
    setCreated(out.data);
    setSections([]);
    setLabel("");
    setMaxViews(null);
    setWindowDays(null);
    setUsePin(false);
    setOneSession(false);
    void refresh();
  }

  async function sendLink(token: string) {
    try {
      await Share.share({ message: shareUrl(token) });
    } catch {
      // The person closed the share sheet; nothing to do.
    }
  }

  async function sendShl(id: string) {
    const { data } = await supabase.auth.getSession();
    const out = await fetchShl(data.session?.access_token ?? null, id, fetch as unknown as FetchArg, API_BASE_URL);
    if (out.kind === "ok") {
      setShlNote(null);
      try {
        await Share.share({ message: out.link });
      } catch {
        // Share sheet closed.
      }
    } else {
      setShlNote({ id, text: t("sharelink.shl.unavailable") });
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setCardNote(null);
    const out = await revokeShare(id);
    setBusy(false);
    setArmed(null);
    if (!out.ok) {
      setCardNote({ id, text: t("sharelink.revoke_failed") });
      return;
    }
    // Gone from the list at once, whatever the refresh does next.
    setShares((cur) => (cur ? cur.filter((x) => x.id !== id) : cur));
    void refresh(true);
  }

  const active = shares ? openShares(shares) : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }} keyboardShouldPersistTaps="handled">
      <View>
        <ScreenTitle>{t("share.title")}</ScreenTitle>
        <MutedText>{t("share.description")}</MutedText>
      </View>

      <Card style={{ gap: 12 }}>
        <ChipRow>
          {SHARE_SECTIONS.map((s) => (
            <Chip key={s.id} label={s.label} active={sections.includes(s.id)} onPress={() => toggleSection(s.id)} />
          ))}
        </ChipRow>
        <MutedText>{t("sharelink.sections_note")}</MutedText>

        <Text style={{ color: colors.ink, fontWeight: "600" }}>{t("share.expiry.label")}</Text>
        <ChipRow>
          {OFFER.expiryOptionsHours.map((h) => (
            <Chip key={h} label={expiryText(h)} active={expiry === h} onPress={() => setExpiry(h)} />
          ))}
        </ChipRow>

        <Text style={{ color: colors.ink, fontWeight: "600" }}>{t("sharelink.recipient.label")}</Text>
        <TextInput
          keyboardAppearance={scheme}
          placeholderTextColor={placeholderColorFor(scheme)}
          value={label}
          onChangeText={setLabel}
          maxLength={80}
          placeholder={t("sharelink.recipient.placeholder")}
          style={textInputStyle}
          accessibilityLabel={t("sharelink.recipient.label")}
        />
        <MutedText>{t("sharelink.recipient.hint")}</MutedText>

        <Text style={{ color: colors.ink, fontWeight: "600" }}>{t("sharelink.max_views.label")}</Text>
        <ChipRow>
          <Chip label={t("sharelink.max_views.any")} active={maxViews === null} onPress={() => setMaxViews(null)} />
          {SHARE_MAX_VIEWS_CHOICES.map((n) => (
            <Chip
              key={n}
              label={n === 1 ? t("sharelink.max_views.one") : t("sharelink.max_views.n", "en", { count: String(n) })}
              active={maxViews === n}
              onPress={() => setMaxViews(n)}
            />
          ))}
        </ChipRow>

        <Text style={{ color: colors.ink, fontWeight: "600" }}>{t("sharelink.window.label")}</Text>
        <ChipRow>
          <Chip label={t("sharelink.window.latest")} active={windowDays === null} onPress={() => setWindowDays(null)} />
          {SHARE_WINDOW_DAYS_CHOICES.map((d) => (
            <Chip key={d} label={t("sharelink.window.days", "en", { days: String(d) })} active={windowDays === d} onPress={() => setWindowDays(d)} />
          ))}
        </ChipRow>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>{t("share.pin.label")}</Text>
            <MutedText>{t("share.pin.hint", "en", { digits: String(OFFER.pinDigits) })}</MutedText>
          </View>
          <Switch value={usePin} onValueChange={setUsePin} accessibilityLabel={t("share.pin.label")} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>{t("share.session.label")}</Text>
          </View>
          <Switch value={oneSession} onValueChange={setOneSession} accessibilityLabel={t("share.session.label")} />
        </View>

        <MutedText>{t("share.consent_notice")}</MutedText>
        {createFailed ? <ErrorText>{`${t("share.create_failed")} ${t("sharelink.maybe_made")}`}</ErrorText> : null}
        <PrimaryButton title={busy ? t("share.creating") : t("share.create")} disabled={sections.length === 0} loading={busy} onPress={() => void create()} />
      </Card>

      {created ? (
        <Card style={{ gap: 8 }}>
          <Text style={{ color: colors.ink, fontWeight: "700" }}>{t("share.created.title")}</Text>
          <Text selectable style={{ color: colors.ink }}>
            {shareUrl(created.token)}
          </Text>
          <SecondaryButton title={t("sharelink.send")} onPress={() => void sendLink(created.token)} />
          {created.pin ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.ink, fontWeight: "600" }}>{t("share.created.pin_title")}</Text>
              <Text selectable style={{ color: colors.ink, fontSize: 26, letterSpacing: 4 }}>
                {created.pin}
              </Text>
              <MutedText>{t("share.created.pin_warning")}</MutedText>
            </View>
          ) : null}
          <PrimaryButton title={t("share.created.done")} onPress={() => setCreated(null)} />
        </Card>
      ) : null}

      <View>
        <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 18 }}>{t("share.active_shares")}</Text>
      </View>
      {shares === null && !loadFailed ? (
        <ActivityIndicator color={colors.brand} />
      ) : loadFailed ? (
        <ErrorText>{t("my_health.log.failed")}</ErrorText>
      ) : active.length === 0 ? (
        <Card>
          <MutedText>{t("share.no_active_shares")}</MutedText>
        </Card>
      ) : (
        active.map((share) => {
          const left = viewsLeft(share.maxViews, share.viewCount);
          const badges = [
            share.pinProtected ? t("share.badge.pin") : null,
            share.oneSession ? t("share.badge.session") : null,
            left !== null ? (left === 1 ? t("sharelink.badge.views_left_one") : t("sharelink.badge.views_left", "en", { count: String(left) })) : null,
            share.windowDays !== null ? t("sharelink.badge.window", "en", { days: String(share.windowDays) }) : null,
          ].filter(Boolean);
          const usedUp = isUsedUp(share);
          return (
            <Card key={share.id} style={{ gap: 6 }}>
              <Text style={{ color: colors.ink, fontWeight: "600" }}>{share.sections.join(", ")}</Text>
              {share.recipientLabel ? <MutedText>{share.recipientLabel}</MutedText> : null}
              {badges.length > 0 ? <MutedText>{badges.join(" · ")}</MutedText> : null}
              <MutedText>
                {t("share.expires", "en", { date: when(share.expiresAt) })} · {t("share.views", "en", { count: String(share.viewCount) })}
              </MutedText>
              {usedUp ? <ErrorText>{t("sharelink.used_up")}</ErrorText> : null}
              <SecondaryButton title={t("sharelink.send")} disabled={usedUp} onPress={() => void sendLink(share.token)} />
              <SecondaryButton title={t("sharelink.shl.copy")} disabled={usedUp} onPress={() => void sendShl(share.id)} />
              {shlNote?.id === share.id ? <ErrorText>{shlNote.text}</ErrorText> : null}
              {cardNote?.id === share.id ? <ErrorText>{cardNote.text}</ErrorText> : null}
              {armed === share.id ? (
                <PrimaryButton title={t("share.revoke")} loading={busy} onPress={() => void revoke(share.id)} />
              ) : (
                <SecondaryButton title={t("share.revoke")} disabled={busy} onPress={() => setArmed(share.id)} />
              )}
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}
