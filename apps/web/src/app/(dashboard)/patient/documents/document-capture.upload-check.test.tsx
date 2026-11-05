/** @jest-environment jsdom */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Security audit 2026-11-05 (M-4/L-4): a document the browser writes straight to Storage is checked by the server before the
 * record points at it. A refused file gets no patient_documents row and the person is told; a check that cannot be reached
 * never blocks the save (the server sweep checks the file anyway).
 */
const uploads: string[] = [];
const inserts: Record<string, unknown>[] = [];
const confirm = jest.fn<(bucket: string, path: string) => Promise<string | null>>();

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/lib/document-capture/actions", () => ({ requestDocumentReadingAction: jest.fn() }));
jest.mock("@/lib/uploads/confirm-direct-upload", () => ({ confirmDirectUpload: (b: string, p: string) => confirm(b, p) }));
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: async (path: string) => { uploads.push(path); return { error: null }; } }) },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "doc-1" }, error: null }) }) };
      },
    }),
  }),
}));

import { DocumentCapture } from "./document-capture";

async function pick() {
  const input = document.getElementById("doc-camera") as HTMLInputElement;
  const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "scan.jpg", { type: "image/jpeg" });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

beforeEach(() => {
  uploads.length = 0;
  inserts.length = 0;
  confirm.mockReset();
});

describe("DocumentCapture upload check", () => {
  it("a refused file gets no record and the person sees why", async () => {
    confirm.mockResolvedValue("That file is not what it says it is.");
    render(<DocumentCapture patientId="user-1" organisationId="org-1" readingOpen={false} locale="en" />);
    await pick();
    expect(confirm).toHaveBeenCalledWith("patient-documents", uploads[0]);
    expect(inserts).toHaveLength(0);
    expect(await screen.findByText("That file is not what it says it is.")).toBeTruthy();
  });

  it("a checked file (or no answer from the check) is saved", async () => {
    confirm.mockResolvedValue(null);
    render(<DocumentCapture patientId="user-1" organisationId="org-1" readingOpen={false} locale="en" />);
    await pick();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ file_path: uploads[0], patient_id: "user-1" });
  });
});
