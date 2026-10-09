/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const alert = jest.fn<(c: unknown, a: { eventId: string; subjectId: string; actorId: string }) => Promise<{ error?: string; success?: boolean }>>();
const insertSingle = jest.fn<() => Promise<{ data: { id: string } | null; error: unknown }>>();
const profileSingle = jest.fn<() => Promise<{ data: { organisation_id: string | null } | null }>>();
let authenticated = true;

jest.mock("@/lib/community/api-auth", () => ({
  authenticateCommunity: async () =>
    authenticated
      ? {
          userId: "u1",
          supabase: {
            from: (table: string) =>
              table === "profiles"
                ? { select: () => ({ eq: () => ({ single: profileSingle }) }) }
                : { insert: (row: Record<string, unknown>) => { inserted.push(row); return { select: () => ({ single: insertSingle }) }; } },
          },
        }
      : { response: new Response("{}", { status: 401 }) },
}));
jest.mock("@/lib/emergency/alert-contact", () => ({ alertEmergencyContact: (c: unknown, a: { eventId: string; subjectId: string; actorId: string }) => alert(c, a) }));

import { POST } from "./route";

const inserted: Record<string, unknown>[] = [];
const req = () => new Request("http://localhost/api/mobile/community-emergency", { method: "POST" });

beforeEach(() => {
  alert.mockReset();
  insertSingle.mockReset();
  profileSingle.mockReset().mockResolvedValue({ data: { organisation_id: "org1" } });
  inserted.length = 0;
  authenticated = true;
});

describe("POST /api/mobile/community-emergency", () => {
  it("needs a signed-in person", async () => {
    authenticated = false;
    expect((await POST(req())).status).toBe(401);
    expect(alert).not.toHaveBeenCalled();
  });

  it("records an emergency for the person's own account and alerts their contact, sending no post text", async () => {
    insertSingle.mockResolvedValue({ data: { id: "e1" }, error: null });
    alert.mockResolvedValue({ success: true });
    const res = await POST(req());
    expect(await res.json()).toEqual({ ok: true, contact: "sent", reason: null });
    expect(inserted[0]).toMatchObject({ patient_id: "u1", organisation_id: "org1", status: "active", trigger_detail: "Asked for help from a message" });
    expect(alert).toHaveBeenCalledWith(expect.anything(), { eventId: "e1", subjectId: "u1", actorId: "u1" });
  });

  it("still reports success of the event when there is no contact to alert, and says why", async () => {
    insertSingle.mockResolvedValue({ data: { id: "e1" }, error: null });
    alert.mockResolvedValue({ error: "Add an emergency contact number first so we can alert them." });
    expect(await (await POST(req())).json()).toEqual({ ok: true, contact: "not_sent", reason: "Add an emergency contact number first so we can alert them." });
  });

  it("fails cleanly when the event cannot be recorded", async () => {
    insertSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(req());
    expect(res.status).toBe(502);
    expect(alert).not.toHaveBeenCalled();
  });
});
