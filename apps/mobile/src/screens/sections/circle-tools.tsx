import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { asLocale, circleToolsCanKey, circleToolsSeesKey, circleToolsTaskKindKey, t } from "@tarragon/i18n";
import { CIRCLE_TASK_KINDS, permissionsForPreset, presetOfPermissions, previewForPermissions, type CirclePresetChoice } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { loadDigest, loadNudges, loadTasks, loadToolsStatus, postTask, taskAction, type TaskAction } from "@/lib/care-circle/api";
import { TOOLS_OFF, type CirclePermission, type CircleDigest, type CircleNudge, type CircleTaskList, type ToolsStatus } from "@/lib/care-circle/parse";
import { useLegacyColors } from "@/ui/design";
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
      {p.sees.map((c) => <Text key={c} style={{ color: colors.ink }}>{`• ${t(circleToolsSeesKey(c), locale)}`}</Text>)}
      {p.can.length > 0 ? <AppText variant="bodyStrong">{t(invitee ? "cctools.preview.can.invitee" : "cctools.preview.can", locale)}</AppText> : null}
      {p.can.map((c) => <Text key={c} style={{ color: colors.ink }}>{`• ${t(circleToolsCanKey(c), locale)}`}</Text>)}
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

/** Shared jobs for one person's circle. Renders nothing while the module is off or the read fails. No free text, no chat. */
export function TasksCard({ patientId, tools }: { patientId: string; tools: ToolsStatus }) {
  const locale = asLocale(useUiLanguage());
  const [list, setList] = useState<CircleTaskList | null>(null);
  const [kind, setKind] = useState<string>(CIRCLE_TASK_KINDS[0]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"taken" | "limit" | "error" | null>(null);
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
  async function add() {
    setBusy(true);
    setMessage(null);
    const r = await postTask(patientId, kind, null);
    setBusy(false);
    if (!r.ok) setMessage(r.limit ? "limit" : "error");
    await refresh();
  }
  const canPost = list.role === "patient" || list.role === "helper";
  return (
    <Card style={{ gap: 8 }}>
      <AppText variant="bodyStrong" accessibilityRole="header">{t("cctools.tasks.title", locale)}</AppText>
      <MutedText>{t("cctools.tasks.intro", locale)}</MutedText>
      {list.role === "viewer" ? <AppText variant="body">{t("cctools.tasks.view_only", locale)}</AppText> : null}
      {list.tasks.length === 0 ? <MutedText>{t("cctools.tasks.empty", locale)}</MutedText> : null}
      {list.tasks.map((task) => (
        <View key={task.taskId} style={{ gap: 4, paddingVertical: 6 }}>
          <AppText variant="bodyStrong">{t(circleToolsTaskKindKey(task.kind), locale)}</AppText>
          <MutedText>
            {`${task.neededBy ? `${t("cctools.tasks.needed_by", locale, { date: lagosDate(task.neededBy) })}. ` : ""}${
              task.state === "done" ? t("cctools.tasks.state.done", locale)
              : task.state === "claimed" ? (task.mine ? t("cctools.tasks.state.claimed_mine", locale) : t("cctools.tasks.state.claimed_other", locale, { name: task.claimedByName ?? "Someone" }))
              : t("cctools.tasks.state.open", locale)}`}
          </MutedText>
          {task.canClaim ? <PrimaryButton title={t("cctools.tasks.claim", locale)} disabled={busy} onPress={() => void run("claim_circle_task", task.taskId)} /> : null}
          {task.canRelease ? <SecondaryButton title={t("cctools.tasks.release", locale)} disabled={busy} onPress={() => void run("release_circle_task", task.taskId)} /> : null}
          {task.canComplete ? <PrimaryButton title={t("cctools.tasks.complete", locale)} disabled={busy} onPress={() => void run("complete_circle_task", task.taskId)} /> : null}
          {task.canCancel ? <SecondaryButton title={t("cctools.tasks.cancel", locale)} disabled={busy} onPress={() => void run("cancel_circle_task", task.taskId)} /> : null}
        </View>
      ))}
      {canPost ? (
        <View style={{ gap: 6 }}>
          <AppText variant="bodyStrong">{t("cctools.tasks.kind", locale)}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {CIRCLE_TASK_KINDS.map((k) => (
              <SecondaryButton key={k} title={`${kind === k ? "● " : ""}${t(circleToolsTaskKindKey(k), locale)}`} onPress={() => setKind(k)} />
            ))}
          </View>
          <PrimaryButton title={t("cctools.tasks.post", locale)} disabled={busy} onPress={() => void add()} />
        </View>
      ) : null}
      {message ? <ErrorText>{t(message === "limit" ? "cctools.tasks.limit" : message === "taken" ? "cctools.tasks.taken" : "cctools.tasks.error", locale)}</ErrorText> : null}
    </Card>
  );
}

/** A short weekly note for a supporter, built by the database from the permissions held. Nothing while off. */
export function DigestCard({ patientId, tools }: { patientId: string; tools: ToolsStatus }) {
  const colors = useLegacyColors();
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
      {lines.length === 0 ? <AppText variant="body">{t("cctools.digest.empty", locale)}</AppText> : lines.map((l) => <Text key={l} style={{ color: colors.ink }}>{l}</Text>)}
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
