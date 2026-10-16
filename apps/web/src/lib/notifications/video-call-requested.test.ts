import { queueVideoCallRequestedNotice } from "./video-call-requested";

type Row = Record<string, unknown>;

function service(error: { message: string } | null) {
  const inserted: Row[] = [];
  const client = {
    from: (table: string) => ({
      insert: async (rows: Row[]) => {
        expect(table).toBe("notifications");
        inserted.push(...rows);
        return { error };
      },
    }),
  };
  return { client: client as unknown as Parameters<typeof queueVideoCallRequestedNotice>[0]["service"], inserted };
}

const params = { organisationId: "org-1", patientId: "pat-1", consultationId: "consult-1" };

describe("queueVideoCallRequestedNotice", () => {
  it("queues the same neutral notice in the app, by push and by email, and never by SMS or voice", async () => {
    const { client, inserted } = service(null);
    expect(await queueVideoCallRequestedNotice({ service: client, ...params })).toBe(true);
    expect(inserted.map((r) => r.channel).sort()).toEqual(["email", "in_app", "push"]);
    expect(inserted.every((r) => r.template === "video_call_requested" && r.status === "pending" && r.content_class === "non_clinical")).toBe(true);
  });

  it("carries only the consultation id: no name, no condition and no join link", async () => {
    const { client, inserted } = service(null);
    await queueVideoCallRequestedNotice({ service: client, ...params });
    for (const row of inserted) expect(row.payload).toEqual({ consultation_id: "consult-1" });
  });

  it("returns false when the rows could not be written, so the caller never claims the patient was told", async () => {
    const { client } = service({ message: "boom" });
    expect(await queueVideoCallRequestedNotice({ service: client, ...params })).toBe(false);
  });
});
