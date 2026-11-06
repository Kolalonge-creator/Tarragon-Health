/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";

const zoomFetch = jest.fn<(path: string, init: { method: string; body: Record<string, unknown> }) => Promise<unknown>>();
jest.mock("./client", () => ({ zoomFetch: (path: string, init: { method: string; body: Record<string, unknown> }) => zoomFetch(path, init) }));

import { createMeeting } from "./meetings";

describe("createMeeting", () => {
  it("never leaves recording to the Zoom account default", async () => {
    zoomFetch.mockResolvedValueOnce({ ok: true, data: { id: 1, join_url: "j", start_url: "s" } });
    await createMeeting({ topic: "t", startTime: "2026-11-06T10:00:00Z" });
    const body = zoomFetch.mock.calls[0]?.[1].body as { settings: Record<string, unknown> };
    expect(body.settings).toMatchObject({ auto_recording: "none", waiting_room: true, join_before_host: false });
  });
});
