import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Share, Text, TextInput, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { PLATFORM_URL } from "@/lib/platform-url";
import {
  closeCohort, contribute, createCohort, createInvite, joinCohort, leaveCohort, loadBoard, loadChallenges, loadMyCohorts, loadRoster, loadTemplates, previewInvite,
  reportMember, setCommunityOff, setMuted, setTotalsConsent, startChallenge, type Done,
} from "@/lib/community/api";
import {
  COHORT_KINDS, KIND_KEYS, UNIT_KEYS, communityJoinPath, tokenFromInput,
  type Board, type Challenge, type Cohort, type MyCohorts, type RosterRow, type Template,
} from "@/lib/community/parse";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

/** A goal bar: the cohort's percentage only. Nothing here can carry a person's figure. */
function GoalBar({ percent, label }: { percent: number; label: string }) {
  const colors = useLegacyColors();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: percent }}>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: "hidden" }}>
        <View style={{ height: 10, width: `${percent}%`, backgroundColor: colors.brand }} />
      </View>
      <Text style={{ color: colors.ink, marginTop: 4 }}>{label}</Text>
    </View>
  );
}

function BoardView({ challengeId }: { challengeId: string }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [board, setBoard] = useState<Board>({ state: "hidden" });
  useEffect(() => {
    void loadBoard(challengeId).then((r) => { if (r.ok) setBoard(r.data); });
  }, [challengeId]);
  if (board.state === "hidden") return null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontWeight: "600", color: colors.ink }}>{t("community.board.title", locale)}</Text>
      <MutedText>{t("community.board.note", locale)}</MutedText>
      {board.state === "not_ready" ? <Text style={{ color: colors.ink }}>{t("community.board.not_ready", locale)}</Text> : board.rows.map((r) => (
        <Text key={`${r.rank}-${r.label}`} style={{ color: colors.ink, fontWeight: r.isYours ? "700" : "400" }}>
          {t("community.board.row", locale, { label: r.isYours ? t("community.board.yours", locale) : r.label, percent: String(r.progressPct) })}
        </Text>
      ))}
    </View>
  );
}

function ChallengeCard({ c, contributing, onChanged }: { c: Challenge; contributing: boolean; onChanged: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const { scheme } = useTheme();
  const inputStyle = useTextInputStyle();
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<MessageKey | null>(null);
  async function add() {
    setBusy(true);
    setNote(null);
    const r = await contribute(c.challengeId, c.unit === "minutes" ? Number(minutes) : undefined);
    setBusy(false);
    if (!r.ok) setNote(r.errorKey);
    else if (!r.result.ok) setNote(r.result.reason === "consent_needed" ? "community.challenge.needs_consent" : "community.challenge.unavailable");
    else { setNote(r.result.capped ? "community.challenge.capped" : "community.challenge.counted"); setMinutes(""); onChanged(); }
  }
  const phaseKey: MessageKey = c.phase === "scheduled" ? "community.challenge.phase.scheduled" : c.phase === "active" ? "community.challenge.phase.active" : "community.challenge.phase.ended";
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontWeight: "700", color: colors.ink }}>{c.label}</Text>
      <MutedText>{t(phaseKey, locale, { date: c.phase === "scheduled" ? c.startsOn : c.endsOn })}</MutedText>
      {c.total.state === "shown" ? (
        <View style={{ gap: 6 }}>
          <GoalBar percent={c.total.progressPct} label={t("community.challenge.progress", locale, { percent: String(c.total.progressPct) })} />
          <Text style={{ color: colors.ink }}>{t("community.challenge.total", locale, { total: String(c.total.total), unit: t(UNIT_KEYS[c.unit], locale) })}</Text>
          {c.total.goalReached ? <Text style={{ fontWeight: "700", color: colors.ink }}>{t("community.challenge.goal", locale)}</Text> : null}
          <MutedText>{`${t("community.challenge.group_size", locale, { band: c.total.groupSize })} · ${t("community.challenge.as_of", locale, { date: c.total.asOf })}`}</MutedText>
        </View>
      ) : <MutedText>{t(c.total.state === "hidden" ? "community.challenge.hidden" : "community.challenge.pending", locale)}</MutedText>}
      {!c.available ? <Text style={{ color: colors.ink }}>{t("community.challenge.unavailable", locale)}</Text> : c.phase === "active" ? (
        !contributing ? <Text style={{ color: colors.ink }}>{t("community.challenge.needs_consent", locale)}</Text> : (
          <View style={{ gap: 8 }}>
            {c.unit === "minutes" ? (
              <TextInput accessibilityLabel={t("community.challenge.minutes", locale)} keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} placeholder={t("community.challenge.minutes", locale)}
                value={minutes} onChangeText={setMinutes} keyboardType="number-pad" maxLength={3} style={inputStyle} />
            ) : null}
            <PrimaryButton title={t("community.challenge.add_today", locale)} onPress={() => void add()} loading={busy} disabled={busy || (c.unit === "minutes" && !(Number(minutes) >= 1))} />
          </View>
        )
      ) : null}
      {note ? <MutedText>{t(note, locale)}</MutedText> : null}
      <BoardView challengeId={c.challengeId} />
    </Card>
  );
}

function ModeratorTools({ cohort, onChanged }: { cohort: Cohort; onChanged: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  useEffect(() => { void loadTemplates().then((r) => { if (r.ok) setTemplates(r.data); }); }, []);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

  async function invite() {
    setBusy(true);
    setErrorKey(null);
    const r = await createInvite(cohort.cohortId);
    setBusy(false);
    if (!r.ok) { setErrorKey(r.errorKey); return; }
    // The phone's own share menu is the only way out. No WhatsApp button or link is built (founder decision, spec 17).
    await Share.share({ message: `${PLATFORM_URL}${communityJoinPath(r.token)}` });
  }
  async function start(tpl: Template) {
    setBusy(true);
    setErrorKey(null);
    const r = await startChallenge(cohort.cohortId, tpl.code, today, tpl.defaultDays);
    setBusy(false);
    if (!r.ok) setErrorKey(r.errorKey);
    else onChanged();
  }
  function close() {
    Alert.alert(t("community.mod.close", locale), t("community.mod.close_confirm", locale), [
      { text: t("community.leave", locale), style: "cancel" },
      { text: t("community.mod.close", locale), style: "destructive", onPress: () => { void closeCohort(cohort.cohortId).then(onChanged); } },
    ]);
  }
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontWeight: "700", color: colors.ink }}>{t("community.mod.title", locale)}</Text>
      <MutedText>{t("community.mod.no_health", locale)}</MutedText>
      <PrimaryButton title={t("community.mod.invite", locale)} onPress={() => void invite()} loading={busy} disabled={busy} />
      <MutedText>{t("community.mod.invite_note", locale)}</MutedText>
      <Text style={{ fontWeight: "600", color: colors.ink }}>{t("community.mod.start", locale)}</Text>
      {templates.length === 0 ? <MutedText>{t("community.mod.no_templates", locale)}</MutedText> : templates.map((tp) => (
        <SecondaryButton key={tp.code} title={tp.label} onPress={() => void start(tp)} disabled={busy} />
      ))}
      <SecondaryButton title={t("community.mod.close", locale)} onPress={close} />
      {errorKey ? <ErrorText>{t(errorKey, locale)}</ErrorText> : null}
    </Card>
  );
}

function CohortDetail({ cohort, onBack, onChanged }: { cohort: Cohort; onBack: () => void; onChanged: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const refresh = useCallback(async () => {
    const [c, r] = await Promise.all([loadChallenges(cohort.cohortId), loadRoster(cohort.cohortId)]);
    setChallenges(c.ok ? c.data : []);
    if (r.ok) setRoster(r.data);
  }, [cohort.cohortId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function run(p: Promise<Done>, after: () => void) {
    setErrorKey(null);
    const r = await p;
    if (!r.ok) setErrorKey(r.errorKey);
    else after();
  }
  function leave() {
    Alert.alert(t("community.leave", locale), t("community.leave.confirm", locale), [
      { text: t("community.group.back", locale), style: "cancel" },
      { text: t("community.leave", locale), style: "destructive", onPress: () => void run(leaveCohort(cohort.cohortId), () => { onChanged(); onBack(); }) },
    ]);
  }
  function report(m: RosterRow) {
    Alert.alert(t("community.report.title", locale), t("community.report.note", locale), [
      ...(["concerning_behaviour", "unwanted_contact", "pressure_to_share", "something_else"] as const).map((reason) => ({
        text: t(`community.report.reason.${reason}` as MessageKey, locale),
        onPress: () => void run(reportMember(cohort.cohortId, m.memberId, reason), () => Alert.alert(t("community.report.sent", locale))),
      })),
      { text: t("community.group.back", locale), style: "cancel" as const },
    ]);
  }

  if (cohort.state === "closed") return <MutedText>{t("community.mod.closed", locale)}</MutedText>;
  return (
    <View style={{ gap: 12 }}>
      <SecondaryButton title={t("community.group.back", locale)} onPress={onBack} />
      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>{cohort.name}</Text>
      <Card style={{ gap: 8 }}>
        <Text style={{ fontWeight: "700", color: colors.ink }}>{t("community.totals.title", locale)}</Text>
        <MutedText>{t("community.totals.consent_body", locale)}</MutedText>
        <Text style={{ color: colors.ink }}>{t(cohort.contributing ? "community.totals.on" : "community.totals.off", locale)}</Text>
        <SecondaryButton title={t(cohort.contributing ? "community.totals.withdraw" : "community.totals.agree", locale)}
          onPress={() => void run(setTotalsConsent(cohort.cohortId, !cohort.contributing), onChanged)} />
      </Card>
      <Text style={{ fontWeight: "700", color: colors.ink }}>{t("community.challenges.title", locale)}</Text>
      {challenges === null ? <ActivityIndicator /> : challenges.length === 0 ? <MutedText>{t("community.challenges.none", locale)}</MutedText>
        : challenges.map((c) => <ChallengeCard key={c.challengeId} c={c} contributing={cohort.contributing} onChanged={() => void refresh()} />)}
      <Card style={{ gap: 6 }}>
        <Text style={{ fontWeight: "700", color: colors.ink }}>{t("community.group.members", locale)}</Text>
        <MutedText>{t("community.group.members_note", locale)}</MutedText>
        {roster.map((m) => (
          <View key={m.memberId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Text style={{ color: colors.ink, flexShrink: 1 }}>{`${m.firstName}${m.isYou ? ` (${t("community.group.you", locale)})` : ""} · ${t(m.role === "moderator" ? "community.group.role.moderator" : "community.group.role.member", locale)}`}</Text>
            {!m.isYou ? <SecondaryButton title={t("community.report.member", locale)} onPress={() => report(m)} /> : null}
          </View>
        ))}
      </Card>
      {cohort.isModerator ? <ModeratorTools cohort={cohort} onChanged={() => { onChanged(); void refresh(); }} /> : null}
      <SecondaryButton title={t(cohort.muted ? "community.unmute" : "community.mute", locale)} onPress={() => void run(setMuted(cohort.cohortId, !cohort.muted), onChanged)} />
      <SecondaryButton title={t("community.leave", locale)} onPress={leave} />
      {errorKey ? <ErrorText>{t(errorKey, locale)}</ErrorText> : null}
    </View>
  );
}

function JoinCard({ onJoined }: { onJoined: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const { scheme } = useTheme();
  const inputStyle = useTextInputStyle();
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<{ name: string; kind: (typeof COHORT_KINDS)[number] } | "bad" | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  async function check() {
    const token = tokenFromInput(raw);
    if (!token) { setPreview("bad"); return; }
    const p = await previewInvite(token);
    setPreview(p.ok ? { name: p.name, kind: p.kind } : "bad");
  }
  async function join() {
    setBusy(true);
    const r = await joinCohort(tokenFromInput(raw), agree);
    setBusy(false);
    if (r.ok && r.result.ok) { setRaw(""); setPreview(null); setAgree(false); onJoined(); } else setPreview("bad");
  }
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontWeight: "700", color: colors.ink }}>{t("community.join.title", locale)}</Text>
      <TextInput accessibilityLabel={t("community.join.title", locale)} keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} placeholder="https://..."
        value={raw} onChangeText={(v) => { setRaw(v); setPreview(null); }} autoCapitalize="none" autoCorrect={false} style={inputStyle} />
      <SecondaryButton title={t("community.open", locale)} onPress={() => void check()} disabled={raw.trim() === ""} />
      {preview === "bad" ? <ErrorText>{t("community.join.invalid", locale)}</ErrorText> : preview ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.ink }}>{t("community.join.body", locale, { name: preview.name, kind: t(KIND_KEYS[preview.kind], locale).toLowerCase() })}</Text>
          <MutedText>{t("community.join.consent_note", locale)}</MutedText>
          <SecondaryButton title={`${agree ? "● " : "○ "}${t("community.join.consent", locale)}`} onPress={() => setAgree(!agree)} />
          <PrimaryButton title={t("community.join.accept", locale)} onPress={() => void join()} loading={busy} disabled={!agree || busy} />
        </View>
      ) : null}
    </Card>
  );
}

function CreateCard({ onCreated }: { onCreated: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const { scheme } = useTheme();
  const inputStyle = useTextInputStyle();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof COHORT_KINDS)[number]>("church");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  async function submit() {
    setBusy(true);
    setErrorKey(null);
    const r = await createCohort(name.trim(), kind, agree);
    setBusy(false);
    if (!r.ok) setErrorKey(r.errorKey);
    else { setName(""); setAgree(false); onCreated(); }
  }
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontWeight: "700", color: colors.ink }}>{t("community.create.title", locale)}</Text>
      <Text style={{ color: colors.ink }}>{t("community.create.name", locale)}</Text>
      <TextInput accessibilityLabel={t("community.create.name", locale)} keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={name} onChangeText={setName} maxLength={60} style={inputStyle} />
      <MutedText>{t("community.create.name_hint", locale)}</MutedText>
      <Text style={{ color: colors.ink }}>{t("community.create.kind", locale)}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {COHORT_KINDS.map((k) => <SecondaryButton key={k} title={`${kind === k ? "● " : ""}${t(KIND_KEYS[k], locale)}`} onPress={() => setKind(k)} />)}
      </View>
      <SecondaryButton title={`${agree ? "● " : "○ "}${t("community.create.consent", locale)}`} onPress={() => setAgree(!agree)} />
      <PrimaryButton title={t("community.create.submit", locale)} onPress={() => void submit()} loading={busy} disabled={busy || !agree || name.trim().length < 3} />
      {errorKey ? <ErrorText>{t(errorKey, locale)}</ErrorText> : null}
    </Card>
  );
}

/**
 * Community groups (S69, spec 17.6 to 17.9): private cohorts with effort challenges and one combined cohort total. Embedded in "Your
 * people". Renders nothing until community is open for this person (module and go-live guard, or a test account).
 */
export function CommunitySection() {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [mine, setMine] = useState<MyCohorts | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const r = await loadMyCohorts();
    setMine(r.ok ? r.data : { open: false, off: false, cohorts: [] });
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!mine || !mine.open) return null;
  const cohort = mine.cohorts.find((c) => c.cohortId === openId);
  if (cohort) return <CohortDetail cohort={cohort} onBack={() => setOpenId(null)} onChanged={() => void refresh()} />;
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>{t("community.title", locale)}</Text>
      <MutedText>{t("community.intro", locale)}</MutedText>
      <Card style={{ gap: 6 }}>
        <Text style={{ fontWeight: "700", color: colors.ink }}>{t("community.off.title", locale)}</Text>
        <MutedText>{t("community.off.body", locale)}</MutedText>
        <SecondaryButton title={t(mine.off ? "community.off.turn_on" : "community.off.turn_off", locale)} onPress={() => { void setCommunityOff(!mine.off).then(refresh); }} />
      </Card>
      {mine.off ? <MutedText>{t("community.off.is_off", locale)}</MutedText> : (
        <>
          {mine.cohorts.length === 0 ? <MutedText>{t("community.empty", locale)}</MutedText> : mine.cohorts.map((c) => (
            <Card key={c.cohortId} style={{ gap: 6 }}>
              <Text style={{ fontWeight: "700", color: colors.ink }}>{c.name}</Text>
              <MutedText>{`${t(KIND_KEYS[c.kind], locale)}${c.isModerator ? ` · ${t("community.moderator_badge", locale)}` : ""}`}</MutedText>
              <SecondaryButton title={t("community.open", locale)} onPress={() => setOpenId(c.cohortId)} />
            </Card>
          ))}
          <JoinCard onJoined={() => void refresh()} />
          <CreateCard onCreated={() => void refresh()} />
        </>
      )}
    </View>
  );
}
