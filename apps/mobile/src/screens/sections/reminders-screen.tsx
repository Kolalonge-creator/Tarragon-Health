import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { DAY_KEYS, daysSummary, describeUpcoming } from "@/lib/reminder-format";
import {
  DEFAULT_PREFS,
  MAX_BP_REMINDERS,
  MAX_TIMES_PER_REMINDER,
  addBpReminder,
  loadReminderPrefs,
  normaliseTime,
  removeBpReminder,
  saveReminderPrefs,
  setBpActive,
  setQuiet,
  updateBpReminder,
  type DraftError,
} from "@/lib/reminder-prefs";
import type { BpReminder, ReminderPrefs } from "@/lib/reminder-plan";
import type { PermissionState } from "@/lib/reminder-sync";
import { getNotificationPermission, syncReminders, upcomingReminders, type UpcomingReminders } from "@/lib/reminder-notifications";
import { MIN_TARGET, radii, space, useTheme } from "@/ui/design";
import { AppText, Button, Card, Field, Icon, InlineAlert, PressableScale, Screen, SegmentedControl, useToast } from "@/ui/kit";

interface Editing {
  /** Null while adding a new reminder. */
  id: string | null;
  times: string[];
  days: number[];
  timeInput: string;
}

const MORNING = "08:00";
const EVENING = "20:00";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Reminders (S07). Blood pressure reminders at times and days the patient
 * chooses, optional quiet hours, and a plain account of what is coming up.
 * Medicine reminders are not set here: they follow the medicine list and are
 * managed on the Medicines screen (S08). Everything is saved on the
 * phone and scheduled as local notifications, so it works with no signal.
 *
 * What a notification says is fixed and generic (INV-07), so nothing here lets
 * her type notification wording. Quiet hours hold blood pressure reminders only;
 * medicine reminders are never held by them, and the screen says so.
 */
export function RemindersScreen({ userId }: { userId: string }) {
  const language = asLocale(useUiLanguage());
  const tr = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => t(key, language, params),
    [language],
  );
  const toast = useToast();
  const { colors } = useTheme();
  const [prefs, setPrefs] = useState<ReminderPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [permission, setPermission] = useState<PermissionState>("undetermined");
  const [upcoming, setUpcoming] = useState<UpcomingReminders>({ items: [], coveredUntilMs: null, capped: false });
  // What is typed in the quiet-hours fields, kept apart from the saved value so a half-typed or empty field is not snapped back.
  const [quietText, setQuietText] = useState({ start: "22", end: "7" });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [errorParams, setErrorParams] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    const [perm, next] = await Promise.all([getNotificationPermission(), upcomingReminders(4)]);
    setPermission(perm);
    setUpcoming(next);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const p = await loadReminderPrefs(userId);
      if (!alive) return;
      setPrefs(p);
      if (p.quiet) setQuietText({ start: String(p.quiet.startHour), end: String(p.quiet.endHour) });
      setLoaded(true);
      void refresh();
    })();
    return () => {
      alive = false;
    };
  }, [userId, refresh]);

  /** Saves, then brings the phone's scheduled reminders in line. A failed save puts the old settings back and says so. */
  async function persist(next: ReminderPrefs, askPermission: boolean): Promise<boolean> {
    const previous = prefs;
    setPrefs(next);
    const saved = await saveReminderPrefs(userId, next);
    if (!saved) {
      setPrefs(previous);
      showError("reminders.error.save_failed");
      return false;
    }
    setErrorKey(null);
    await syncReminders({ askPermission });
    await refresh();
    return true;
  }

  function showError(key: MessageKey, params: Record<string, number> = {}) {
    setErrorKey(key);
    setErrorParams(params);
  }

  function showDraftError(error: DraftError) {
    showError(`reminders.error.${error}` as MessageKey, { max: error === "too_many_reminders" ? MAX_BP_REMINDERS : MAX_TIMES_PER_REMINDER });
  }

  function toggleTime(time: string) {
    setEditing((e) => {
      if (!e) return e;
      return { ...e, times: e.times.includes(time) ? e.times.filter((x) => x !== time) : [...e.times, time].sort() };
    });
  }

  function addTypedTime() {
    if (!editing) return;
    const time = normaliseTime(editing.timeInput);
    if (time === null) return showDraftError("bad_time");
    if (!editing.times.includes(time) && editing.times.length >= MAX_TIMES_PER_REMINDER) return showDraftError("too_many_times");
    setErrorKey(null);
    setEditing({ ...editing, times: editing.times.includes(time) ? editing.times : [...editing.times, time].sort(), timeInput: "" });
  }

  async function saveEditing() {
    if (!editing) return;
    const draft = { times: editing.times, days: editing.days };
    const result = editing.id === null ? addBpReminder(prefs, draft, newId()) : updateBpReminder(prefs, editing.id, draft);
    if (!result.ok) return showDraftError(result.error);
    // Saving a reminder is the moment to ask for notification permission, not before.
    if (await persist(result.prefs, true)) {
      setEditing(null);
      toast.show({ message: tr("reminders.saved"), tone: "success" });
    }
  }

  function startEditing(r: BpReminder | null) {
    setErrorKey(null);
    setEditing(
      r
        ? { id: r.id, times: [...r.times], days: r.days === null ? EVERY_DAY : [...r.days], timeInput: "" }
        : { id: null, times: [], days: EVERY_DAY, timeInput: "" },
    );
  }

  /** Saves quiet hours once both fields hold two different whole hours; until then the typed text stays as typed. */
  function changeQuiet(field: "start" | "end", raw: string) {
    const text = { ...quietText, [field]: raw };
    setQuietText(text);
    if (text.start.trim() === "" || text.end.trim() === "") return setErrorKey(null);
    const next = setQuiet(prefs, { startHour: Number(text.start), endHour: Number(text.end) });
    if (next === prefs) return showError("reminders.error.quiet");
    setErrorKey(null);
    void persist(next, false);
  }

  const summarise = (r: BpReminder) => {
    const d = daysSummary(r.days);
    const days = d.everyDay ? tr("reminders.bp.every_day") : d.keys.map((k) => tr(k)).join(", ");
    return `${r.times.join(", ")}. ${days}`;
  };

  const needsPermission = permission !== "granted" && prefs.bp.some((r) => r.active);

  if (!loaded) return <Screen><AppText variant="body" tone="textMuted">{tr("reminders.title")}</AppText></Screen>;

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {tr("reminders.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {tr("reminders.subtitle")}
        </AppText>
      </View>

      {needsPermission ? (
        <Card style={{ gap: space.sm }}>
          <InlineAlert
            tone={permission === "denied" ? "warn" : "info"}
            message={tr(permission === "denied" ? "reminders.permission.denied" : "reminders.permission.undetermined")}
          />
          {permission === "denied" ? (
            <Button title={tr("reminders.permission.open_settings")} variant="secondary" onPress={() => void Linking.openSettings()} />
          ) : (
            <Button
              title={tr("reminders.permission.ask")}
              variant="secondary"
              onPress={() => void syncReminders({ askPermission: true }).then(refresh)}
            />
          )}
        </Card>
      ) : null}

      {errorKey ? <InlineAlert tone="danger" message={tr(errorKey, errorParams)} /> : null}

      {/* Blood pressure reminders */}
      <Card style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("reminders.bp.title")}
        </AppText>
        {prefs.bp.length === 0 && !editing ? (
          <AppText variant="body" tone="textMuted">
            {tr("reminders.bp.empty")}
          </AppText>
        ) : null}

        {prefs.bp.map((r) => (
          <View key={r.id} style={{ gap: space.sm, paddingVertical: space.xs }}>
            <AppText variant="bodyStrong">{summarise(r)}</AppText>
            <SegmentedControl
              accessibilityLabel={summarise(r)}
              value={r.active ? "on" : "off"}
              onChange={(v) => void persist(setBpActive(prefs, r.id, v === "on"), v === "on")}
              options={[
                { value: "on", label: tr("reminders.bp.on") },
                { value: "off", label: tr("reminders.bp.off") },
              ]}
            />
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button title={tr("reminders.bp.edit")} variant="secondary" fullWidth={false} accessibilityHint={summarise(r)} onPress={() => startEditing(r)} />
              <Button
                title={tr("reminders.bp.delete")}
                variant="ghost"
                fullWidth={false}
                accessibilityHint={summarise(r)}
                onPress={() => {
                  if (editing?.id === r.id) setEditing(null);
                  void persist(removeBpReminder(prefs, r.id), false);
                }}
              />
            </View>
          </View>
        ))}

        {editing ? (
          <View style={{ gap: space.md, padding: space.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }}>
            <AppText variant="bodyStrong">{tr("reminders.bp.times")}</AppText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {[MORNING, EVENING].map((time) => (
                <PressableScale
                  key={time}
                  onPress={() => toggleTime(time)}
                  accessibilityRole="checkbox"
                  accessibilityLabel={tr(time === MORNING ? "reminders.bp.preset_morning" : "reminders.bp.preset_evening")}
                  accessibilityState={{ checked: editing.times.includes(time) }}
                  style={chip(colors, editing.times.includes(time))}
                >
                  {editing.times.includes(time) ? <Icon name="done" size={16} tone="textOnBrand" /> : null}
                  <AppText variant="body" tone={editing.times.includes(time) ? "textOnBrand" : "text"}>
                    {tr(time === MORNING ? "reminders.bp.preset_morning" : "reminders.bp.preset_evening")}
                  </AppText>
                </PressableScale>
              ))}
              {editing.times
                .filter((time) => time !== MORNING && time !== EVENING)
                .map((time) => (
                  <PressableScale
                    key={time}
                    onPress={() => toggleTime(time)}
                    accessibilityRole="button"
                    accessibilityLabel={tr("reminders.bp.remove_time", { time })}
                    style={chip(colors, true)}
                  >
                    <AppText variant="body" tone="textOnBrand">
                      {time}
                    </AppText>
                    <Icon name="close" size={16} tone="textOnBrand" />
                  </PressableScale>
                ))}
            </View>
            <Field
              label={tr("reminders.bp.time_label")}
              hint={tr("reminders.bp.time_hint")}
              keyboardType="numbers-and-punctuation"
              value={editing.timeInput}
              onChangeText={(v) => setEditing((e) => (e ? { ...e, timeInput: v } : e))}
              onSubmitEditing={addTypedTime}
            />
            <Button title={tr("reminders.bp.add_time")} variant="secondary" fullWidth={false} onPress={addTypedTime} />

            <AppText variant="bodyStrong">{tr("reminders.bp.days")}</AppText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const on = editing.days.includes(d);
                return (
                  <PressableScale
                    key={d}
                    onPress={() => setEditing((e) => (e ? { ...e, days: on ? e.days.filter((x) => x !== d) : [...e.days, d] } : e))}
                    accessibilityRole="checkbox"
                    accessibilityLabel={tr(DAY_KEYS[d] as MessageKey)}
                    accessibilityState={{ checked: on }}
                    style={chip(colors, on)}
                  >
                    {on ? <Icon name="done" size={16} tone="textOnBrand" /> : null}
                    <AppText variant="body" tone={on ? "textOnBrand" : "text"}>
                      {tr(DAY_KEYS[d] as MessageKey)}
                    </AppText>
                  </PressableScale>
                );
              })}
            </View>

            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button title={tr("reminders.bp.save")} fullWidth={false} onPress={() => void saveEditing()} />
              <Button
                title={tr("reminders.bp.cancel")}
                variant="ghost"
                fullWidth={false}
                onPress={() => {
                  setEditing(null);
                  setErrorKey(null);
                }}
              />
            </View>
          </View>
        ) : prefs.bp.length < MAX_BP_REMINDERS ? (
          <Button title={tr("reminders.bp.add")} variant="secondary" onPress={() => startEditing(null)} />
        ) : null}
      </Card>

      {/* Medicine reminders live on the Medicines screen */}
      <InlineAlert tone="info" message={tr("reminders.dose.note")} />

      {/* Quiet hours */}
      <Card style={{ gap: space.sm }}>
        <AppText variant="title" heading>
          {tr("reminders.quiet.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {tr("reminders.quiet.body")}
        </AppText>
        <SegmentedControl
          accessibilityLabel={tr("reminders.quiet.title")}
          value={prefs.quiet ? "on" : "off"}
          onChange={(v) => {
            if (v === "on") setQuietText({ start: "22", end: "7" });
            void persist(setQuiet(prefs, v === "on" ? { startHour: 22, endHour: 7 } : null), false);
          }}
          options={[
            { value: "on", label: tr("reminders.bp.on") },
            { value: "off", label: tr("reminders.bp.off") },
          ]}
        />
        {prefs.quiet ? (
          <View style={{ flexDirection: "row", gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Field
                label={tr("reminders.quiet.from")}
                keyboardType="number-pad"
                value={quietText.start}
                onChangeText={(v) => changeQuiet("start", v)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={tr("reminders.quiet.to")}
                keyboardType="number-pad"
                value={quietText.end}
                onChangeText={(v) => changeQuiet("end", v)}
              />
            </View>
          </View>
        ) : null}
      </Card>

      {/* Coming up */}
      <Card style={{ gap: space.sm }}>
        <AppText variant="title" heading>
          {tr("reminders.upcoming.title")}
        </AppText>
        {upcoming.items.length === 0 ? (
          <AppText variant="body" tone="textMuted">
            {tr("reminders.upcoming.empty")}
          </AppText>
        ) : (
          upcoming.items.map((n) => {
            const d = describeUpcoming(n);
            return (
              <AppText key={n.identifier} variant="body">
                {tr("reminders.upcoming.line", {
                  kind: tr("reminders.kind.bp"),
                  date: `${tr(d.weekdayKey)} ${d.date}`,
                  time: d.time,
                })}
              </AppText>
            );
          })
        )}
      </Card>

      {upcoming.capped && upcoming.coveredUntilMs !== null ? (
        <InlineAlert
          tone="info"
          message={tr("reminders.coverage", {
            date: (() => {
              const d = describeUpcoming({ identifier: "", notifyAtMs: upcoming.coveredUntilMs, dueAtMs: upcoming.coveredUntilMs });
              return `${tr(d.weekdayKey)} ${d.date}`;
            })(),
          })}
        />
      ) : null}

      {Platform.OS === "android" ? (
        <Card style={{ gap: space.sm }}>
          <AppText variant="title" heading>
            {tr("reminders.android.title")}
          </AppText>
          <AppText variant="body" tone="textMuted">
            {tr("reminders.android.body")}
          </AppText>
          <Button title={tr("reminders.permission.open_settings")} variant="secondary" onPress={() => void Linking.openSettings()} />
        </Card>
      ) : null}
    </Screen>
  );
}

function chip(colors: ReturnType<typeof useTheme>["colors"], selected: boolean) {
  return {
    minHeight: MIN_TARGET,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: selected ? colors.brand : colors.border,
    backgroundColor: selected ? colors.brand : colors.surface,
  };
}
