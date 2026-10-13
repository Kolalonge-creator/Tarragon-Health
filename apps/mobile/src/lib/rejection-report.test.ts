/**
 * S06x: when the server refuses an entry, the phone tells it once, with no health value, so support can
 * see it. Best effort; a failure is retried at the next flush and the server ignores a repeat.
 */
import { enqueue, flushOutbox, retryRow } from "./outbox";
import { rejectionReasonCode } from "./outbox-rules";

let mockReports: Record<string, unknown>[] = [];
let mockReportError: { code?: string; message: string } | null = null;
let mockSymptomError: { code?: string; message: string } | null = { code: "23514", message: "new row violates check constraint \"severity\" (value 11 headache)" };
let mockProfileOrg: string | null = "org-1";

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { organisation_id: "org-1" }, error: null }),
          maybeSingle: async () => ({ data: mockProfileOrg ? { organisation_id: mockProfileOrg } : null, error: null }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        if (table === "offline_sync_rejections") {
          if (mockReportError) return { error: mockReportError };
          mockReports.push(row);
          return { error: null };
        }
        return { error: mockSymptomError };
      },
    }),
  },
}));

beforeEach(() => {
  mockReports = [];
  mockReportError = null;
  mockProfileOrg = "org-1";
  mockSymptomError = { code: "23514", message: "new row violates check constraint \"severity\" (value 11 headache)" };
});

const SYMPTOM = { symptom_type: "headache", severity: 11, description: "pain behind my left eye since Monday" };

describe("rejection report", () => {
  it("is written once on the first rejection, with the kind, a coarse reason, the status code and the support code", async () => {
    const item = await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    const result = await flushOutbox();
    expect(result.newlyRejected).toBe(1);
    expect(mockReports).toHaveLength(1);
    expect(mockReports[0]).toMatchObject({
      organisation_id: "org-1",
      account_id: "user-1",
      kind: "symptom",
      reason_code: "refused_constraint",
      client_id: item.clientId,
    });
    expect(String(mockReports[0].support_code)).toMatch(/^[0-9A-F]{8}$/);
  });

  it("carries NO health value, note, medicine or server message", async () => {
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await flushOutbox();
    const text = JSON.stringify(mockReports[0]);
    for (const leaked of ["headache", "left eye", "Monday", "11", "violates", "severity"]) {
      // "11" can legitimately appear in a timestamp-free row only if a value leaked; there are no numbers but the status
      if (leaked === "11") expect(Object.keys(mockReports[0])).not.toContain("severity");
      else expect(text).not.toContain(leaked);
    }
    expect(Object.keys(mockReports[0]).sort()).toEqual(
      ["account_id", "client_id", "http_status", "kind", "organisation_id", "reason_code", "support_code"].sort()
    );
  });

  it("is not written again on later flushes", async () => {
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await flushOutbox();
    await flushOutbox();
    await flushOutbox();
    expect(mockReports).toHaveLength(1);
  });

  it("is retried at the next flush when the report itself could not be sent, and the entry is still kept", async () => {
    mockReportError = { message: "Network request failed" };
    const item = await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await flushOutbox();
    expect(mockReports).toHaveLength(0);
    mockReportError = null;
    await flushOutbox();
    expect(mockReports).toHaveLength(1);
    expect(mockReports[0]).toMatchObject({ client_id: item.clientId });
  });

  it("treats a repeat the server already holds (23505) as done", async () => {
    mockReportError = { code: "23505", message: "duplicate key" };
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await flushOutbox();
    mockReportError = null;
    await flushOutbox();
    expect(mockReports).toHaveLength(0); // flagged reported on the first run, nothing sent again
  });

  it("never blocks or changes what happens to the entry", async () => {
    mockReportError = { message: "boom" };
    const item = await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    const result = await flushOutbox();
    expect(result).toMatchObject({ newlyRejected: 1, synced: 0 });
    await retryRow(item.clientId);
    mockSymptomError = null;
    expect((await flushOutbox()).synced).toBe(1);
  });

  it("does nothing when the organisation cannot be found", async () => {
    mockProfileOrg = null;
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await flushOutbox();
    expect(mockReports).toHaveLength(0);
  });
});

describe("rejectionReasonCode", () => {
  it("classes by sqlstate first, then status, then wording", () => {
    expect(rejectionReasonCode({ code: "42501" })).toBe("refused_permission");
    expect(rejectionReasonCode({ status: 403 })).toBe("refused_permission");
    expect(rejectionReasonCode({ code: "23514" })).toBe("refused_constraint");
    expect(rejectionReasonCode({ code: "22003" })).toBe("refused_validation");
    expect(rejectionReasonCode({ status: 422, message: "Systolic must be between 40 and 300" })).toBe("refused_validation");
    expect(rejectionReasonCode({ status: 400 })).toBe("refused_validation");
    expect(rejectionReasonCode({ message: "row-level security policy" })).toBe("refused_permission");
    expect(rejectionReasonCode({ status: 404 })).toBe("refused_other");
  });
});
