import { zoomFetch, type ZoomResult } from "./client";

interface ZoomMeetingResponse {
  id: number;
  join_url: string;
  start_url: string;
}

export interface CreatedZoomMeeting {
  meetingId: string;
  joinUrl: string;
  hostStartUrl: string;
}

/**
 * Creates a Zoom meeting hosted on the "me" user — this project doesn't
 * provision a separate Zoom user per doctor, so every meeting is created
 * under the single account's own user and the join link is what's actually
 * shared with the patient/specialist.
 *
 * Without `startTime` it's an instant meeting (type 1, escalation triage).
 * With `startTime` (an ISO datetime) it's a scheduled meeting (type 2) at
 * that time in Africa/Lagos — used by the annual-review consult once the
 * doctor and patient have agreed a slot.
 */
export async function createMeeting(params: {
  topic: string;
  startTime?: string;
}): Promise<ZoomResult<CreatedZoomMeeting>> {
  const scheduled = Boolean(params.startTime);
  const result = await zoomFetch<ZoomMeetingResponse>("/users/me/meetings", {
    method: "POST",
    body: {
      topic: params.topic,
      type: scheduled ? 2 : 1,
      ...(scheduled ? { start_time: params.startTime, timezone: "Africa/Lagos" } : {}),
      settings: {
        join_before_host: false,
        waiting_room: true,
      },
    },
  });
  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      meetingId: String(result.data.id),
      joinUrl: result.data.join_url,
      hostStartUrl: result.data.start_url,
    },
  };
}
