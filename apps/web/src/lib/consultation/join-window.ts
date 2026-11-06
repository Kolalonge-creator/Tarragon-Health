import { getProposedConfig } from "@tarragon/shared";

export type JoinWindowState = "too_early" | "open" | "closed";

interface JoinWindowPolicy {
  joinOpensMinutesBefore: number;
  joinClosesMinutesAfter: number;
}

/**
 * The window in which a patient may join a video consultation, from the same
 * `consultations.policy` config the database mirrors (the consultation room
 * enforces it server-side). The appointments list used to show "Join call" on
 * status alone, so a patient could press it days early and land in an empty
 * room; this keeps the list and the room telling the same story.
 */
export function joinWindowPolicy(): JoinWindowPolicy {
  const value = getProposedConfig("consultations.policy").value as unknown as JoinWindowPolicy;
  return {
    joinOpensMinutesBefore: value.joinOpensMinutesBefore,
    joinClosesMinutesAfter: value.joinClosesMinutesAfter,
  };
}

export function joinWindowState(
  scheduledFor: string,
  now: Date,
  policy: JoinWindowPolicy = joinWindowPolicy(),
): JoinWindowState {
  const start = new Date(scheduledFor).getTime();
  if (Number.isNaN(start)) return "closed";
  const opens = start - policy.joinOpensMinutesBefore * 60_000;
  const closes = start + policy.joinClosesMinutesAfter * 60_000;
  const t = now.getTime();
  if (t < opens) return "too_early";
  if (t > closes) return "closed";
  return "open";
}

/** When the Join button appears, for the "Join opens at…" line. */
export function joinOpensAt(scheduledFor: string, policy: JoinWindowPolicy = joinWindowPolicy()): Date {
  return new Date(new Date(scheduledFor).getTime() - policy.joinOpensMinutesBefore * 60_000);
}
