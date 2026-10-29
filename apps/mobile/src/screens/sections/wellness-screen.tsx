import { useCallback, useEffect, useState } from "react";
import { t, pointsTierLabel, pointsRuleLabel, milestoneCopy, pendingActionLabel } from "@tarragon/i18n";
import { describePending, type PendingCreditItem, type PendingMilestone } from "@tarragon/shared";
import { setSupportPrefill } from "@/lib/support-prefill";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import {
  enrolInWellnessChallenge,
  loadMyChallengeEnrolments,
  loadMyClassRegistrations,
  loadMyWellnessBadges,
  loadUpcomingWellnessClasses,
  loadWellnessBadgesCatalogue,
  loadWellnessChallengeProgress,
  loadWellnessChallengesCatalogue,
  loadMyPointsStatus,
  loadMyPointsPending,
  loadMyPendingMilestone,
  dismissMilestone,
  loadRewardRules,
  loadWellnessPointsLedger,
  markWellnessClassAttended,
  reasonLabel,
  registerForWellnessClass,
  type ChallengeEnrolment,
  type PatientWellnessBadge,
  type WellnessBadge,
  type WellnessChallenge,
  type WellnessClass,
  type WellnessClassRegistration,
  type MyPointsStatus,
  type RewardRule,
  type WellnessPointsLedgerEntry,
} from "@/lib/wellness";
import type { SectionId } from "@/lib/sections";
import { radius, spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, ScreenTitle } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

function classDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const toneColor = (colors: ReturnType<typeof useLegacyColors>) => ({
  brand: { bg: colors.brandTint, text: colors.brandPressed },
  neutral: { bg: colors.groupBg, text: colors.muted },
}) as const;
type Tone = keyof ReturnType<typeof toneColor>;

function StatusBadge({ text, tone }: { text: string; tone: Tone }) {
  const colors = useLegacyColors();
  const c = toneColor(colors)[tone];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: c.text }}>{text}</Text>
    </View>
  );
}

interface WellnessScreenProps {
  patientId: string;
  organisationId: string;
  onNavigate: (section: SectionId) => void;
}

/**
 * "Wellness rewards" — points/ledger/redeem, badges, challenges, and
 * workout classes, mirroring apps/web/.../patient/wellness/page.tsx's
 * in-scope half (the embedded Meal Log / NutritionFlow is a structurally
 * distinct AI feature, deliberately not ported here — see
 * docs/mobile-native-conversion/wellness.md). No new API routes — every
 * mutation is a plain RLS-scoped call or a SECURITY DEFINER RPC already
 * granted to authenticated.
 */
export function WellnessScreen({ patientId, organisationId, onNavigate }: WellnessScreenProps) {
  const colors = useLegacyColors();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<MyPointsStatus | null>(null);
  const [rules, setRules] = useState<RewardRule[]>([]);
  const [ledger, setLedger] = useState<WellnessPointsLedgerEntry[]>([]);
  const [pending, setPending] = useState<PendingCreditItem[]>([]);
  const [milestone, setMilestone] = useState<PendingMilestone | null>(null);
  const [badgeCatalogue, setBadgeCatalogue] = useState<WellnessBadge[]>([]);
  const [myBadges, setMyBadges] = useState<PatientWellnessBadge[]>([]);
  const [challengeCatalogue, setChallengeCatalogue] = useState<WellnessChallenge[]>([]);
  const [enrolments, setEnrolments] = useState<ChallengeEnrolment[]>([]);
  const [classes, setClasses] = useState<WellnessClass[]>([]);
  const [registrations, setRegistrations] = useState<WellnessClassRegistration[]>([]);

  const refresh = useCallback(async () => {
    const [b, rl, l, bc, mb, cc, en, cl, reg, pc, ms] = await Promise.all([
      loadMyPointsStatus(),
      loadRewardRules(),
      loadWellnessPointsLedger(patientId, 8),
      loadWellnessBadgesCatalogue(),
      loadMyWellnessBadges(patientId),
      loadWellnessChallengesCatalogue(),
      loadMyChallengeEnrolments(patientId),
      loadUpcomingWellnessClasses(),
      loadMyClassRegistrations(patientId),
      loadMyPointsPending(),
      loadMyPendingMilestone(),
    ]);
    setStatus(b);
    setRules(rl);
    setLedger(l);
    setBadgeCatalogue(bc);
    setMyBadges(mb);
    setChallengeCatalogue(cc);
    setEnrolments(en);
    setClasses(cl);
    setRegistrations(reg);
    setPending(pc);
    setMilestone((current) => ms ?? current);
  }, [patientId]);

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>Wellness rewards</ScreenTitle>
        <MutedText>
          Small, everyday habits add up. Earn points for logging, learning, and finishing challenges,
          and collect badges along the way. Points show your progress; they are not money.
        </MutedText>
      </View>

      {milestone && (
        <MilestoneCard
          milestone={milestone}
          onDismiss={() => {
            const id = milestone.id;
            setMilestone(null);
            void dismissMilestone(id);
          }}
        />
      )}

      <PointsCard
        status={status}
        rules={rules}
        ledger={ledger}
        pending={pending}
        onAskSupport={() => {
          setSupportPrefill({ subject: t("points.pending.ask_prefill_subject"), description: t("points.pending.ask_prefill_body") });
          onNavigate("technicalSupport");
        }}
      />
      <BadgesCard catalogue={badgeCatalogue} earned={myBadges} />
      <ChallengesCard catalogue={challengeCatalogue} enrolments={enrolments} onChanged={refresh} />
      <ClassesCard
        classes={classes}
        registrations={registrations}
        patientId={patientId}
        organisationId={organisationId}
        onChanged={refresh}
      />
    </ScrollView>
  );
}

/**
 * S58b. One calm card for a care step that was just done. No animation (nothing to switch off for reduced motion), no counter, no
 * comparison, no loss wording, and the database returns nothing while an emergency is open, so a red flow always comes first.
 */
function MilestoneCard({ milestone, onDismiss }: { milestone: PendingMilestone; onDismiss: () => void }) {
  const copy = milestoneCopy(milestone.code);
  return (
    <Card style={{ gap: 6 }}>
      <AppText variant="label" tone="textMuted" style={{ textTransform: "uppercase", letterSpacing: 0.3 }}>{t("points.milestone.heading")}</AppText>
      <AppText variant="bodyLargeStrong">{copy.title}</AppText>
      <MutedText>{copy.body}</MutedText>
      <PrimaryButton title={t("points.milestone.dismiss")} onPress={onDismiss} />
    </Card>
  );
}

function PendingCreditList({ items, onAskSupport }: { items: PendingCreditItem[]; onAskSupport: () => void }) {
  if (items.length === 0) return null;
  const askSupport = items.some((i) => i.ask_support);
  return (
    <View style={{ gap: 4 }}>
      <AppText variant="label" tone="textMuted" style={{ textTransform: "uppercase", letterSpacing: 0.3 }}>{t("points.pending.title")}</AppText>
      <MutedText>{t("points.pending.intro")}</MutedText>
      {items.map((item) => {
        const d = describePending(item);
        return (
          <View key={item.event_id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 3, gap: 8 }}>
            <AppText variant="body" style={{ flexShrink: 1 }}>{pendingActionLabel(item.rule_codes)}</AppText>
            <MutedText>{d.state === "expected" ? t("points.pending.expected", "en", { time: d.time }) : t("points.pending.later")}</MutedText>
          </View>
        );
      })}
      {askSupport && (
        <View style={{ gap: 6 }}>
          <MutedText>{t("points.pending.ask")}</MutedText>
          <PrimaryButton title={t("points.pending.ask_link")} onPress={onAskSupport} />
        </View>
      )}
    </View>
  );
}

function PointsCard({
  status,
  rules,
  ledger,
  pending,
  onAskSupport,
}: {
  status: MyPointsStatus | null;
  rules: RewardRule[];
  ledger: WellnessPointsLedgerEntry[];
  pending: PendingCreditItem[];
  onAskSupport: () => void;
}) {
  const colors = useLegacyColors();
  const currentBalance = status?.balance ?? 0;
  const label = { fontSize: 11, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 0.3, color: colors.muted };

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">{t("points.title")}</AppText>
      <MutedText>{t("points.subtitle")}</MutedText>

      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
        <Text style={{ fontSize: 28, fontWeight: "700", color: colors.ink }}>{currentBalance.toLocaleString()}</Text>
        <MutedText>
          {t("points.balance_unit")}
          {status?.lifetime_earned ? ` · ${t("points.earned_all_time", "en", { points: status.lifetime_earned.toLocaleString() })}` : ""}
        </MutedText>
      </View>

      <PendingCreditList items={pending} onAskSupport={onAskSupport} />

      {status && (
        <View style={{ gap: 2 }}>
          <Text style={label}>{t("points.level.title")}</Text>
          {status.is_minor || !status.tier ? (
            <MutedText>{t("points.level.adults_only")}</MutedText>
          ) : (
            <>
              <AppText variant="body">{t("points.level.current", "en", { tier: pointsTierLabel(status.tier) })}</AppText>
              {status.tier_from === "last_year" && (
                <MutedText>{t("points.level.kept", "en", { tier: pointsTierLabel(status.tier) })}</MutedText>
              )}
              {status.next_tier && status.points_to_next != null && status.points_to_next > 0 ? (
                <MutedText>{t("points.level.next", "en", { points: status.points_to_next, tier: pointsTierLabel(status.next_tier) })}</MutedText>
              ) : (
                !status.next_tier && <MutedText>{t("points.level.top")}</MutedText>
              )}
              <MutedText>{t("points.level.resets")}</MutedText>
            </>
          )}
        </View>
      )}

      {rules.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={label}>{t("points.how.title")}</Text>
          <MutedText>{t("points.how.intro")}</MutedText>
          {rules.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 3 }}>
              <AppText variant="body" style={{ flexShrink: 1 }}>
                {pointsRuleLabel(r.code)}
                {r.verified_action ? ` · ${t("points.how.verified")}` : ""}
              </AppText>
              <AppText variant="label" tone="brandText">
                {r.points_source === "catalogue" ? t("points.how.catalogue") : t("points.how.per", "en", { points: r.points })}
              </AppText>
            </View>
          ))}
          <MutedText>{t("points.how.daily_note")}</MutedText>
        </View>
      )}

      <View style={{ gap: 2 }}>
        <Text style={label}>{t("points.redeem.title")}</Text>
        <MutedText>{t("points.redeem.coming_soon")}</MutedText>
        <MutedText>{t("points.redeem.never_cash")}</MutedText>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={label}>{t("points.activity.title")}</Text>
        {ledger.length === 0 && <MutedText>{t("points.activity.empty")}</MutedText>}
        {ledger.map((entry) => (
          <View key={entry.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
            <AppText variant="body">{reasonLabel(entry.reason)}</AppText>
            <Text style={{ fontSize: 13, fontWeight: "600", color: entry.points > 0 ? colors.brandPressed : colors.muted }}>
              {entry.points > 0 ? "+" : ""}
              {entry.points}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

function BadgesCard({ catalogue, earned }: { catalogue: WellnessBadge[]; earned: PatientWellnessBadge[] }) {
  const colors = useLegacyColors();
  const earnedIds = new Set(earned.map((b) => b.badge_id));

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">Badges</AppText>
      <MutedText>
        {earned.length} of {catalogue.length} earned.
      </MutedText>
      {catalogue.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {catalogue.map((badge) => {
            const isEarned = earnedIds.has(badge.id);
            return (
              <View
                key={badge.id}
                style={{
                  flexBasis: "31%",
                  flexGrow: 1,
                  alignItems: "center",
                  gap: 4,
                  borderRadius: radius.control,
                  borderWidth: 1,
                  borderColor: isEarned ? colors.brand : colors.border,
                  backgroundColor: isEarned ? colors.brandTint : colors.groupBg,
                  padding: 10,
                  opacity: isEarned ? 1 : 0.6,
                }}
              >
                <Text style={{ fontSize: 20 }}>🏅</Text>
                <AppText variant="label" style={{ textAlign: "center" }}>{badge.name}</AppText>
                <AppText variant="caption" tone="textMuted" style={{ textAlign: "center" }}>{badge.description}</AppText>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

function ProgressBar({ value, target }: { value: number; target: number }) {
  const colors = useLegacyColors();
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <View style={{ height: 8, width: "100%", borderRadius: 999, backgroundColor: colors.groupBg, overflow: "hidden" }}>
      <View style={{ height: "100%", width: `${pct}%`, borderRadius: 999, backgroundColor: colors.brand }} />
    </View>
  );
}

function ActiveEnrolmentRow({ enrolment }: { enrolment: ChallengeEnrolment }) {
  const colors = useLegacyColors();
  const [progress, setProgress] = useState<{ progress: number; target: number } | null>(null);
  const challenge = enrolment.wellness_challenges;

  useEffect(() => {
    if (enrolment.status !== "active") return;
    loadWellnessChallengeProgress(enrolment.id)
      .then(setProgress)
      .catch(() => {});
  }, [enrolment.id, enrolment.status]);

  if (!challenge) return null;

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <AppText variant="label">{challenge.title}</AppText>
        <StatusBadge text={enrolment.status} tone={enrolment.status === "completed" ? "brand" : "neutral"} />
      </View>
      {enrolment.status === "active" && progress && (
        <View style={{ gap: 4 }}>
          <ProgressBar value={progress.progress} target={progress.target} />
          <MutedText>
            {progress.progress} of {progress.target}
          </MutedText>
        </View>
      )}
    </View>
  );
}

function ChallengesCard({
  catalogue,
  enrolments,
  onChanged,
}: {
  catalogue: WellnessChallenge[];
  enrolments: ChallengeEnrolment[];
  onChanged: () => void;
}) {
  const colors = useLegacyColors();
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeChallengeIds = new Set(enrolments.filter((e) => e.status === "active").map((e) => e.challenge_id));
  const available = catalogue.filter((c) => !activeChallengeIds.has(c.id));
  const shown = enrolments.filter((e) => e.status !== "expired");

  async function join(challengeId: string) {
    setError(null);
    setJoining(challengeId);
    const result = await enrolInWellnessChallenge(challengeId);
    setJoining(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">Challenges</AppText>
      <MutedText>Time-boxed goals that pay a points bonus when you finish.</MutedText>

      {shown.length > 0 && (
        <View style={{ gap: 8 }}>
          {shown.map((e) => (
            <ActiveEnrolmentRow key={e.id} enrolment={e} />
          ))}
        </View>
      )}

      {available.length > 0 && (
        <View style={{ gap: 8 }}>
          <AppText variant="label" tone="textMuted" style={{ textTransform: "uppercase", letterSpacing: 0.3 }}>
            Available
          </AppText>
          {available.map((challenge) => (
            <View
              key={challenge.id}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}
            >
              <View style={{ flex: 1 }}>
                <AppText variant="label">{challenge.title}</AppText>
                <MutedText>
                  {challenge.description} · {challenge.points_reward} pts
                </MutedText>
              </View>
              <AppText variant="label" tone="brandText" onPress={() => (joining ? null : join(challenge.id))} style={{ opacity: joining === challenge.id ? 0.5 : 1 }}>
                Join
              </AppText>
            </View>
          ))}
        </View>
      )}

      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}

function ClassesCard({
  classes,
  registrations,
  patientId,
  organisationId,
  onChanged,
}: {
  classes: WellnessClass[];
  registrations: WellnessClassRegistration[];
  patientId: string;
  organisationId: string;
  onChanged: () => void;
}) {
  const colors = useLegacyColors();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function register(classId: string) {
    setError(null);
    setBusyId(classId);
    const result = await registerForWellnessClass(patientId, organisationId, classId);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  async function markAttended(registrationId: string) {
    setError(null);
    setBusyId(registrationId);
    const result = await markWellnessClassAttended(registrationId);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">Workout classes &amp; health workshops</AppText>
      <MutedText>Live sessions from partner instructors and studios, coming soon in your area.</MutedText>

      {classes.length === 0 && (
        <MutedText>Nothing scheduled yet; we&apos;re working on bringing partner classes to your area.</MutedText>
      )}

      {classes.length > 0 && (
        <View style={{ gap: 8 }}>
          {classes.map((cls) => {
            const registration = registrations.find((r) => r.class_id === cls.id);
            return (
              <View
                key={cls.id}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}
              >
                <View style={{ flex: 1 }}>
                  <AppText variant="label">{cls.title}</AppText>
                  <MutedText>
                    {classDateTime(cls.starts_at)} · {cls.duration_minutes} min ·{" "}
                    {cls.class_type === "virtual" ? "Virtual" : "In person"} · {cls.points_reward} pts
                  </MutedText>
                </View>
                {!registration && (
                  <AppText variant="label" tone="brandText" onPress={() => (busyId ? null : register(cls.id))} style={{ opacity: busyId === cls.id ? 0.5 : 1 }}>
                    Register
                  </AppText>
                )}
                {registration && registration.status === "registered" && (
                  <AppText variant="label" tone="brandText" onPress={() => (busyId ? null : markAttended(registration.id))} style={{ opacity: busyId === registration.id ? 0.5 : 1 }}>
                    Mark attended
                  </AppText>
                )}
                {registration && registration.status === "attended" && <StatusBadge text="Attended" tone="brand" />}
              </View>
            );
          })}
        </View>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}
