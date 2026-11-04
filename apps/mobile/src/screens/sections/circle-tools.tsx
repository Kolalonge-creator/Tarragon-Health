import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, TextInput, View } from "react-native";
import { asLocale, circleToolsCanKey, circleToolsSeesKey, circleToolsTaskKindKey, t, type MessageKey } from "@tarragon/i18n";
import { CIRCLE_TASK_KINDS, CIRCLE_TASK_NOTE_MAX, permissionsForPreset, presetOfPermissions, previewForPermissions, type CirclePresetChoice } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { loadDigest, loadNudges, loadTasks, loadToolsStatus, postTask, taskAction, type TaskAction } from "@/lib/care-circle/api";
import { taskAnswerKey, toggleRecipient } from "@/lib/care-circle/tasks";
import { TOOLS_OFF, type CircleMember, type CirclePermission, type CircleDigest, type CircleNudge, type CircleTaskList, type ToolsStatus } from "@/lib/care-circle/parse";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/** Which tools are on, read once. A failed read is "all off". */
export function useToolsStatus(): ToolsStatus {
  const [status, setStatus] = useState<ToolsStatus>(TOOLS_OFF);
  useEffect(() => {
    let alive = true;
    void loadToolsStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

/** The plain-language promise, built from the real permission list (S69b). Same lines as the web. */
export function PermissionSummary({ permissions, audience, name }: { permissions: readonly string[]; audience: "sender" | "invitee"; name?: string }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const p = previewForPermissions(permissions);
  const invitee = audience === "invitee";
  const empty = p.sees.length === 0 && p.can.length === 0;
  return (
    <View accessibilityLabel={t(invitee ? "cctools.preview.title.invitee" : "cctools.preview.title.sender", locale)} style={{ gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12 }}>
      <AppText variant="bodyStrong" accessibilityRole="header">{t(invitee ? "cctools.preview.title.invitee" : "cctools.preview.title.sender", locale)}</AppText>
      {empty ? <MutedText>{t("cctools.preview.none", locale)}</MutedText> : null}
      {p.sees.length > 0 ? <AppText variant="bodyStrong">{t(invitee ? "cctools.preview.sees.invitee" : "cctools.preview.sees", locale)}</AppText> : null}
      {p.sees.map((c) => <AppText variant="body" key={c}>{`• ${t(circleToolsSeesKey(c), locale)}`}</AppText>)}
      {p.can.length > 0 ? <AppText variant="bodyStrong">{t(invitee ? "cctools.preview.can.invitee" : "cctools.preview.can", locale)}</AppText> : null}
      {p.can.map((c) => <AppText variant="body" key={c}>{`• ${t(circleToolsCanKey(c), locale)}`}</AppText>)}
      {empty ? null : <AppText variant="body">{t("cctools.preview.never", locale)}</AppText>}
      <MutedText>{invitee ? t("cctools.preview.control.invitee", locale, { name: name ?? "They" }) : t("cctools.preview.control.sender", locale)}</MutedText>
    </View>
  );
}

/** Two named presets over the existing permissions, plus "choose one by one" (the switches stay on screen under it). */
export function PresetPicker({ value, onChange }: { value: readonly CirclePermission[]; onChange: (next: CirclePermission[]) => void }) {
  const locale = asLocale(useUiLanguage());
  const current: CirclePresetChoice = presetOfPermissions(value);
  const options = [
    { choice: "see", title: "cctools.preset.see.title", body: "cctools.preset.see.body" },
    { choice: "see_and_help", title: "cctools.preset.help.title", body: "cctools.preset.help.body" },
    { choice: "custom", title: "cctools.preset.custom.title", body: "cctools.preset.custom.body" },
  ] as const;
  return (
    <View accessibilityRole="radiogroup" style={{ gap: 6 }}>
      <AppText variant="bodyStrong">{t("cctools.preset.legend", locale)}</AppText>
      {options.map((o) => (
        <Pressable
          key={o.choice}
          accessibilityRole="radio"
          accessibilityState={{ selected: current === o.choice }}
          accessibilityLabel={t(o.title, locale)}
          onPress={() => {
            if (o.choice !== "custom") onChange(permissionsForPreset(o.choice) as CirclePermission[]);
          }}
          style={{ minHeight: 44, paddingVertical: 6 }}
        >
          <AppText variant="bodyStrong">{`${current === o.choice ? "● " : "○ "}${t(o.title, locale)}`}</AppText>
          <MutedText>{t(o.body, locale)}</MutedText>
        </Pressable>
      ))}
    </View>
  );
}

type TaskMessage = "taken" | "limit" | "error" | "note_needed";
const TASK_MESSAGE_KEYS = {
  taken: "cctools.tasks.taken", limit: "cctools.tasks.limit", error: "cctools.tasks.error", note_needed: "cctools.tasks.note_needed",
} as const satisfies Record<TaskMessage, MessageKey>;

/**
 * Help requests inside one person's circle (S69b shared jobs, extended by Care Circle P3), the twin of the web CircleTasksPanel. A fixed
 * list of kinds and (the patient only, founder decision D4) a short note and a choice of who it is for. Nothing here is an emergency
 * route. The database decides who may do what and sends a flag per request, so this screen never works it out itself. Renders nothing
 * while the module is off or the read fails. `members` is the patient's own circle (only used when the caller is the patient).
 */
export function TasksCard({ patientId, tools, members = [] }: { patientId: string; tools: ToolsStatus; members?: readonly CircleMember[] }) {
  const locale = asLocale(useUiLanguage());
  const inputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [list, setList] = useState<CircleTaskList | null>(null);
  const [kind, setKind] = useState<string>(CIRCLE_TASK_KINDS[0]);
  const [note, setNote] = useState("");
  const [to, setTo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<TaskMessage | null>(null);
  const refresh = useCallback(async () => setList(await loadTasks(patientId)), [patientId]);
  useEffect(() => {
    if (tools.tasks) void refresh();
  }, [tools.tasks, refresh]);
  if (!tools.tasks || !list) return null;

  async function run(action: TaskAction, taskId: string) {
    setBusy(true);
    setMessage(null);
    const ok = await taskAction(action, taskId);
    setBusy(false);
    if (ok === null) setMessage("error");
    else if (!ok && action === "claim_circle_task") setMessage("taken");
    await refresh();
  }
  const isPatient = list.role === "patient";
  async function add() {
    setMessage(null);
    if (isPatient && kind === "other" && !note.trim()) {
      setMessage("note_needed");
      return;
    }
    setBusy(true);
    const r = await postTask(patientId, kind, null, isPatient ? { recipients: to, note } : {});
    setBusy(false);
    if (r.ok) {
      setNote("");
      setTo([]);
    } else setMessage(r.reason === "limit" ? "limit" : r.reason === "note_needed" ? "note_needed" : "error");
    await refresh();
  }
  const canPost = isPatient || list.role === "helper";
  const anyAnswerable = list.tasks.some((x) => x.canClaim || x.canDecline);
  // a helper cannot write a note, so "Something else" (which needs one) is offered to the patient only
  const kinds = isPatient ? CIRCLE_TASK_KINDS : CIRCLE_TASK_KINDS.filter((k) => k !== "other");
  return (
    <Card style={{ gap: 8 }}>
      <AppText variant="bodyStrong" accessibilityRole="header">{t("cctools.tasks.title", locale)}</AppText>
      <MutedText>{t("cctools.tasks.intro", locale)}</MutedText>
      {list.role === "viewer" && !anyAnswerable ? <AppText variant="body">{t("cctools.tasks.view_only", locale)}</AppText> : null}
      {list.tasks.length === 0 ? <MutedText>{t("cctools.tasks.empty", locale)}</MutedText> : null}
      {list.tasks.map((task) => (
        <View key={task.taskId} style={{ gap: 4, paddingVertical: 6 }}>
          <AppText variant="bodyStrong">
            {t(circleToolsTaskKindKey(task.kind), locale)}
            {task.addressed && !task.recipients ? ` · ${t("cctools.tasks.for_you", locale)}` : ""}
          </AppText>
          {task.note ? <AppText variant="body">{task.note}</AppText> : null}
          <MutedText>
            {`${task.neededBy ? `${t("cctools.tasks.needed_by", locale, { date: lagosDate(task.neededBy) })}. ` : ""}${
              task.state === "done" ? t("cctools.tasks.state.done", locale)
              : task.state === "claimed" ? (task.mine ? t("cctools.tasks.state.claimed_mine", locale) : t("cctools.tasks.state.claimed_other", locale, { name: task.claimedByName ?? "Someone" }))
              : t("cctools.tasks.state.open", locale)}`}
          </MutedText>
          {/* the patient sees each named person's answer */}
          {/* names are not unique, so each line is keyed by position */}
          {task.recipients?.map((r, i) => <AppText variant="body" key={`${i}-${r.name}`}>{t(taskAnswerKey(r.answer), locale, { name: r.name })}</AppText>)}
          {task.myAnswer === "cannot_help" ? <AppText variant="body">{t("cctools.tasks.declined_mine", locale)}</AppText> : null}
          {task.canClaim ? <PrimaryButton title={t("cctools.tasks.claim", locale)} disabled={busy} onPress={() => void run("claim_circle_task", task.taskId)} /> : null}
          {task.canDecline ? <SecondaryButton title={t("cctools.tasks.decline", locale)} disabled={busy} onPress={() => void run("decline_circle_task", task.taskId)} /> : null}
          {task.canRelease ? <SecondaryButton title={t("cctools.tasks.release", locale)} disabled={busy} onPress={() => void run("release_circle_task", task.taskId)} /> : null}
          {task.canComplete ? <PrimaryButton title={t("cctools.tasks.complete", locale)} disabled={busy} onPress={() => void run("complete_circle_task", task.taskId)} /> : null}
          {task.canCancel ? <SecondaryButton title={t("cctools.tasks.cancel", locale)} disabled={busy} onPress={() => void run("cancel_circle_task", task.taskId)} /> : null}
        </View>
      ))}
      {canPost ? (
        <View style={{ gap: 6 }}>
          <AppText variant="bodyStrong">{t("cctools.tasks.kind", locale)}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {kinds.map((k) => (
              <SecondaryButton key={k} title={`${kind === k ? "● " : ""}${t(circleToolsTaskKindKey(k), locale)}`} onPress={() => { setKind(k); setMessage(null); }} />
            ))}
          </View>
          {/* P3: only the patient chooses who a request is for and writes a note (D4). Nobody ticked = everyone who helps, as before. */}
          {isPatient && members.length > 0 ? (
            <View style={{ gap: 4 }}>
              <AppText variant="bodyStrong">{t("cctools.tasks.who", locale)}</AppText>
              <MutedText>{to.length === 0 ? t("cctools.tasks.who_everyone", locale) : t("cctools.tasks.who_hint", locale)}</MutedText>
              {members.map((m) => {
                const label = `${m.name} (${m.relationship})`;
                return (
                  <View key={m.memberId} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 }}>
                    <Switch accessibilityLabel={label} value={to.includes(m.memberId)} disabled={busy} onValueChange={() => setTo((cur) => toggleRecipient(cur, m.memberId))} />
                    <AppText variant="body" style={{ flex: 1 }}>{label}</AppText>
                  </View>
                );
              })}
            </View>
          ) : null}
          {isPatient ? (
            <View style={{ gap: 4 }}>
              <AppText variant="bodyStrong">{t("cctools.tasks.note", locale)}</AppText>
              <TextInput
                accessibilityLabel={t("cctools.tasks.note", locale)}
                accessibilityHint={t("cctools.tasks.note_hint", locale)}
                keyboardAppearance={scheme}
                placeholderTextColor={placeholderColorFor(scheme)}
                value={note}
                onChangeText={(v) => { setNote(v); if (message === "note_needed") setMessage(null); }}
                maxLength={CIRCLE_TASK_NOTE_MAX}
                multiline
                style={inputStyle}
              />
              <MutedText>{t("cctools.tasks.note_hint", locale)}</MutedText>
            </View>
          ) : null}
          <PrimaryButton title={t("cctools.tasks.post", locale)} disabled={busy} onPress={() => void add()} />
        </View>
      ) : null}
      {message ? <ErrorText>{t(TASK_MESSAGE_KEYS[message], locale)}</ErrorText> : null}
    </Card>
  );
}

/** A short weekly note for a supporter, built by the database from the permissions held. Nothing while off. */
export function DigestCard({ patientId, tools }: { patientId: string; tools: ToolsStatus }) {
  const locale = asLocale(useUiLanguage());
  const [digest, setDigest] = useState<CircleDigest | null>(null);
  useEffect(() => {
    if (!tools.digest) return;
    let alive = true;
    void loadDigest(patientId).then((d) => {
      if (alive) setDigest(d);
    });
    return () => {
      alive = false;
    };
  }, [patientId, tools.digest]);
  if (!tools.digest || !digest) return null;
  const lines: string[] = [];
  if (digest.doses && digest.doses.daysWithDoses > 0) lines.push(t("cctools.digest.doses", locale, { name: digest.name, done: digest.doses.daysAllTaken, total: digest.doses.daysWithDoses }));
  if (digest.readings) lines.push(t("cctools.digest.readings", locale, { name: digest.name, days: digest.readings.daysLogged, span: digest.days }));
  if (digest.nextAppointmentAt) lines.push(t("cctools.digest.next_appointment", locale, { date: lagosDate(digest.nextAppointmentAt) }));
  if (digest.tasks && (digest.tasks.open > 0 || digest.tasks.claimed > 0 || digest.tasks.done > 0)) lines.push(t("cctools.digest.tasks", locale, { open: digest.tasks.open, claimed: digest.tasks.claimed, done: digest.tasks.done }));
  return (
    <Card style={{ gap: 6 }}>
      <AppText variant="bodyStrong" accessibilityRole="header">{t("cctools.digest.title", locale)}</AppText>
      <MutedText>{t("cctools.digest.note", locale, { name: digest.name })}</MutedText>
      {lines.length === 0 ? <AppText variant="body">{t("cctools.digest.empty", locale)}</AppText> : lines.map((l) => <AppText variant="body" key={l}>{l}</AppText>)}
    </Card>
  );
}

/** The people a gentle nudge was sent about: a first name and nothing else. */
export function NudgesCard({ tools, onOpen }: { tools: ToolsStatus; onOpen?: (patientId: string) => void }) {
  const locale = asLocale(useUiLanguage());
  const [rows, setRows] = useState<CircleNudge[]>([]);
  useEffect(() => {
    if (!tools.missedDose) return;
    let alive = true;
    void loadNudges().then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [tools.missedDose]);
  if (!tools.missedDose || rows.length === 0) return null;
  return (
    <Card style={{ gap: 6 }}>
      <AppText variant="bodyStrong" accessibilityRole="header">{t("cctools.nudges.title", locale)}</AppText>
      {rows.map((r) => (
        <Pressable key={r.patientId} accessibilityRole="button" onPress={() => onOpen?.(r.patientId)} style={{ minHeight: 44, justifyContent: "center" }}>
          <AppText variant="body">{t("cctools.nudges.line", locale, { name: r.name })}</AppText>
        </Pressable>
      ))}
    </Card>
  );
}
