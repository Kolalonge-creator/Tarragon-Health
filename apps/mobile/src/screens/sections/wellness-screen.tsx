import { useCallback, useEffect, useState } from "react";
import { t, pointsTierLabel, pointsRuleLabel } from "@tarragon/i18n";
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
import { Card, ErrorText, MutedText, ScreenTitle } from "@/ui/legacy-kit";

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
export function WellnessScreen({ patientId, organisationId }: WellnessScreenProps) {
  const colors = useLegacyColors();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<MyPointsStatus | null>(null);
  const [rules, setRules] = useState<RewardRule[]>([]);
  const [ledger, setLedger] = useState<WellnessPointsLedgerEntry[]>([]);
  const [badgeCatalogue, setBadgeCatalogue] = useState<WellnessBadge[]>([]);
  const [myBadges, setMyBadges] = useState<PatientWellnessBadge[]>([]);
  const [challengeCatalogue, setChallengeCatalogue] = useState<WellnessChallenge[]>([]);
  const [enrolments, setEnrolments] = useState<ChallengeEnrolment[]>([]);
  const [classes, setClasses] = useState<WellnessClass[]>([]);
  const [registrations, setRegistrations] = useState<WellnessClassRegistration[]>([]);

  const refresh = useCallback(async () => {
    const [b, rl, l, bc, mb, cc, en, cl, reg] = await Promise.all([
      loadMyPointsStatus(),
      loadRewardRules(),
      loadWellnessPointsLedger(patientId, 8),
      loadWellnessBadgesCatalogue(),
      loadMyWellnessBadges(patientId),
      loadWellnessChallengesCatalogue(),
      loadMyChallengeEnrolments(patientId),
      loadUpcomingWellnessClasses(),
      loadMyClassRegistrations(patientId),
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

      <PointsCard status={status} rules={rules} ledger={ledger} />
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

function PointsCard({
  status,
  rules,
  ledger,
}: {
  status: MyPointsStatus | null;
  rules: RewardRule[];
  ledger: WellnessPointsLedgerEntry[];
}) {
  const colors = useLegacyColors();
  const currentBalance = status?.balance ?? 0;
  const label = { fontSize: 11, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 0.3, color: colors.muted };

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("points.title")}</Text>
      <MutedText>{t("points.subtitle")}</MutedText>

      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
        <Text style={{ fontSize: 28, fontWeight: "700", color: colors.ink }}>{currentBalance.toLocaleString()}</Text>
        <MutedText>
          {t("points.balance_unit")}
          {status?.lifetime_earned ? ` · ${t("points.earned_all_time", "en", { points: status.lifetime_earned.toLocaleString() })}` : ""}
        </MutedText>
      </View>

      {status && (
        <View style={{ gap: 2 }}>
          <Text style={label}>{t("points.level.title")}</Text>
          {status.is_minor || !status.tier ? (
            <MutedText>{t("points.level.adults_only")}</MutedText>
          ) : (
            <>
              <Text style={{ fontSize: 13, color: colors.ink }}>{t("points.level.current", "en", { tier: pointsTierLabel(status.tier) })}</Text>
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
              <Text style={{ fontSize: 13, color: colors.ink, flexShrink: 1 }}>
                {pointsRuleLabel(r.code)}
                {r.verified_action ? ` · ${t("points.how.verified")}` : ""}
              </Text>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.brandPressed }}>
                {r.points_source === "catalogue" ? t("points.how.catalogue") : t("points.how.per", "en", { points: r.points })}
              </Text>
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
            <Text style={{ fontSize: 13, color: colors.ink }}>{reasonLabel(entry.reason)}</Text>
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
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Badges</Text>
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
                <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.ink, textAlign: "center" }}>{badge.name}</Text>
                <Text style={{ fontSize: 10.5, color: colors.muted, textAlign: "center" }}>{badge.description}</Text>
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
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{challenge.title}</Text>
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
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Challenges</Text>
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
          <Text style={{ fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, color: colors.muted }}>
            Available
          </Text>
          {available.map((challenge) => (
            <View
              key={challenge.id}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{challenge.title}</Text>
                <MutedText>
                  {challenge.description} · {challenge.points_reward} pts
                </MutedText>
              </View>
              <Text
                onPress={() => (joining ? null : join(challenge.id))}
                style={{ fontSize: 12.5, fontWeight: "700", color: colors.brandPressed, opacity: joining === challenge.id ? 0.5 : 1 }}
              >
                Join
              </Text>
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
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Workout classes &amp; health workshops</Text>
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
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{cls.title}</Text>
                  <MutedText>
                    {classDateTime(cls.starts_at)} · {cls.duration_minutes} min ·{" "}
                    {cls.class_type === "virtual" ? "Virtual" : "In person"} · {cls.points_reward} pts
                  </MutedText>
                </View>
                {!registration && (
                  <Text
                    onPress={() => (busyId ? null : register(cls.id))}
                    style={{ fontSize: 12.5, fontWeight: "700", color: colors.brandPressed, opacity: busyId === cls.id ? 0.5 : 1 }}
                  >
                    Register
                  </Text>
                )}
                {registration && registration.status === "registered" && (
                  <Text
                    onPress={() => (busyId ? null : markAttended(registration.id))}
                    style={{ fontSize: 12.5, fontWeight: "700", color: colors.brandPressed, opacity: busyId === registration.id ? 0.5 : 1 }}
                  >
                    Mark attended
                  </Text>
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
