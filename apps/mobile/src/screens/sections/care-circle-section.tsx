import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Share, Switch, Text, TextInput, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { PLATFORM_URL } from "@/lib/platform-url";
import { cancelInvite, createInvite, loadMyCircle, loadViewLog, revokeMember, updateMember } from "@/lib/care-circle/api";
import {
  CIRCLE_PERMISSIONS, GRANT_DAY_CHOICES, inviteLinkPath, permissionKey,
  type CircleMember, type CirclePermission, type MyCircle, type ViewLogRow,
} from "@/lib/care-circle/parse";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}
function lagosDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
      <PermissionSwitches value={draft} onChange={(n) => { setDraft(n); setSaved(false); }} />
      <PrimaryButton title={t("circle.member.save", locale)} onPress={() => void save()} disabled={!changed || draft.length === 0 || busy} />
      <SecondaryButton title={t("circle.member.remove", locale)} onPress={remove} disabled={busy} />
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
      <PermissionSwitches value={perms} onChange={setPerms} />
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
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    const [c, l] = await Promise.all([loadMyCircle(), loadViewLog()]);
    if (c.ok) setCircle(c.data);
    else setLoadFailed(true);
    if (l.ok) setLog(l.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!circle) return loadFailed ? <ErrorText>{t("circle.error.unknown", locale)}</ErrorText> : <ActivityIndicator />;
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>{t("circle.title", locale)}</Text>
      <MutedText>{t("circle.intro", locale)}</MutedText>
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
