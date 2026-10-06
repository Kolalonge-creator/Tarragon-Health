import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Share, Switch, Text, TextInput, View } from "react-native";
import { asLocale, en, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { PLATFORM_URL } from "@/lib/platform-url";
import {
  answerGift, cancelInvite, createInvite, loadMyCircle, loadPendingGifts, loadPreviewMember, loadPreviewPermissions, loadViewLog, pauseCircle, renewMember, resumeCircle, revokeMember, updateMember,
} from "@/lib/care-circle/api";
import {
  CIRCLE_PERMISSIONS, GRANT_DAY_CHOICES, endsSoon, inviteLinkPath, permissionKey,
  type CircleMember, type CirclePause, type CirclePermission, type MyCircle, type PendingGift, type PreviewView, type ViewLogRow,
} from "@/lib/care-circle/parse";
import { SupporterBlocks } from "./supporter-blocks";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}
function lagosDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** A care pack or Membership someone else paid for waits here for the patient's yes (S29b). Nothing starts until they accept. */
function GiftCards({ gifts, onAnswered }: { gifts: PendingGift[]; onAnswered: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  async function answer(id: string, accept: boolean) {
    setBusy(true);
    setFailed(false);
    setNotice(null);
    const r = await answerGift(id, accept);
    setBusy(false);
    if (r === null) {
      setFailed(true);
      return;
    }
    setNotice(r === "accepted" ? "circle.gift.accepted" : "circle.gift.declined");
    onAnswered();
  }
  function decline(id: string) {
    Alert.alert(t("circle.gift.decline", locale), t("circle.gift.decline_confirm", locale), [
      { text: t("circle.invite.done", locale), style: "cancel" },
      { text: t("circle.gift.decline", locale), style: "destructive", onPress: () => void answer(id, false) },
    ]);
  }
  if (gifts.length === 0 && !notice) return null;
  return (
    <View style={{ gap: 8 }}>
      {gifts.map((g) => (
        <Card key={g.entitlementId} style={{ gap: 6 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{t("circle.gift.title", locale)}</Text>
          <Text style={{ color: colors.ink }}>{t("circle.gift.body", locale, { item: Object.hasOwn(en, g.nameKey) ? t(g.nameKey as MessageKey, locale) : "" })}</Text>
          <MutedText>{t("circle.gift.decide_by", locale, { date: lagosDate(g.decideBy) })}</MutedText>
          <PrimaryButton title={t("circle.gift.accept", locale)} onPress={() => void answer(g.entitlementId, true)} disabled={busy} />
          <SecondaryButton title={t("circle.gift.decline", locale)} onPress={() => decline(g.entitlementId)} disabled={busy} />
        </Card>
      ))}
      {notice ? <MutedText>{t(notice, locale)}</MutedText> : null}
      {failed ? <ErrorText>{t("circle.gift.error", locale)}</ErrorText> : null}
    </View>
  );
}

/** What a supporter would see, read only and sent to no one. The blocks are the supporter page's own component. */
function PreviewPanel({ view, failed }: { view: PreviewView | null | undefined; failed: boolean }) {
  const locale = asLocale(useUiLanguage());
  if (failed || view === null) return <ErrorText>{t("circle.preview.error", locale)}</ErrorText>;
  if (view === undefined) return <ActivityIndicator />;
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ fontWeight: "700" }}>{t("circle.preview.title", locale)}</Text>
      <MutedText>{t("circle.preview.note", locale)}</MutedText>
      <SupporterBlocks view={view} />
      {view.alertSample ? <Text>{t("circle.preview.alert", locale)}</Text> : null}
    </View>
  );
}

function MemberPreview({ memberId }: { memberId: string }) {
  const locale = asLocale(useUiLanguage());
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PreviewView | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setView(undefined);
    setFailed(false);
    void loadPreviewMember(memberId).then((r) => (r.ok ? setView(r.data) : setFailed(true)));
  }
  return (
    <View style={{ gap: 8 }}>
      <SecondaryButton title={open ? t("circle.preview.hide", locale) : t("circle.preview.button", locale)} onPress={toggle} />
      {open ? <PreviewPanel view={view} failed={failed} /> : null}
    </View>
  );
}

/** One tap to stop everyone seeing anything for a while. Silent to supporters, no reason asked; the patient chooses whether check-in requests pause too. */
function PauseCard({ pause, days, onChanged }: { pause: CirclePause | undefined; days: number; onChanged: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [alsoAlerts, setAlsoAlerts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function run(action: () => Promise<boolean>) {
    setBusy(true);
    setFailed(false);
    const ok = await action();
    setBusy(false);
    if (ok) onChanged();
    else setFailed(true);
  }
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontWeight: "700", color: colors.ink }}>{t("circle.pause.title", locale)}</Text>
      {pause ? (
        <>
          <Text style={{ fontWeight: "600", color: colors.ink }}>{t("circle.pause.active", locale, { date: lagosDate(pause.pausedUntil) })}</Text>
          <MutedText>{t(pause.pauseAlerts ? "circle.pause.alerts_paused" : "circle.pause.alerts_on", locale)}</MutedText>
          <PrimaryButton title={t("circle.pause.resume", locale)} onPress={() => void run(resumeCircle)} disabled={busy} />
        </>
      ) : (
        <>
          <Text style={{ color: colors.ink }}>{t("circle.pause.body", locale, { days })}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}>
            <Switch accessibilityLabel={t("circle.pause.alerts", locale)} value={alsoAlerts} onValueChange={setAlsoAlerts} />
            <Text style={{ flex: 1, color: colors.ink }}>{t("circle.pause.alerts", locale)}</Text>
          </View>
          <PrimaryButton title={t("circle.pause.button", locale, { days })} onPress={() => void run(() => pauseCircle(alsoAlerts))} disabled={busy} />
        </>
      )}
      {failed ? <ErrorText>{t("circle.pause.error", locale)}</ErrorText> : null}
    </Card>
  );
}

function PermissionSwitches({ value, onChange }: { value: readonly CirclePermission[]; onChange: (next: CirclePermission[]) => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  return (
    <View style={{ gap: 6 }}>
      {CIRCLE_PERMISSIONS.map((p) => {
        const on = value.includes(p);
        const label = t(permissionKey(p), locale);
        return (
          <View key={p} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}>
            <Switch accessibilityLabel={label} value={on} onValueChange={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])} />
            <Text style={{ flex: 1, color: colors.ink }}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function MemberCard({ member, onChanged }: { member: CircleMember; onChanged: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [draft, setDraft] = useState<CirclePermission[]>(member.permissions);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const changed = draft.length !== member.permissions.length || draft.some((p) => !member.permissions.includes(p));

  async function save() {
    setBusy(true);
    setFailed(false);
    setSaved(false);
    const ok = await updateMember(member.memberId, draft);
    setBusy(false);
    if (ok) {
      setSaved(true);
      onChanged();
    } else setFailed(true);
  }
  async function renew() {
    setBusy(true);
    setFailed(false);
    const ok = await renewMember(member.memberId);
    setBusy(false);
    if (ok) onChanged();
    else setFailed(true);
  }
  function remove() {
    Alert.alert(t("circle.member.remove", locale), t("circle.member.remove_confirm", locale, { name: member.name }), [
      { text: t("circle.invite.done", locale), style: "cancel" },
      {
        text: t("circle.member.remove", locale),
        style: "destructive",
        onPress: () => {
          void revokeMember(member.memberId).then(onChanged);
        },
      },
    ]);
  }

  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontWeight: "700", color: colors.ink }}>{`${member.name} (${member.relationship})`}</Text>
      <MutedText>{t("circle.member.until", locale, { date: lagosDate(member.expiresAt) })}</MutedText>
      {endsSoon(member.expiresAt, Date.now()) ? <Text style={{ fontWeight: "600", color: colors.ink }}>{t("circle.member.ends_soon", locale)}</Text> : null}
      <PermissionSwitches value={draft} onChange={(n) => { setDraft(n); setSaved(false); }} />
      <PrimaryButton title={t("circle.member.save", locale)} onPress={() => void save()} disabled={!changed || draft.length === 0 || busy} />
      <SecondaryButton title={t("circle.member.renew", locale)} onPress={() => void renew()} disabled={busy} />
      <SecondaryButton title={t("circle.member.remove", locale)} onPress={remove} disabled={busy} />
      <MemberPreview memberId={member.memberId} />
      {saved ? <MutedText>{t("circle.member.saved", locale)}</MutedText> : null}
      {failed ? <ErrorText>{t("circle.error.unknown", locale)}</ErrorText> : null}
    </Card>
  );
}

function InviteForm({ onMade }: { onMade: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const inputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [kind, setKind] = useState<"email" | "phone">("email");
  const [contact, setContact] = useState("");
  const [relationship, setRelationship] = useState("");
  const [perms, setPerms] = useState<CirclePermission[]>([]);
  const [days, setDays] = useState<number>(365);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [made, setMade] = useState<{ link: string; expiresAt: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState<PreviewView | null | undefined>(undefined);
  const [previewFailed, setPreviewFailed] = useState(false);

  function togglePreview() {
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    setShowPreview(true);
    setPreview(undefined);
    setPreviewFailed(false);
    if (perms.length > 0) void loadPreviewPermissions(perms, relationship.trim()).then((r) => (r.ok ? setPreview(r.data) : setPreviewFailed(true)));
  }

  async function submit() {
    setBusy(true);
    setErrorKey(null);
    const r = await createInvite({ kind, contact: contact.trim(), relationship: relationship.trim(), permissions: perms, days });
    setBusy(false);
    if (!r.ok) {
      setErrorKey(r.errorKey);
      return;
    }
    setMade({ link: `${PLATFORM_URL}${inviteLinkPath(r.token)}`, expiresAt: r.expiresAt });
    onMade();
  }

  if (made) {
    return (
      <Card style={{ gap: 8 }}>
        <Text style={{ color: colors.ink }}>{t("circle.invite.made", locale)}</Text>
        <Text selectable style={{ color: colors.ink }}>{made.link}</Text>
        <MutedText>{`${t("circle.invite.once", locale)} ${t("circle.invite.expires", locale, { date: lagosDateTime(made.expiresAt) })}`}</MutedText>
        <PrimaryButton title={t("circle.invite.share", locale)} onPress={() => { void Share.share({ message: t("circle.invite.share_text", locale, { link: made.link }) }).catch(() => undefined); }} />
        <SecondaryButton
          title={t("circle.invite.done", locale)}
          onPress={() => {
            setMade(null);
            setContact("");
            setRelationship("");
            setPerms([]);
          }}
        />
      </Card>
    );
  }

  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontWeight: "700", color: colors.ink }}>{t("circle.invite.new", locale)}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <SecondaryButton title={`${kind === "email" ? "● " : ""}${t("circle.invite.kind.email", locale)}`} onPress={() => setKind("email")} />
        <SecondaryButton title={`${kind === "phone" ? "● " : ""}${t("circle.invite.kind.phone", locale)}`} onPress={() => setKind("phone")} />
      </View>
      <Text style={{ color: colors.ink }}>{t("circle.invite.contact", locale)}</Text>
      <TextInput
        accessibilityLabel={t("circle.invite.contact", locale)}
        keyboardAppearance={scheme}
        placeholderTextColor={placeholderColorFor(scheme)}
        value={contact}
        onChangeText={setContact}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={kind === "email" ? "email-address" : "phone-pad"}
        style={inputStyle}
      />
      <Text style={{ color: colors.ink }}>{t("circle.invite.relationship", locale)}</Text>
      <TextInput accessibilityLabel={t("circle.invite.relationship", locale)} keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={relationship} onChangeText={setRelationship} maxLength={40} style={inputStyle} />
      <Text style={{ fontWeight: "600", color: colors.ink }}>{t("circle.invite.permissions", locale)}</Text>
      <PermissionSwitches value={perms} onChange={(n) => { setPerms(n); setShowPreview(false); }} />
      <SecondaryButton title={showPreview ? t("circle.preview.hide", locale) : t("circle.preview.invite_button", locale)} onPress={togglePreview} />
      {showPreview ? (perms.length === 0 ? <MutedText>{t("circle.preview.empty", locale)}</MutedText> : <PreviewPanel view={preview} failed={previewFailed} />) : null}
      <Text style={{ color: colors.ink }}>{t("circle.invite.days", locale)}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {GRANT_DAY_CHOICES.map((d) => (
          <SecondaryButton key={d} title={`${days === d ? "● " : ""}${t("circle.invite.days.option", locale, { days: d })}`} onPress={() => setDays(d)} />
        ))}
      </View>
      <PrimaryButton title={t("circle.invite.create", locale)} onPress={() => void submit()} loading={busy} disabled={busy || perms.length === 0 || contact.trim() === "" || relationship.trim() === ""} />
      {errorKey ? <ErrorText>{t(errorKey, locale)}</ErrorText> : null}
    </Card>
  );
}

/**
 * The patient's Care Circle (S29): who can see what, and the one place to invite, change or remove anyone. Embedded in "Your people".
 * The invite link is shared from the patient's own phone (the platform sends no SMS); the token is shown once.
 */
export function CareCircleSection() {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [log, setLog] = useState<ViewLogRow[]>([]);
  const [gifts, setGifts] = useState<PendingGift[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    const [c, l, g] = await Promise.all([loadMyCircle(), loadViewLog(), loadPendingGifts()]);
    if (c.ok) setCircle(c.data);
    else setLoadFailed(true);
    if (l.ok) setLog(l.data);
    if (g.ok) setGifts(g.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!circle) return loadFailed ? <ErrorText>{t("circle.error.unknown", locale)}</ErrorText> : <ActivityIndicator />;
  return (
    <View style={{ gap: 12 }}>
      <GiftCards gifts={gifts} onAnswered={() => void refresh()} />
      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>{t("circle.title", locale)}</Text>
      <MutedText>{t("circle.intro", locale)}</MutedText>
      <Text style={{ fontWeight: "600", color: colors.ink }}>{t("circle.stop.reminder", locale)}</Text>
      <PauseCard pause={circle.pause} days={circle.pauseDays ?? 7} onChanged={() => void refresh()} />
      {circle.members.length === 0 ? <MutedText>{t("circle.members.empty", locale)}</MutedText> : null}
      {circle.members.map((m) => <MemberCard key={m.memberId} member={m} onChanged={() => void refresh()} />)}
      {circle.invites.map((i) => (
        <Card key={i.inviteId} style={{ gap: 6 }}>
          <Text style={{ color: colors.ink }}>{`${i.hint} (${i.relationship})`}</Text>
          <MutedText>{t("circle.invite.expires", locale, { date: lagosDateTime(i.expiresAt) })}</MutedText>
          <SecondaryButton title={t("circle.invite.cancel", locale)} onPress={() => { void cancelInvite(i.inviteId).then(refresh); }} />
        </Card>
      ))}
      <InviteForm onMade={() => void refresh()} />
      <Card style={{ gap: 4 }}>
        <Text style={{ fontWeight: "700", color: colors.ink }}>{t("circle.log.title", locale)}</Text>
        {log.length === 0 ? <MutedText>{t("circle.log.empty", locale)}</MutedText> : null}
        {log.map((row) => <Text key={`${row.viewer}-${row.at}`} style={{ color: colors.ink }}>{t("circle.log.line", locale, { name: row.viewer, date: lagosDateTime(row.at) })}</Text>)}
      </Card>
    </View>
  );
}
