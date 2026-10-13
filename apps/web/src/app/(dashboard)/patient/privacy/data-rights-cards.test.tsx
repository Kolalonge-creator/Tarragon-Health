/** @jest-environment jsdom */
/**
 * Export and deletion cards (OQ-50) and the receipts panel (S04b-2): the patient sees a status, a stated timeline, a download
 * only when one is ready, a cancel only while the waiting period runs, and plainly what is kept.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { DeletionRequestCard } from "./deletion-request-card";
import { ExportRequestCard } from "./export-request-card";
import { ConsentReceiptsPanel } from "./consent-receipts-panel";

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

let exportRows: Record<string, unknown>[] = [];
let listState: { isLoading: boolean; isError: boolean } = { isLoading: false, isError: false };
let deletionRows: Record<string, unknown>[] = [];
let receiptRows: Record<string, unknown>[] = [];
const createExport = jest.fn();
const createDeletion = jest.fn();
const cancelDeletion = jest.fn();

jest.mock("@/lib/queries/data-rights", () => ({
  usePatientExportRequests: () => ({ data: exportRows, ...listState }),
  useCreateExportRequest: () => ({ mutate: createExport, isPending: false, error: null }),
  usePatientDeletionRequests: () => ({ data: deletionRows, ...listState }),
  useCreateDeletionRequest: () => ({ mutate: createDeletion, isPending: false, error: null }),
  useCancelDeletionRequest: () => ({ mutate: cancelDeletion, isPending: false, error: null }),
}));
jest.mock("@/lib/queries/consent", () => ({
  usePatientConsentReceipts: () => ({ data: receiptRows, isLoading: listState.isLoading, isError: listState.isError }),
}));

beforeEach(() => {
  listState = { isLoading: false, isError: false };
  exportRows = [];
  deletionRows = [];
  receiptRows = [];
  createExport.mockReset();
  createDeletion.mockReset();
  cancelDeletion.mockReset();
});

describe("ExportRequestCard", () => {
  it("states the timeline up front and sends a request", () => {
    render(<ExportRequestCard organisationId="o" patientId="p" />);
    expect(screen.getByText(/within 30 days/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Request my data" }));
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(createExport).toHaveBeenCalledTimes(1);
  });

  it("shows the due date while waiting and no download link", () => {
    exportRows = [{ id: "e1", status: "pending", requested_at: iso(-DAY), due_at: iso(29 * DAY), fulfilled_at: null }];
    render(<ExportRequestCard organisationId="o" patientId="p" />);
    expect(screen.getByText("We have your request")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download my data" })).toBeNull();
    expect((screen.getByRole("button", { name: "Request in progress" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers the download only when a request has been fulfilled and is still inside its window", () => {
    exportRows = [{ id: "e1", status: "fulfilled", requested_at: iso(-5 * DAY), due_at: iso(25 * DAY), fulfilled_at: iso(-DAY) }];
    render(<ExportRequestCard organisationId="o" patientId="p" />);
    const link = screen.getByRole("link", { name: "Download my data" });
    expect(link.getAttribute("href")).toBe("/api/patient/data-export");
  });
});

describe("a request list that is loading or failed", () => {
  it("disables asking again, so a hidden pending request cannot be duplicated", () => {
    listState = { isLoading: false, isError: true };
    render(<DeletionRequestCard organisationId="o" patientId="p" />);
    expect((screen.getByRole("button", { name: "Request deletion of your data" }) as HTMLButtonElement).disabled).toBe(true);
    render(<ExportRequestCard organisationId="o" patientId="p" />);
    expect((screen.getByRole("button", { name: "Request my data" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("DeletionRequestCard", () => {
  it("says plainly what is removed and what is kept before asking", () => {
    render(<DeletionRequestCard organisationId="o" patientId="p" />);
    expect(screen.getByText("What we have to keep")).toBeTruthy();
    expect(screen.getByText(/Posted clinical records/)).toBeTruthy();
    expect(screen.getByText(/audit log/)).toBeTruthy();
    expect(screen.getByText(/Financial and payment ledger entries/)).toBeTruthy();
  });

  it("takes two taps to start the waiting period", () => {
    render(<DeletionRequestCard organisationId="o" patientId="p" />);
    fireEvent.click(screen.getByRole("button", { name: "Request deletion of your data" }));
    expect(createDeletion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Yes, start the 14-day wait/ }));
    expect(createDeletion).toHaveBeenCalledTimes(1);
  });

  it("offers a two-tap cancel while the waiting period runs", () => {
    deletionRows = [{ id: "d1", status: "pending", requested_at: iso(-DAY), grace_ends_at: iso(13 * DAY), blocked_reason: null, decision_note: null }];
    render(<DeletionRequestCard organisationId="o" patientId="p" />);
    expect(screen.getByText(/days left to change your mind/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel this request" }));
    expect(cancelDeletion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel my request" }));
    expect(cancelDeletion).toHaveBeenCalledWith("d1", expect.anything());
  });

  it("offers no cancel once the waiting period is over", () => {
    deletionRows = [{ id: "d1", status: "under_review", requested_at: iso(-20 * DAY), grace_ends_at: iso(-DAY), blocked_reason: null, decision_note: null }];
    render(<DeletionRequestCard organisationId="o" patientId="p" />);
    expect(screen.getByText("Our team is reviewing your request")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel this request" })).toBeNull();
  });
});

describe("ConsentReceiptsPanel", () => {
  it("shows who, what, when and where, and the exact words on demand", () => {
    receiptRows = [
      {
        id: "r1",
        consent_type: "research",
        action: "accepted",
        version: "2026-10-07",
        title: "Use my information in approved research",
        body: "The exact words shown.",
        channel: "mobile",
        consented_by_relation: "self",
        recorded_at: "2026-10-12T09:00:00Z",
        text_sha256: "abc123",
      },
    ];
    render(<ConsentReceiptsPanel patientId="p" />);
    expect(screen.getByText(/You agreed to "Use my information in approved research" \(version 2026-10-07\) on 12 Oct 2026, in the app\./)).toBeTruthy();
    expect(screen.getByText("The exact words shown.")).toBeTruthy();
    expect(screen.getByText(/abc123/)).toBeTruthy();
  });

  it("does not call a loading list empty, and says when it failed", () => {
    listState = { isLoading: true, isError: false };
    const { unmount } = render(<ConsentReceiptsPanel patientId="p" />);
    expect(screen.queryByText("No receipts yet.")).toBeNull();
    unmount();
    listState = { isLoading: false, isError: true };
    render(<ConsentReceiptsPanel patientId="p" />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("No receipts yet.")).toBeNull();
  });

  it("says so when there are no receipts yet", () => {
    render(<ConsentReceiptsPanel patientId="p" />);
    expect(screen.getByText("No receipts yet.")).toBeTruthy();
  });
});
