import { describe, expect, it, jest } from "@jest/globals";
import { sendVideoConsultBookedConfirmation } from "./video-consult-confirmation";

function buildService() {
  const insert = jest.fn<(rows: Array<Record<string, unknown>>) => Promise<unknown>>(() =>
    Promise.resolve({ error: null })
  );
  const chain = (data: unknown) => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.maybeSingle = () => Promise.resolve({ data, error: null });
    return c;
  };
  const from = (table: string) => {
    if (table === "notifications") return { insert };
    if (table === "video_consultations")
      return chain({
        organisation_id: "org-1",
        patient_id: "patient-1",
        scheduled_at: "2026-10-01T10:00:00Z",
        join_url: null,
      });
    return chain(null);
  };
  return {
    service: { from } as unknown as Parameters<typeof sendVideoConsultBookedConfirmation>[0]["service"],
    insert,
  };
}

describe("sendVideoConsultBookedConfirmation", () => {
  it("queues only an in_app confirmation", async () => {
    const { service, insert } = buildService();
    await sendVideoConsultBookedConfirmation({ service, consultId: "c-1", joinUrl: null });
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0]![0];
    expect(rows.map((r) => r.channel)).toEqual(["in_app"]);
    expect(rows[0]).toMatchObject({ template: "video_consult_booked", recipient_id: "patient-1" });
  });
});
