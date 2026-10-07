import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { resolveTakenTime, isDoubleTap, lagosLocalDate, slotKey, windowEndTime, type AdherenceResult, type ReminderIssue, type SlotState } from "@tarragon/medicines";
import { useUiLanguage } from "@/lib/ui-language";
import {
  dosesOn,
  loadTodaysDoses,
  loadWeeklyAdherence,
  logDose,
  sendHeldDoses,
  statusForTakenAt,
  undoDose,
  type DoseChecklistItem,
  type LoggableStatus,
} from "@/lib/medications";
import { cancelSnooze, checkReminderHealth, replanDoseReminders, sendTestReminder, snoozeDose, type ReplanResult } from "@/lib/dose-reminders";
import { loadAdherenceBand, loadMedicineRules } from "@/lib/medicines-config";
import { loadReminderBehaviour } from "@/lib/s07-config";
import { space, useTheme } from "@/ui/design";
import { AppText, Badge, Button, Card, EmptyState, InlineAlert, LegacySheet, ListItem, Screen, Skeleton, SkeletonGroup, useToast } from "@/ui/kit";
import { SyncBanner } from "@/screens/sync-banner";
import { MedicineCabinetScreen } from "@/screens/sections/medicine-cabinet-screen";
import { CareChangeCard } from "@/screens/sections/care-change-card";

interface MedicationsScreenProps {
  patientId: string;
  organisationId: string;
  /** Set to the supported person's name when acting for someone
   * (home-shell.tsx), so the heading never implies these are the device
   * owner's own doses while marking somebody else's. */
  subjectName?: string;
}

/** Matches the slot key the reminder plan uses (medication, Lagos date, time), so snoozes and replans agree and yesterday's open dose never collides with today's. */
const doseKey = (item: DoseChecklistItem) => slotKey(item.medicationId, { date: item.date ?? "", time: item.time });

const STATE_LABEL: Record<SlotState, MessageKey> = {
  upcoming: "meds.state.upcoming",
  due: "meds.state.due",
  taken: "meds.state.taken",
  late: "meds.state.late",
  skipped: "meds.state.skipped",
  missed: "meds.state.missed",
  unavailable: "meds.state.unavailable",
};

const ANSWERED: readonly SlotState[] = ["taken", "late", "skipped", "unavailable"];

const EARLIER_MINUTES = [10, 30, 60, 120, 240] as const;

const SKIP_REASONS: { key: MessageKey; status: LoggableStatus; reason: string }[] = [
  { key: "meds.skip.side_effect", status: "skipped", reason: "side_effect" },
  { key: "meds.skip.felt_well", status: "skipped", reason: "felt_well" },
  { key: "meds.skip.ran_out", status: "not_available", reason: "ran_out" },
  { key: "meds.skip.other", status: "skipped", reason: "other" },
];

const ISSUE_TEXT: Record<ReminderIssue, MessageKey> = {
  notifications_off: "meds.reminder_health.notifications_off",
  exact_alarms_off: "meds.reminder_health.exact_alarms_off",
  nothing_scheduled: "meds.reminder_health.nothing_scheduled",
  plan_out_of_date: "meds.reminder_health.plan_out_of_date",
  maker_may_stop_reminders: "meds.reminder_health.maker",
};

/** "08:00", or "08:00 to 10:00" for a flexible window. */
function windowLabel(item: DoseChecklistItem, tr: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  const minutes = item.windowMinutes ?? 0;
  if (minutes <= 0) return item.time;
  return tr("meds.window.range", { start: item.time, end: windowEndTime(item.time, minutes) });
}

function stateOf(item: DoseChecklistItem): SlotState {
  return item.state ?? (item.status === "taken" ? "taken" : item.status === "skipped" ? "skipped" : item.status === "missed" ? "missed" : "upcoming");
}

function badgeTone(state: SlotState): "neutral" | "positive" | "warn" {
  if (state === "taken" || state === "late") return "positive";
  if (state === "due" || state === "missed") return "warn";
  return "neutral";
}

export function MedicationsScreen({ patientId, organisationId, subjectName }: MedicationsScreenProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const rules = loadMedicineRules();
  const missedAfterMinutes = loadReminderBehaviour().missedAfterMinutes;
  const windowDays = loadAdherenceBand().windowDays;

  const [doses, setDoses] = useState<DoseChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed dose fetch must never render as "No scheduled doses today": that
  // reads as a clinical fact. loadError renders an explicit retry state.
  const [loadError, setLoadError] = useState(false);
  const [cabinetOpen, setCabinetOpen] = useState(false);
  // medication_logs is append-only: each tap is its own permanent row, so a
  // rapid double-tap must not log twice. The guard ignores a second tap that
  // lands inside doubleTapGuardMs, and one row at a time per dose.
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const lastTap = useRef<Map<string, number>>(new Map());
  const [rowErrors, setRowErrors] = useState<Set<string>>(new Set());
  // Doses logged here and held on the phone for the undo window.
  const [held, setHeld] = useState<Map<string, { clientId: string; untilMs: number }>>(new Map());
  const [now, setNow] = useState(Date.now());
  const [panel, setPanel] = useState<{ key: string; kind: "earlier" | "skip" | "change" } | null>(null);
  const [panelNote, setPanelNote] = useState<string | null>(null);
  const [adherence, setAdherence] = useState<AdherenceResult | null>(null);
  const [issues, setIssues] = useState<ReminderIssue[]>([]);

  const ownsReminders = !subjectName;

  const refreshSide = useCallback(
    async (replanned?: ReplanResult) => {
      const week = await loadWeeklyAdherence(patientId);
      setAdherence(week.ok ? week.data : null);
      if (ownsReminders) setIssues(await checkReminderHealth(patientId, Date.now(), replanned));
    },
    [patientId, ownsReminders]
  );

  const load = useCallback(async () => {
    const result = await loadTodaysDoses(patientId);
    if (!result.ok) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setDoses(result.data);
    // The screen is something the patient opened, so it may ask for notification permission.
    const replanned = ownsReminders ? await replanDoseReminders(patientId, Date.now(), { prompt: true }) : undefined;
    await refreshSide(replanned);
  }, [patientId, ownsReminders, refreshSide]);

  useEffect(() => {
    load()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [load]);

  // One clock tick a second while any dose is inside its undo window; when the
  // window ends the held rows are released to the sync.
  useEffect(() => {
    if (held.size === 0) return;
    const timer = setInterval(() => {
      const t0 = Date.now();
      setNow(t0);
      const expired = [...held.entries()].filter(([, h]) => h.untilMs <= t0);
      if (expired.length > 0) {
        setHeld((prev) => {
          const next = new Map(prev);
          for (const [k] of expired) next.delete(k);
          return next;
        });
        void sendHeldDoses();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [held]);

  function retryLoad() {
    setLoading(true);
    load()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  function setState(key: string, status: DoseChecklistItem["status"], state: SlotState) {
    setDoses((prev) => prev.map((d) => (doseKey(d) === key ? { ...d, status, state } : d)));
  }

  async function record(item: DoseChecklistItem, status: LoggableStatus, opts: { atMs?: number; reason?: string } = {}) {
    const key = doseKey(item);
    const t0 = Date.now();
    if (pendingKeys.has(key) || isDoubleTap(lastTap.current.get(key) ?? null, t0, rules.doubleTapGuardMs)) return;
    lastTap.current.set(key, t0);
    setPendingKeys((prev) => new Set(prev).add(key));
    setPanel(null);
    setPanelNote(null);
    setRowErrors((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

    const before = { status: item.status, state: stateOf(item) };
    const nextState: SlotState =
      status === "delayed" ? "late" : status === "taken" ? "taken" : status === "not_available" ? "unavailable" : status === "skipped" ? "skipped" : "missed";
    // Optimistic: this is the highest-frequency native write in the app.
    setState(key, status === "delayed" ? "taken" : status === "not_available" ? "skipped" : (status as DoseChecklistItem["status"]), nextState);
    try {
      const result = await logDose(patientId, organisationId, item, status, {
        recordedAt: opts.atMs ? new Date(opts.atMs).toISOString() : undefined,
        reason: opts.reason ?? null,
        hold: true,
      });
      if (result.error) {
        setRowErrors((prev) => new Set(prev).add(key));
        setState(key, before.status, before.state);
      } else {
        if (result.clientId && result.heldUntilMs) {
          setHeld((prev) => new Map(prev).set(key, { clientId: result.clientId!, untilMs: result.heldUntilMs! }));
          setNow(Date.now());
        }
        await cancelSnooze(key);
        const replanned = ownsReminders ? await replanDoseReminders(patientId) : undefined;
        void refreshSide(replanned);
      }
    } catch {
      setRowErrors((prev) => new Set(prev).add(key));
      setState(key, before.status, before.state);
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function takeNow(item: DoseChecklistItem) {
    const at = Date.now();
    await record(item, item.dueAtMs ? statusForTakenAt(item.dueAtMs, at, item.closeMinutes) : "taken");
  }

  async function takenEarlier(item: DoseChecklistItem, minutesAgo: number) {
    const at = Date.now() - minutesAgo * 60_000;
    const check = resolveTakenTime(at, Date.now(), rules.backdateWindowHours, rules.futureSkewMinutes);
    if (!check.ok) {
      setPanelNote(tr("meds.earlier.too_old"));
      return;
    }
    await record(item, item.dueAtMs ? statusForTakenAt(item.dueAtMs, check.atMs, item.closeMinutes) : "taken", { atMs: check.atMs });
  }

  async function undo(item: DoseChecklistItem) {
    const key = doseKey(item);
    const h = held.get(key);
    if (!h) return;
    const removed = await undoDose(h.clientId);
    setHeld((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    if (removed) {
      // Back to the clock's answer: due, or upcoming, or missed.
      const due = item.dueAtMs ?? 0;
      const t0 = Date.now();
      setState(key, "pending", t0 < due ? "upcoming" : t0 < due + (item.closeMinutes ?? missedAfterMinutes) * 60_000 ? "due" : "missed");
      toast.show({ message: tr("meds.undo.done"), tone: "info" });
      const replanned = ownsReminders ? await replanDoseReminders(patientId) : undefined;
      void refreshSide(replanned);
    } else {
      toast.show({ message: tr("meds.undo.too_late"), tone: "warn" });
    }
  }

  async function remindLater(item: DoseChecklistItem) {
    const res = await snoozeDose(doseKey(item));
    if (res.ok) toast.show({ message: tr("meds.snooze.done", { minutes: res.minutes }), tone: "info" });
    else toast.show({ message: tr(res.reason === "limit" ? "meds.snooze.limit" : "meds.snooze.failed"), tone: "info" });
  }

  async function testReminder() {
    const ok = await sendTestReminder();
    toast.show({ message: tr(ok ? "meds.reminder_health.test_sent" : "meds.reminder_health.test_failed"), tone: ok ? "info" : "warn" });
  }

  // The progress card is about today; a dose still open from last night is on the list but not counted in it.
  const todays = dosesOn(doses, lagosLocalDate(Date.now()));
  const answeredCount = todays.filter((d) => ANSWERED.includes(stateOf(d)) && stateOf(d) !== "unavailable").length;
  const takenCount = todays.filter((d) => stateOf(d) === "taken" || stateOf(d) === "late").length;

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {subjectName ? tr("meds.title.for", { name: subjectName }) : tr("meds.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {subjectName ? tr("meds.subtitle.for", { name: subjectName }) : tr("meds.subtitle")}
        </AppText>
      </View>

      <SyncBanner />

      {/* A change is the patient's own yes, so it is not shown while acting for someone else. */}
      {ownsReminders ? <CareChangeCard /> : null}

      {ownsReminders && issues.length > 0 ? (
        <Card style={{ gap: space.sm }}>
          <AppText variant="bodyStrong">{tr("meds.reminder_health.title")}</AppText>
          {issues.map((issue) => (
            <InlineAlert key={issue} tone="info" message={tr(ISSUE_TEXT[issue])} />
          ))}
          <AppText variant="caption" tone="textMuted">
            {tr("meds.reminder_health.list_still_right")}
          </AppText>
          <Button title={tr("meds.reminder_health.open_settings")} variant="secondary" onPress={() => void Linking.openSettings()} />
          <Button title={tr("meds.reminder_health.send_test")} variant="ghost" onPress={() => void testReminder()} />
        </Card>
      ) : null}

      <View style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("meds.doses.heading")}
        </AppText>

        {loading ? (
          <SkeletonGroup label={tr("meds.loading")}>
            <Card style={{ gap: space.lg }}>
              <Skeleton height={20} width="45%" />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </Card>
          </SkeletonGroup>
        ) : loadError ? (
          <Card style={{ gap: space.md }}>
            <InlineAlert tone="info" message={`${tr("meds.load_error.title")}. ${tr("meds.load_error.body")}`} />
            <Button title={tr("meds.load_error.retry")} variant="secondary" onPress={retryLoad} />
          </Card>
        ) : doses.length === 0 ? (
          <Card>
            <EmptyState icon="medication" title={tr("meds.empty.title")} body={tr("meds.empty.body")} />
          </Card>
        ) : (
          <>
            <Card style={{ gap: space.xs }}>
              <AppText variant="bodyStrong" accessibilityLiveRegion="polite">
                {tr("meds.progress", { taken: takenCount, total: todays.length })}
              </AppText>
              <AppText variant="caption" tone="textMuted">
                {tr("meds.progress.answered", { answered: answeredCount, total: todays.length })}
              </AppText>
            </Card>

            <Card padded={false}>
              {doses.map((item, index) => {
                const key = doseKey(item);
                const state = stateOf(item);
                const answered = ANSWERED.includes(state);
                const h = held.get(key);
                const canUndo = h !== undefined && now < h.untilMs;
                const open = panel?.key === key ? panel.kind : null;
                const showActions = !answered || open === "change";
                return (
                  <View
                    key={key}
                    style={[{ padding: space.lg, gap: space.sm }, index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="bodyStrong">{item.drugName}</AppText>
                        <AppText variant="caption" tone="textMuted">
                          {[windowLabel(item, tr), item.doseText ?? item.doseLabel ?? null, item.foodNote ? tr(`meds.food.${item.foodNote}` as MessageKey) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </AppText>
                        {item.date && item.date < lagosLocalDate(Date.now()) ? (
                          <AppText variant="caption" tone="textMuted">
                            {tr("meds.window.from_yesterday")}
                          </AppText>
                        ) : null}
                        {item.origin === "prescription" ? (
                          <AppText variant="caption" tone="textMuted">
                            {tr("meds.source.prescription")}
                          </AppText>
                        ) : null}
                      </View>
                      <Badge label={tr(STATE_LABEL[state])} tone={badgeTone(state)} />
                    </View>

                    {state === "missed" ? (
                      <AppText variant="caption" tone="textMuted">
                        {tr("meds.missed.hint")}
                      </AppText>
                    ) : null}

                    {canUndo ? (
                      <Button
                        title={tr("meds.action.undo")}
                        variant="secondary"
                        fullWidth={false}
                        onPress={() => void undo(item)}
                        accessibilityHint={tr("meds.action.undo_hint")}
                      />
                    ) : null}

                    {answered && !open && !canUndo ? (
                      <Button title={tr("meds.action.change")} variant="ghost" fullWidth={false} onPress={() => setPanel({ key, kind: "change" })} />
                    ) : null}

                    {showActions && open !== "earlier" && open !== "skip" ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                        <Button title={tr("meds.action.taken")} fullWidth={false} disabled={pendingKeys.has(key)} onPress={() => void takeNow(item)} />
                        <Button title={tr("meds.action.earlier")} variant="secondary" fullWidth={false} onPress={() => setPanel({ key, kind: "earlier" })} />
                        <Button title={tr("meds.action.skip")} variant="secondary" fullWidth={false} onPress={() => setPanel({ key, kind: "skip" })} />
                        {state === "due" || state === "upcoming" ? (
                          <Button title={tr("meds.action.later")} variant="ghost" fullWidth={false} onPress={() => void remindLater(item)} />
                        ) : null}
                      </View>
                    ) : null}

                    {open === "earlier" ? (
                      <View style={{ gap: space.sm }}>
                        <AppText variant="bodyStrong">{tr("meds.earlier.title")}</AppText>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                          {EARLIER_MINUTES.map((m) => (
                            <Button
                              key={m}
                              title={m < 60 ? tr("meds.earlier.minutes_ago", { minutes: m }) : tr("meds.earlier.hours_ago", { hours: m / 60 })}
                              variant="secondary"
                              fullWidth={false}
                              onPress={() => void takenEarlier(item, m)}
                            />
                          ))}
                        </View>
                        {panelNote ? <InlineAlert tone="info" message={panelNote} /> : null}
                        <Button title={tr("common.cancel")} variant="ghost" fullWidth={false} onPress={() => setPanel(null)} />
                      </View>
                    ) : null}

                    {open === "skip" ? (
                      <View style={{ gap: space.sm }}>
                        <AppText variant="bodyStrong">{tr("meds.skip.title")}</AppText>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                          {SKIP_REASONS.map((r) => (
                            <Button
                              key={r.reason}
                              title={tr(r.key)}
                              variant="secondary"
                              fullWidth={false}
                              onPress={() => void record(item, r.status, { reason: r.reason })}
                            />
                          ))}
                        </View>
                        <Button title={tr("common.cancel")} variant="ghost" fullWidth={false} onPress={() => setPanel(null)} />
                      </View>
                    ) : null}

                    {rowErrors.has(key) ? (
                      <AppText variant="caption" tone="dangerText">
                        {tr("meds.row.error")}
                      </AppText>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </>
        )}
      </View>

      {adherence ? (
        <Card style={{ gap: space.xs }}>
          <AppText variant="bodyStrong">{tr("meds.adherence.heading")}</AppText>
          {adherence.percent === null ? (
            <AppText variant="body" tone="textMuted">
              {tr("meds.adherence.not_enough")}
            </AppText>
          ) : (
            <>
              <AppText variant="body">{tr("meds.adherence.value", { percent: adherence.percent, days: windowDays })}</AppText>
              <AppText variant="caption" tone="textMuted">
                {tr("meds.adherence.counts", { taken: adherence.taken + adherence.late, skipped: adherence.skipped + adherence.unavailable, missed: adherence.missed })}
              </AppText>
              {adherence.belowThreshold ? (
                <AppText variant="caption" tone="textMuted">
                  {tr("meds.adherence.support")}
                </AppText>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      <Card padded={false}>
        <ListItem
          icon="medication"
          title={tr("meds.cabinet.title")}
          subtitle={tr("meds.cabinet.subtitle")}
          onPress={() => setCabinetOpen(true)}
          accessibilityHint={tr("meds.cabinet.a11y_hint")}
        />
      </Card>

      {/* The cabinet adds, edits and stops medicines on its own copy of the list; Today's doses and the
          reminder plan are read again when it closes, so a medicine added there shows up here at once. */}
      <LegacySheet
        visible={cabinetOpen}
        onClose={() => {
          setCabinetOpen(false);
          load().catch(() => setLoadError(true));
        }}
        closeLabel={tr("kit.close")} forceLight={false}>
        <MedicineCabinetScreen patientId={patientId} organisationId={organisationId} />
      </LegacySheet>
    </Screen>
  );
}
