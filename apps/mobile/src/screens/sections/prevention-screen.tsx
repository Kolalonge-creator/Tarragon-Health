import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import {
  CONDITION_LABEL,
  confirmScreeningDone,
  daysLabel,
  declineScreening,
  getAnalyteTrends,
  getRiskScores,
  getScreeningSchedules,
  getVaccinationRecords,
  getVaccinationSchedules,
  type AnalyteTrendItem,
  type RiskScoreItem,
  type RiskTierValue,
  type ScreeningItem,
  type VaccinationDueItem,
  type VaccinationRecordItem,
} from "@/lib/prevention";
import { todayIsoDate } from "@/lib/medications";
import { colors, radius, spacing } from "@/ui/theme";
import { Card, ErrorText, GroupedList, GroupedListRow, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/components";

interface PreventionScreenProps {
  /** The subject whose prevention record this is — the acting-for subject's
   * id, matching what the web page reads from getPatientDashboardContext(). */
  patientId: string;
  /** Passed straight to confirmScreeningDone to skip its own profiles
   * lookup — HomeShell already has this on hand for every section. */
  organisationId?: string;
}

/** Clinical-status tones (green/amber/red/grey — a separate system from
 * brand colour, per CLAUDE.md), literal hexes mirroring the web badge
 * palette rather than ui/theme.ts's brand tokens — same convention as
 * bp-classification.ts's BP_LEVEL_COLORS. */
const TONE = {
  green: { bg: "#DCFCE7", text: "#15803D" },
  amber: { bg: "#FEF3C7", text: "#B45309" },
  red: { bg: "#FEE2E2", text: "#B91C1C" },
  blue: { bg: "#DBEAFE", text: "#1D4ED8" },
  grey: { bg: "#EEEEEC", text: "#57534E" },
} as const;

const TIER_TONE: Record<RiskTierValue, keyof typeof TONE> = {
  low: "green",
  moderate: "amber",
  high: "red",
  very_high: "red",
  unknown: "grey",
};

const TIER_LABEL: Record<RiskTierValue, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
  unknown: "Unknown",
};

type ScheduleStatus = ScreeningItem["status"] | VaccinationDueItem["status"];

const STATUS_TONE: Record<ScheduleStatus, keyof typeof TONE> = {
  pending: "amber",
  booked: "blue",
  completed: "green",
  overdue: "red",
  cancelled: "grey",
  declined: "grey",
};

const STATUS_LABEL: Record<ScheduleStatus, string> = {
  pending: "Pending",
  booked: "Booked",
  completed: "Completed",
  overdue: "Overdue",
  cancelled: "Cancelled",
  declined: "Declined",
};

function StatusBadge({ status, overdue }: { status: ScheduleStatus; overdue?: boolean }) {
  const effective = overdue ? "overdue" : status;
  const tone = TONE[STATUS_TONE[effective]];
  return (
    <View style={{ backgroundColor: tone.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: tone.text }}>{STATUS_LABEL[effective]}</Text>
    </View>
  );
}

function humanizeFactor(factor: string): string {
  return factor.split("_").join(" ");
}

/** Loose YYYY-MM-DD check, not a full calendar validation — mirrors the
 * lightweight entry-time gating vitals-screen.tsx uses (typo gating, not a
 * clinical rule). Rejects a future date since a screening can't have been
 * performed ahead of today. */
function parseIsoDateInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  if (Number.isNaN(Date.parse(trimmed))) return null;
  if (trimmed > todayIsoDate()) return null;
  return trimmed;
}

interface SectionState<T> {
  data: T | null;
  error: string | null;
}

const EMPTY_SECTION = { data: null, error: null } as const;

export function PreventionScreen({ patientId, organisationId }: PreventionScreenProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [risk, setRisk] = useState<SectionState<RiskScoreItem[]>>(EMPTY_SECTION);
  const [screenings, setScreenings] = useState<SectionState<ScreeningItem[]>>(EMPTY_SECTION);
  const [vaccDue, setVaccDue] = useState<SectionState<VaccinationDueItem[]>>(EMPTY_SECTION);
  const [vaccHistory, setVaccHistory] = useState<SectionState<VaccinationRecordItem[]>>(EMPTY_SECTION);
  const [trends, setTrends] = useState<SectionState<AnalyteTrendItem[]>>(EMPTY_SECTION);

  const [actionTarget, setActionTarget] = useState<{ item: ScreeningItem; mode: "confirm" | "decline" } | null>(null);
  const [performedDateInput, setPerformedDateInput] = useState(todayIsoDate());
  const [note, setNote] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [actionSaving, setActionSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionDoneLabel, setActionDoneLabel] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [riskRes, screeningsRes, vaccDueRes, vaccHistoryRes, trendsRes] = await Promise.all([
      getRiskScores(patientId),
      getScreeningSchedules(patientId),
      getVaccinationSchedules(patientId),
      getVaccinationRecords(patientId),
      getAnalyteTrends(patientId),
    ]);
    setRisk(riskRes.ok ? { data: riskRes.data, error: null } : { data: null, error: riskRes.error });
    setScreenings(
      screeningsRes.ok ? { data: screeningsRes.data, error: null } : { data: null, error: screeningsRes.error }
    );
    setVaccDue(vaccDueRes.ok ? { data: vaccDueRes.data, error: null } : { data: null, error: vaccDueRes.error });
    setVaccHistory(
      vaccHistoryRes.ok ? { data: vaccHistoryRes.data, error: null } : { data: null, error: vaccHistoryRes.error }
    );
    setTrends(trendsRes.ok ? { data: trendsRes.data, error: null } : { data: null, error: trendsRes.error });
  }, [patientId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  function openAction(item: ScreeningItem, mode: "confirm" | "decline") {
    setActionTarget({ item, mode });
    setPerformedDateInput(todayIsoDate());
    setNote("");
    setDeclineReason("");
    setActionError(null);
    setActionDoneLabel(null);
  }

  function closeAction() {
    setActionTarget(null);
  }

  async function handleActionSave() {
    if (!actionTarget) return;
    const { item, mode } = actionTarget;

    if (mode === "confirm") {
      const performedDate = parseIsoDateInput(performedDateInput);
      if (!performedDate) {
        setActionError("Enter the date as YYYY-MM-DD. It can't be in the future.");
        return;
      }
      setActionSaving(true);
      setActionError(null);
      const result = await confirmScreeningDone(
        patientId,
        { scheduleId: item.id, screenTypeId: item.screenTypeId, performedDate, note: note || undefined },
        organisationId
      );
      setActionSaving(false);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setActionDoneLabel(`Marked as done for ${performedDate}. Your next one is scheduled from that date.`);
    } else {
      if (!declineReason.trim()) {
        setActionError("Let us know why (e.g. already had this elsewhere, not applicable to me).");
        return;
      }
      setActionSaving(true);
      setActionError(null);
      const result = await declineScreening(patientId, item.id, declineReason);
      setActionSaving(false);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setActionDoneLabel("Noted — we won't keep asking about this one.");
    }
    await load();
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const today = todayIsoDate();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 18 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
    >
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Prevention</Text>
        <MutedText>
          Screenings, vaccinations, and the risk tiers that keep a healthy person healthy.
        </MutedText>
      </View>

      {/* Risk tiers */}
      <View style={{ gap: 10 }}>
        <SectionLabel>Your risk tiers</SectionLabel>
        {risk.error ? (
          <Card>
            <ErrorText>Could not load your risk assessment.</ErrorText>
          </Card>
        ) : !risk.data || risk.data.length === 0 ? (
          <Card>
            <MutedText>
              Complete the risk assessment on the full app to see your personal risk tiers — a
              starting point for your care, not a diagnosis.
            </MutedText>
          </Card>
        ) : (
          <GroupedList>
            {risk.data.map((score) => {
              const tone = TONE[TIER_TONE[score.tier]];
              const isUnknown = score.tier === "unknown";
              const detail = isUnknown
                ? "Not enough information yet to assess this. It isn't the same as being low risk."
                : score.forcedByExistingDiagnosis
                  ? "Based on a diagnosis you already told us about."
                  : score.factors.length > 0
                    ? `Because: ${score.factors.map(humanizeFactor).join(", ")}.`
                    : "No major risk factors noted right now.";
              return (
                <GroupedListRow
                  key={score.id}
                  title={CONDITION_LABEL[score.condition]}
                  subtitle={detail}
                  trailing={
                    <View style={{ backgroundColor: tone.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: tone.text }}>
                        {isUnknown ? "Unknown" : TIER_LABEL[score.tier]}
                      </Text>
                    </View>
                  }
                />
              );
            })}
          </GroupedList>
        )}
      </View>

      {/* Screening calendar */}
      <View style={{ gap: 10 }}>
        <SectionLabel>Screening calendar</SectionLabel>
        {screenings.error ? (
          <Card>
            <ErrorText>Could not load your screening calendar.</ErrorText>
          </Card>
        ) : !screenings.data || screenings.data.length === 0 ? (
          <Card>
            <MutedText>
              No screenings scheduled yet. Once your risk assessment and history are on file, your
              personal calendar builds itself.
            </MutedText>
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            {screenings.data.map((item) => {
              const canDecline = item.status === "pending" || item.status === "booked" || item.status === "overdue";
              return (
                <Card key={item.id} style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ flex: 1, fontSize: 14.5, fontWeight: "600", color: colors.ink }}>
                      {item.screenTypeName}
                    </Text>
                    <StatusBadge status={item.status} overdue={item.isOverdue} />
                  </View>
                  <MutedText>Due {item.dueDate}</MutedText>
                  {item.isRecall && item.recallReason ? (
                    <MutedText>Your care team asked you to repeat this: {item.recallReason}</MutedText>
                  ) : null}
                  {item.status === "declined" && item.declinedReason ? (
                    <MutedText>You declined this: {item.declinedReason}</MutedText>
                  ) : null}
                  {canDecline ? (
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <SecondaryButton title="I've done this test" onPress={() => openAction(item, "confirm")} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <SecondaryButton title="Not right for me" onPress={() => openAction(item, "decline")} />
                      </View>
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        )}
        <MutedText>
          Getting a due test done itself opens in the full app or web, where you can request a lab
          note to take to any lab you like. This screen lets you confirm one is already done.
        </MutedText>
      </View>

      {/* Vaccinations due */}
      <View style={{ gap: 10 }}>
        <SectionLabel>Vaccinations due</SectionLabel>
        {vaccDue.error ? (
          <Card>
            <ErrorText>Could not load your vaccination schedule.</ErrorText>
          </Card>
        ) : !vaccDue.data || vaccDue.data.length === 0 ? (
          <Card>
            <MutedText>Nothing due right now.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {vaccDue.data.map((item) => (
              <GroupedListRow
                key={item.id}
                title={item.name}
                subtitle={`Due ${item.dueDate} (${daysLabel(item.dueDate)})`}
                trailing={<StatusBadge status={item.status} overdue={item.status === "overdue" || item.dueDate < today} />}
              />
            ))}
          </GroupedList>
        )}
      </View>

      {/* Vaccination history */}
      <View style={{ gap: 10 }}>
        <SectionLabel>Vaccination history</SectionLabel>
        {vaccHistory.error ? (
          <Card>
            <ErrorText>Could not load your vaccination history.</ErrorText>
          </Card>
        ) : !vaccHistory.data || vaccHistory.data.length === 0 ? (
          <Card>
            <MutedText>No vaccinations logged yet.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {vaccHistory.data.map((record) => (
              <GroupedListRow
                key={record.id}
                title={record.name}
                subtitle={`Dose ${record.doseNumber} · ${record.dateAdministered}`}
                trailing="none"
              />
            ))}
          </GroupedList>
        )}
      </View>

      {/* Results over time */}
      <View style={{ gap: 10 }}>
        <SectionLabel>Your results over time</SectionLabel>
        {trends.error ? (
          <Card>
            <ErrorText>Could not load your lab results.</ErrorText>
          </Card>
        ) : !trends.data || trends.data.length === 0 ? (
          <Card>
            <MutedText>No lab results on file yet.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {trends.data.map((trend) => {
              const delta = trend.previousValue !== null ? trend.latestValue - trend.previousValue : null;
              const deltaLabel =
                delta === null
                  ? null
                  : delta === 0
                    ? "no change"
                    : `${delta > 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta * 100) / 100)} since last test`;
              return (
                <GroupedListRow
                  key={trend.code}
                  title={trend.label}
                  subtitle={new Date(trend.latestTakenAt).toLocaleDateString("en-GB", {
                    timeZone: "Africa/Lagos",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  trailing={
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>
                        {trend.latestValue}
                        {trend.latestUnit ? ` ${trend.latestUnit}` : ""}
                      </Text>
                      {deltaLabel ? <Text style={{ fontSize: 11.5, color: colors.faint }}>{deltaLabel}</Text> : null}
                    </View>
                  }
                />
              );
            })}
          </GroupedList>
        )}
        <MutedText>Each result, compared with your previous one — for tracking, not diagnosis.</MutedText>
      </View>

      <Modal visible={actionTarget !== null} animationType="slide" transparent onRequestClose={closeAction}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              padding: spacing.screen,
              gap: 12,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>
              {actionTarget?.item.screenTypeName ?? "Screening"}
            </Text>
            {actionDoneLabel ? (
              <>
                <Text style={{ fontSize: 13.5, color: colors.brand, lineHeight: 19 }}>{actionDoneLabel}</Text>
                <SecondaryButton title="Close" onPress={closeAction} />
              </>
            ) : actionTarget?.mode === "confirm" ? (
              <>
                <MutedText>What date was this test actually done?</MutedText>
                <TextInput
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.faint}
                  value={performedDateInput}
                  onChangeText={setPerformedDateInput}
                  style={{
                    height: 42,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.control,
                    paddingHorizontal: 12,
                    fontSize: 14,
                    color: colors.ink,
                  }}
                />
                <TextInput
                  placeholder="Note (optional): e.g. which lab"
                  placeholderTextColor={colors.faint}
                  value={note}
                  onChangeText={setNote}
                  style={{
                    height: 42,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.control,
                    paddingHorizontal: 12,
                    fontSize: 14,
                    color: colors.ink,
                  }}
                />
                {actionError ? <ErrorText>{actionError}</ErrorText> : null}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <SecondaryButton title="Cancel" onPress={closeAction} disabled={actionSaving} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton title="Confirm completed" onPress={handleActionSave} loading={actionSaving} />
                  </View>
                </View>
              </>
            ) : (
              <>
                <MutedText>Let us know why (e.g. already had this elsewhere, not applicable to me).</MutedText>
                <TextInput
                  placeholder="Reason"
                  placeholderTextColor={colors.faint}
                  value={declineReason}
                  onChangeText={setDeclineReason}
                  multiline
                  numberOfLines={2}
                  style={{
                    minHeight: 60,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.control,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    fontSize: 14,
                    color: colors.ink,
                    textAlignVertical: "top",
                  }}
                />
                {actionError ? <ErrorText>{actionError}</ErrorText> : null}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <SecondaryButton title="Cancel" onPress={closeAction} disabled={actionSaving} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton title="Confirm decline" onPress={handleActionSave} loading={actionSaving} />
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
