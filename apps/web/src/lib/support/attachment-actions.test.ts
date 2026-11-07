/**
 * Support ticket attachments (SUP-2): the caller's RLS decides the ticket, only staff of the ticket's organisation may
 * attach as staff or mark a file internal, a closed ticket takes no files, the scan verdict maps onto scan_status, a
 * stored file is removed if its row cannot be written, and a file waiting for its scan never gets a link.
 */

const ticketRow = { current: null as null | { id: string; organisation_id: string; patient_id: string; status: string } };
const profileRow = { current: null as null | { role: string; organisation_id: string } };
const attachmentRow = { current: null as null | { id: string; storage_path: string; scan_status: string } };
const userId = { current: "patient-1" };

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: userId.current } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === "support_tickets" ? ticketRow.current : table === "profiles" ? profileRow.current : attachmentRow.current,
          }),
        }),
      }),
    }),
  })),
}));

const upload = jest.fn(async () => ({ error: null }));
const remove = jest.fn(async () => ({ error: null }));
const insert = jest.fn(async (row: Record<string, unknown>) => ({ error: row ? (null as null | { message: string }) : null }));
const createSignedUrl = jest.fn(async () => ({ data: { signedUrl: "https://signed" }, error: null }));

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    storage: { from: () => ({ upload, remove, createSignedUrl }) },
    from: () => ({ insert }),
  }),
}));

const screenUpload = jest.fn(async () => ({ ok: true, verdict: "clean", sha256: "a".repeat(64) }) as const);
jest.mock("@/lib/upload-scan/screen", () => ({ screenUpload: (...args: unknown[]) => screenUpload(...(args as [])) }));

import { getSupportAttachmentLink, uploadSupportAttachment } from "./attachment-actions";

const TICKET = "11111111-1111-4111-8111-111111111111";
function form(opts: { internal?: boolean; type?: string; size?: number } = {}) {
  const fd = new FormData();
  fd.set("ticket_id", TICKET);
  fd.set("internal", String(!!opts.internal));
  fd.set("file", new File([new Uint8Array(opts.size ?? 100)], "screen.png", { type: opts.type ?? "image/png" }));
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
  userId.current = "patient-1";
  ticketRow.current = { id: TICKET, organisation_id: "org-1", patient_id: "patient-1", status: "new" };
  profileRow.current = null;
  attachmentRow.current = null;
});

describe("uploadSupportAttachment", () => {
  it("stores a patient's file as theirs, scanned clean", async () => {
    await expect(uploadSupportAttachment(form())).resolves.toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ uploader_role: "patient", is_internal: false, scan_status: "clean" }));
  });

  it("refuses an internal file from the patient", async () => {
    await expect(uploadSupportAttachment(form({ internal: true }))).resolves.toMatchObject({ ok: false });
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses a reader who is neither the patient nor staff of the ticket's organisation", async () => {
    userId.current = "supporter-1";
    profileRow.current = { role: "patient", organisation_id: "org-1" };
    await expect(uploadSupportAttachment(form({ internal: true }))).resolves.toMatchObject({ ok: false });
    expect(screenUpload).not.toHaveBeenCalled();
  });

  it("lets staff of the organisation add an internal file", async () => {
    userId.current = "coord-1";
    profileRow.current = { role: "care_coordinator", organisation_id: "org-1" };
    await expect(uploadSupportAttachment(form({ internal: true }))).resolves.toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ uploader_role: "staff", is_internal: true }));
  });

  it("refuses a closed ticket, an unknown type and a file over 9 MB", async () => {
    ticketRow.current = { id: TICKET, organisation_id: "org-1", patient_id: "patient-1", status: "closed" };
    await expect(uploadSupportAttachment(form())).resolves.toMatchObject({ ok: false });
    ticketRow.current = { id: TICKET, organisation_id: "org-1", patient_id: "patient-1", status: "new" };
    await expect(uploadSupportAttachment(form({ type: "application/zip" }))).resolves.toMatchObject({ ok: false });
    await expect(uploadSupportAttachment(form({ size: 9 * 1024 * 1024 + 1 }))).resolves.toMatchObject({ ok: false });
    expect(upload).not.toHaveBeenCalled();
  });

  it("records a held file as pending_scan", async () => {
    screenUpload.mockResolvedValueOnce({ ok: true, verdict: "held", sha256: "b".repeat(64) } as never);
    await uploadSupportAttachment(form());
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ scan_status: "pending_scan" }));
  });

  it("never stores an infected file", async () => {
    screenUpload.mockResolvedValueOnce({ ok: false, error: "flagged" } as never);
    await expect(uploadSupportAttachment(form())).resolves.toEqual({ ok: false, error: "flagged" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("removes the stored file when its row cannot be written", async () => {
    insert.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(uploadSupportAttachment(form())).resolves.toMatchObject({ ok: false });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("getSupportAttachmentLink", () => {
  const ID = "22222222-2222-4222-8222-222222222222";
  it("gives no link for a file RLS hides or one waiting for its scan", async () => {
    await expect(getSupportAttachmentLink(ID)).resolves.toMatchObject({ ok: false });
    attachmentRow.current = { id: ID, storage_path: "x", scan_status: "pending_scan" };
    await expect(getSupportAttachmentLink(ID)).resolves.toMatchObject({ ok: false });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
  it("signs a one-minute link for a clean file", async () => {
    attachmentRow.current = { id: ID, storage_path: "x", scan_status: "clean" };
    await expect(getSupportAttachmentLink(ID)).resolves.toEqual({ ok: true, url: "https://signed" });
    expect(createSignedUrl).toHaveBeenCalledWith("x", 60);
  });
});
