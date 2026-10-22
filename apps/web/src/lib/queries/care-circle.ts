import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  inviteMadeSchema,
  parseAccept,
  parseDeclined,
  parseDigest,
  parseNudges,
  parseTasks,
  parseToolsStatus,
  parseCheckInPending,
  parseCheckInRequest,
  parseMyCircle,
  parseGiftResult,
  attentionCount,
  isMissingFunction,
  parseOpenAlerts,
  parseUnanswered,
  parsePendingGifts,
  parsePreview,
  parsePreviewView,
  pauseResultSchema,
  renewSchema,
  type AlertMode,
  parseSupported,
  parseSupporterView,
  parseViewLog,
  type CirclePermission,
} from "@/lib/care-circle/model";

export const circleKeys = {
  mine: ["care-circle", "mine"] as const,
  log: ["care-circle", "log"] as const,
  supported: ["care-circle", "supported"] as const,
  alerts: ["care-circle", "alerts"] as const,
  gifts: ["care-circle", "gifts"] as const,
  view: (patientId: string) => ["care-circle", "view", patientId] as const,
};

export class CircleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircleError";
  }
}

export function useMyCircle() {
  return useQuery({
    queryKey: circleKeys.mine,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_care_circle");
      if (error) throw new CircleError(error.message);
      return parseMyCircle(data);
    },
  });
}

export function useCircleViewLog() {
  return useQuery({
    queryKey: circleKeys.log,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_view_log", { p_limit: 30 });
      if (error) throw new CircleError(error.message);
      return parseViewLog(data);
    },
  });
}

export function useSupportedPeople() {
  return useQuery({
    queryKey: circleKeys.supported,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_supported_people");
      if (error) throw new CircleError(error.message);
      return parseSupported(data);
    },
  });
}

/** A supporter's open alerts. Polled lightly: the push and the in-app inbox are the fast path, this is the page showing it. */
export function useOpenAlerts() {
  return useQuery({
    queryKey: circleKeys.alerts,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_open_alerts");
      if (error) throw new CircleError(error.message);
      return parseOpenAlerts(data);
    },
  });
}

/** One call, one read: the database sends only the blocks the supporter was given. An ended access is `null`, not an error. */
export function useSupporterView(patientId: string) {
  return useQuery({
    queryKey: circleKeys.view(patientId),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_supporter_view", { p_patient: patientId });
      if (error) {
        if (error.message.includes("circle_not_found")) return null;
        throw new CircleError(error.message);
      }
      return parseSupporterView(data);
    },
    retry: false,
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: "phone" | "email"; contact: string; relationship: string; permissions: CirclePermission[]; days: number }) => {
      const { data, error } = await createClient().rpc("create_care_circle_invite", {
        p_kind: input.kind,
        p_contact: input.contact,
        p_relationship: input.relationship,
        p_permissions: input.permissions,
        p_grant_days: input.days,
      });
      if (error) throw new CircleError(error.message);
      const parsed = inviteMadeSchema.safeParse(data);
      if (!parsed.success) throw new CircleError("unknown");
      return parsed.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: circleKeys.mine }),
  });
}

export function useCancelInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await createClient().rpc("cancel_care_circle_invite", { p_invite: inviteId });
      if (error) throw new CircleError(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: circleKeys.mine }),
  });
}

/** One tap: another year from today, never shorter than the access already has. The server does the date arithmetic. */
export function useRenewMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { data, error } = await createClient().rpc("renew_care_circle_member", { p_member: memberId });
      if (error) throw new CircleError(error.message);
      const r = renewSchema.safeParse(data);
      if (!r.success || !r.data.ok) throw new CircleError("unknown");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: circleKeys.mine }),
  });
}

/** Pause all sharing for the configured days. `pauseAlerts` also holds back the check-in requests (the patient chooses). */
export function usePauseCircle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pauseAlerts: boolean) => {
      const { data, error } = await createClient().rpc("pause_care_circle", { p_pause_alerts: pauseAlerts });
      if (error) throw new CircleError(error.message);
      if (!pauseResultSchema.safeParse(data).success) throw new CircleError("unknown");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: circleKeys.mine }),
  });
}

export function useResumeCircle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await createClient().rpc("resume_care_circle");
      if (error) throw new CircleError(error.message);
      if (data !== true) throw new CircleError("unknown");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: circleKeys.mine }),
  });
}

/** What a supporter sees right now, for a member already in the circle. Fetched only when the patient asks; never a logged look. */
export function usePreviewMember(memberId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["care-circle", "preview-member", memberId] as const,
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_preview_member", { p_member: memberId });
      if (error) throw new CircleError(error.message);
      const v = parsePreviewView(data);
      if (!v) throw new CircleError("unknown");
      return v;
    },
  });
}

/** What these choices would show, before anyone is invited. */
export function usePreviewPermissions(permissions: readonly CirclePermission[], relationship: string, enabled: boolean) {
  return useQuery({
    queryKey: ["care-circle", "preview-permissions", [...permissions].sort().join(","), relationship] as const,
    enabled: enabled && permissions.length > 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_preview_permissions", { p_permissions: [...permissions], p_relationship: relationship });
      if (error) throw new CircleError(error.message);
      const v = parsePreviewView(data);
      if (!v) throw new CircleError("unknown");
      return v;
    },
  });
}

export function useSetAlertMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { patientId: string; mode: AlertMode }) => {
      const { data, error } = await createClient().rpc("set_circle_alert_mode", { p_patient: input.patientId, p_mode: input.mode });
      if (error) throw new CircleError(error.message);
      if (data !== true) throw new CircleError("unknown");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: circleKeys.supported }),
  });
}

/** "I called them": one status, no text. */
export function useAckAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patientId: string) => {
      const { data, error } = await createClient().rpc("circle_ack_alert", { p_patient: patientId });
      if (error) throw new CircleError(error.message);
      if (data !== true) throw new CircleError("unknown");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: circleKeys.alerts }),
  });
}

/** S75 A5: the patient's switch for sharing the monthly report with one supporter. Off by default. */
export function useSetMonthlyShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { memberId: string; on: boolean }) => {
      const { error } = await createClient().rpc("set_circle_monthly_report_share", { p_member: input.memberId, p_on: input.on });
      if (error) throw new CircleError(error.message);
    },
    // the preview shows the monthly block only when this is on, so a cached preview must not be shown as current
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["care-circle"] }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { memberId: string; permissions: CirclePermission[]; expiresAt?: string }) => {
      const { data, error } = await createClient().rpc("update_care_circle_member", {
        p_member: input.memberId,
        p_permissions: input.permissions,
        ...(input.expiresAt ? { p_expires_at: input.expiresAt } : {}),
      });
      if (error) throw new CircleError(error.message);
      if (data !== true) throw new CircleError("unknown");
    },
    // a changed permission changes what the preview shows, so a cached preview must not be shown as current
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: circleKeys.mine });
      void qc.invalidateQueries({ queryKey: ["care-circle", "preview-member"] });
    },
  });
}

/** The patient removes a member, or a supporter leaves. Both are this one call; the database allows exactly those two people. */
export function useRevokeMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await createClient().rpc("revoke_care_circle_member", { p_member: memberId });
      if (error) throw new CircleError(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["care-circle"] }),
  });
}

export function usePreviewInvite(token: string) {
  return useQuery({
    queryKey: ["care-circle", "preview", token],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("preview_care_circle_invite", { p_token: token });
      if (error) return parsePreview(null);
      return parsePreview(data);
    },
    retry: false,
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await createClient().rpc("accept_care_circle_invite", { p_token: token });
      if (error) return parseAccept(null);
      return parseAccept(data);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["care-circle"] }),
  });
}

/** Care packs or Memberships someone else paid for, waiting for this patient's yes (S29b). */
export function usePendingGifts() {
  return useQuery({
    queryKey: circleKeys.gifts,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_pending_gifts");
      if (error) throw new CircleError(error.message);
      return parsePendingGifts(data);
    },
  });
}

export function useRespondToGift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entitlementId: string; accept: boolean }) => {
      const { data, error } = await createClient().rpc("respond_to_gifted_pack", { p_entitlement: input.entitlementId, p_accept: input.accept });
      if (error) throw new CircleError(error.message);
      const result = parseGiftResult(data);
      if (result === "other") throw new CircleError("unknown");
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: circleKeys.gifts });
      void qc.invalidateQueries({ queryKey: ["commerce"] });
    },
  });
}

/**
 * S29e: whether the patient-first check-in window is open at all. A failed read is an ERROR (retried), never "closed": the supporter's
 * button needs `data === true`, so it never appears by accident, while the patient's answer path keeps working until the read says closed.
 */
export function useCheckInEnabled() {
  return useQuery({
    queryKey: ["care-circle", "checkin-enabled"] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_checkin_window_enabled");
      if (error) throw new CircleError(error.message);
      return data === true;
    },
  });
}

/** A supporter asks a person to check in. The patient is told first; the circle only if they do not answer in time. */
export function useRequestCheckIn() {
  return useMutation({
    mutationFn: async (patientId: string) => {
      const { data, error } = await createClient().rpc("request_circle_check_in", { p_patient: patientId });
      if (error) throw new CircleError(error.message);
      const parsed = parseCheckInRequest(data);
      if (!parsed) throw new CircleError("unknown");
      return parsed;
    },
  });
}

/** The patient: is a question from someone in my circle waiting? Polled lightly, and only while the go-live is on. */
export function useCheckInPending() {
  const enabled = useCheckInEnabled();
  return useQuery({
    queryKey: ["care-circle", "checkin-pending"] as const,
    refetchInterval: 20_000,
    // fail open for the patient: only a clear "closed" stops the poll, so one failed read of the go-live can never hide the answer button
    enabled: enabled.data !== false,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_check_in_pending");
      if (error) throw new CircleError(error.message);
      return parseCheckInPending(data);
    },
  });
}

/** Returns whether the answer landed on a question that was still waiting. False means it had already ended (the circle may have been told). */
export function useRespondCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await createClient().rpc("respond_to_circle_check_in");
      if (error) throw new CircleError(error.message);
      return data === true;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["care-circle", "checkin-pending"] }),
  });
}

/** A supporter's people who did not answer a check-in lately: the actionable half of the "has not answered" notice. */
export function useUnansweredCheckIns() {
  return useQuery({
    queryKey: ["care-circle", "unanswered"] as const,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_unanswered_check_ins");
      if (isMissingFunction(error)) return [];
      if (error) throw new CircleError(error.message);
      return parseUnanswered(data);
    },
  });
}

/** "I called them" on a person who did not answer a check-in: one tap, no text, private to this supporter. */
export function useAckUnanswered() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patientId: string) => {
      const { data, error } = await createClient().rpc("circle_ack_unanswered", { p_patient: patientId });
      if (error) throw new CircleError(error.message);
      if (data !== true) throw new CircleError("unknown");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["care-circle", "unanswered"] }),
  });
}

/**
 * The "People you support" badge, live: the server draws the first value, this keeps it current on every navigation and every minute
 * (the server layout does not re-render on client-side navigation). A failed read leaves the last value and never shows a lower one.
 */
export function useSupportingAttention(enabled: boolean) {
  return useQuery({
    queryKey: ["care-circle", "attention"] as const,
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const client = createClient();
      const [alerts, unanswered] = await Promise.all([client.rpc("circle_open_alerts"), client.rpc("circle_unanswered_check_ins")]);
      const unansweredError = isMissingFunction(unanswered.error) ? null : unanswered.error;
      if (alerts.error || unansweredError) throw new CircleError((alerts.error ?? unansweredError)?.message ?? "unknown");
      return attentionCount(parseOpenAlerts(alerts.data), unanswered.error ? [] : parseUnanswered(unanswered.data));
    },
  });
}


// ---------------------------------------------------------------------------
// S69b: tools status, "not now", the nudge switch, shared jobs, the weekly digest, nudges
// ---------------------------------------------------------------------------
/** Which tools are on. A failed read reads as "all off": a control is never shown by accident. */
export function useToolsStatus() {
  return useQuery({
    queryKey: ["care-circle", "tools"] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_tools_status");
      if (error) return parseToolsStatus(null);
      return parseToolsStatus(data);
    },
  });
}

/** "Not now": silent for the person who asked. The screen never tells the sender anything. */
export function useDeclineInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await createClient().rpc("decline_care_circle_invite", { p_token: token });
      if (error) throw new CircleError(error.message);
      return parseDeclined(data);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["care-circle"] }),
  });
}

export function useSetMissedDoseAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { memberId: string; on: boolean }) => {
      const { error } = await createClient().rpc("set_circle_missed_dose_alert", { p_member: input.memberId, p_on: input.on });
      if (error) throw new CircleError(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: circleKeys.mine }),
  });
}

export function useCircleTasks(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["care-circle", "tasks", patientId] as const,
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_tasks", { p_patient: patientId });
      if (error) throw new CircleError(error.message);
      const parsed = parseTasks(data);
      if (!parsed) throw new CircleError("unknown");
      return parsed;
    },
  });
}

export type TaskAction = "claim_circle_task" | "release_circle_task" | "complete_circle_task" | "cancel_circle_task";
/** claim, release, complete and cancel share a shape: one task id in, a boolean out (false means it was no longer possible). */
export function useTaskAction(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { action: TaskAction; taskId: string }) => {
      const { data, error } = await createClient().rpc(input.action, { p_task: input.taskId });
      if (error) throw new CircleError(error.message);
      return data === true;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["care-circle", "tasks", patientId] }),
  });
}

export function usePostTask(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: string; neededBy: string | null }) => {
      const { error } = await createClient().rpc("post_circle_task", { p_patient: patientId, p_kind: input.kind, ...(input.neededBy ? { p_needed_by: input.neededBy } : {}) });
      if (error) throw new CircleError(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["care-circle", "tasks", patientId] }),
  });
}

/** The weekly digest, built on the server from the permissions held. Each open is a logged look. */
export function useWeeklyDigest(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["care-circle", "digest", patientId] as const,
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_weekly_digest", { p_patient: patientId });
      if (error) throw new CircleError(error.message);
      return parseDigest(data);
    },
  });
}

/** People a gentle nudge was sent about, first name only. Empty when the tool is off. */
export function useRecentNudges(enabled: boolean) {
  return useQuery({
    queryKey: ["care-circle", "nudges"] as const,
    enabled,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_recent_nudges");
      if (isMissingFunction(error)) return [];
      if (error) throw new CircleError(error.message);
      return parseNudges(data);
    },
  });
}
