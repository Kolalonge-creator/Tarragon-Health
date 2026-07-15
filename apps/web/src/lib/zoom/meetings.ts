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
 * Creates an instant Zoom meeting (type: 1) hosted on the "me" user — this
 * project doesn't provision a separate Zoom user per doctor, so every
 * meeting is created under the single account's own user and the join
 * link is what's actually shared with the patient/specialist.
 */
export async function createMeeting(params: { topic: string }): Promise<ZoomResult<CreatedZoomMeeting>> {
  const result = await zoomFetch<ZoomMeetingResponse>("/users/me/meetings", {
    method: "POST",
    body: {
      topic: params.topic,
      type: 1,
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
