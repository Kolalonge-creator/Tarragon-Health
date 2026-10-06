import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  inviteMadeSchema,
  parseAccept,
  parseMyCircle,
  parseOpenAlerts,
  parsePreview,
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

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { memberId: string; permissions: CirclePermission[] }) => {
      const { data, error } = await createClient().rpc("update_care_circle_member", { p_member: input.memberId, p_permissions: input.permissions });
      if (error) throw new CircleError(error.message);
      if (data !== true) throw new CircleError("unknown");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: circleKeys.mine }),
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
