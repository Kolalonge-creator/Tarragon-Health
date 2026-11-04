import { isRetryable, MAX_AUTOMATIC_READ_ATTEMPTS, retryUnreadLabReports, STUCK_AFTER_MINUTES } from "./retry";
import { runLabReportExtraction } from "@/lib/lab-reports/extraction-actions";

jest.mock("@/lib/lab-reports/extraction-actions", () => ({ runLabReportExtraction: jest.fn() }));
jest.mock("@/lib/labs/test-code-labels", () => ({ testCodeLabel: (c: string) => `label:${c}` }));

const now = new Date("2026-11-04T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

describe("isRetryable", () => {
  it("retries a failed read until the attempt limit, then stops", () => {
    const base = { status: "processing_failed", extraction_attempts: 1, status_changed_at: minutesAgo(5) };
    expect(isRetryable({ ...base, failed_attempts: 1 }, now)).toBe(true);
    expect(isRetryable({ ...base, failed_attempts: MAX_AUTOMATIC_READ_ATTEMPTS - 1 }, now)).toBe(true);
    expect(isRetryable({ ...base, failed_attempts: MAX_AUTOMATIC_READ_ATTEMPTS }, now)).toBe(false);
  });

  it("retries a read that was interrupted, only once it is clearly stuck", () => {
    const base = { status: "processing", failed_attempts: 0, extraction_attempts: 0 };
    expect(isRetryable({ ...base, status_changed_at: minutesAgo(STUCK_AFTER_MINUTES - 1) }, now)).toBe(false);
    expect(isRetryable({ ...base, status_changed_at: minutesAgo(STUCK_AFTER_MINUTES + 1) }, now)).toBe(true);
  });

  it("never touches a document that was read, is waiting for a person, or was reviewed", () => {
    for (const status of ["processed", "awaiting_verification", "doctor_review_required", "reviewed", "superseded", "uploaded"]) {
      expect(isRetryable({ status, failed_attempts: 0, extraction_attempts: 0, status_changed_at: minutesAgo(600) }, now)).toBe(false);
    }
  });
});

type Row = Record<string, unknown>;

function fakeService(docs: Row[], sources: Record<string, Row>) {
  return {
    from(table: string) {
      if (table === "clinical_documents") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          lt: () => chain,
          order: () => chain,
          limit: () => Promise.resolve({ data: docs, error: null }),
        };
        return chain;
      }
      let id = "";
      const chain = {
        select: () => chain,
        eq: (_c: string, v: string) => {
          id = v;
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: sources[id] ?? null, error: null }),
      };
      return chain;
    },
  };
}

describe("retryUnreadLabReports", () => {
  beforeEach(() => jest.mocked(runLabReportExtraction).mockReset());

  it("re-reads a patient's failed upload and counts the outcome", async () => {
    jest.mocked(runLabReportExtraction).mockResolvedValue({ status: "extracted", readyCount: 3, message: "" });
    const service = fakeService(
      [{ id: "cd1", routed_id: "d1", status: "processing_failed", failed_attempts: 1, extraction_attempts: 1, status_changed_at: minutesAgo(60) }],
      { d1: { id: "d1", organisation_id: "o", patient_id: "p", file_path: "p/x.pdf", mime_type: "application/pdf", test_code: "hba1c", source: "patient" } },
    );
    const out = await retryUnreadLabReports(service as never, now);
    expect(out).toEqual({ considered: 1, retried: 1, read: 1, failedAgain: 0, skipped: 0 });
    expect(runLabReportExtraction).toHaveBeenCalledWith(service, expect.objectContaining({ documentId: "d1", contextHint: "label:hba1c" }));
  });

  it("does not run the reader on a document a person supplied, or past the attempt limit", async () => {
    const service = fakeService(
      [
        { id: "cd1", routed_id: "d1", status: "processing_failed", failed_attempts: 1, extraction_attempts: 1, status_changed_at: minutesAgo(60) },
        { id: "cd2", routed_id: "d2", status: "processing_failed", failed_attempts: MAX_AUTOMATIC_READ_ATTEMPTS, extraction_attempts: 3, status_changed_at: minutesAgo(60) },
      ],
      { d1: { id: "d1", organisation_id: "o", patient_id: "p", file_path: "p/x.pdf", mime_type: "application/pdf", test_code: null, source: "clinician" } },
    );
    const out = await retryUnreadLabReports(service as never, now);
    expect(out).toEqual({ considered: 2, retried: 0, read: 0, failedAgain: 0, skipped: 1 });
    expect(runLabReportExtraction).not.toHaveBeenCalled();
  });

  it("counts a read that fails again", async () => {
    jest.mocked(runLabReportExtraction).mockResolvedValue({ status: "failed", readyCount: 0, message: "timeout" });
    const service = fakeService(
      [{ id: "cd1", routed_id: "d1", status: "processing", failed_attempts: 0, extraction_attempts: 0, status_changed_at: minutesAgo(90) }],
      { d1: { id: "d1", organisation_id: "o", patient_id: "p", file_path: "p/x.jpg", mime_type: "image/jpeg", test_code: null, source: "patient" } },
    );
    const out = await retryUnreadLabReports(service as never, now);
    expect(out).toEqual({ considered: 1, retried: 1, read: 0, failedAgain: 1, skipped: 0 });
  });
});
