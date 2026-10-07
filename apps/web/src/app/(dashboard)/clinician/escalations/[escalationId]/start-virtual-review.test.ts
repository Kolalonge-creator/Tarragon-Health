import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Regression for the 2026-10-06 reconciliation (S21): the escalation call used to put the patient's full name in the Zoom
// meeting topic (INV-07) and to text the raw join link (INV-08). It now sends a neutral topic and an in-app notice only.
const createMeeting = jest.fn<(input: { topic: string }) => Promise<unknown>>();
const queueNotice = jest.fn<(p: Record<string, unknown>) => Promise<boolean>>();

jest.mock("@/lib/zoom/meetings", () => ({ createMeeting: (i: { topic: string }) => createMeeting(i) }));
jest.mock("@/lib/zoom/client", () => ({ isZoomConfigured: () => true }));
jest.mock("@/lib/notifications/video-call-requested", () => ({ queueVideoCallRequestedNotice: (p: Record<string, unknown>) => queueNotice(p) }));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));

const selectedColumns: string[] = [];
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "doc-1" } } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => {
        selectedColumns.push(`${table}:${cols}`);
        return chain;
      };
      chain.eq = () => chain;
      chain.insert = () => chain;
      chain.update = () => chain;
      chain.maybeSingle = async () => ({ data: { id: "esc-1", organisation_id: "org-1", patient_id: "pat-1" }, error: null });
      chain.single = async () => ({ data: { id: "consult-1" }, error: null });
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ error: null });
      return chain;
    },
  }),
}));

import { startVirtualReview } from "./actions";

const ESCALATION = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";

describe("startVirtualReview (S21 regression)", () => {
  beforeEach(() => {
    createMeeting.mockReset();
    queueNotice.mockReset();
    selectedColumns.length = 0;
    createMeeting.mockResolvedValue({ ok: true, data: { meetingId: "81000000001", joinUrl: "https://zoom.example/j/1?pwd=x", hostStartUrl: "https://zoom.example/s/1?zak=y" } });
    queueNotice.mockResolvedValue(true);
  });

  it("creates the meeting with a neutral topic that carries no name", async () => {
    await startVirtualReview(ESCALATION);
    expect(createMeeting).toHaveBeenCalledWith({ topic: "Tarragon consultation" });
  });

  it("does not even read the patient's name or phone number", async () => {
    await startVirtualReview(ESCALATION);
    const cols = selectedColumns.join(" ");
    expect(cols).not.toMatch(/full_name|phone/);
  });

  it("has no SMS sender to call (S85-D3 removed it) and never puts the join link in a notification", async () => {
    // The patient-link SMS helper is deleted; if it comes back, this fails before any send can be wired to it.
    expect(existsSync(join(process.cwd(), "src/lib/notifications/send-patient-link.ts"))).toBe(false);
    const result = await startVirtualReview(ESCALATION);
    expect(queueNotice).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(queueNotice.mock.calls[0])).not.toContain("zoom.example");
    expect(result).toMatchObject({ success: true, hostStartUrl: "https://zoom.example/s/1?zak=y", patientNotified: true });
  });

  it("reports patientNotified false when the notice could not be queued, instead of claiming it was sent", async () => {
    queueNotice.mockResolvedValue(false);
    expect(await startVirtualReview(ESCALATION)).toMatchObject({ success: true, patientNotified: false });
  });
});
