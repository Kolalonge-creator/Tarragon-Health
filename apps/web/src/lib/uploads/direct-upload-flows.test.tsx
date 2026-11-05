/** @jest-environment jsdom */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Security audit 2026-11-05 (M-4/L-4): every browser flow that writes a file straight to Storage asks the server to check it
 * (real bytes match the declared type, photo location removed) BEFORE any row points at the file. A refused file never gets a
 * record; a check that cannot be reached never blocks (the server sweep checks the file anyway).
 */

const uploads: { bucket: string; path: string }[] = [];
const writes: { table: string; op: string; row?: unknown }[] = [];
const rpcs: { fn: string; args: unknown }[] = [];
const confirm = jest.fn<(bucket: string, path: string) => Promise<string | null>>();

function chain(table: string, op: string, row?: unknown) {
  writes.push({ table, op, row });
  const q: Record<string, unknown> = {};
  q.eq = () => q;
  q.select = () => q;
  q.single = async () => ({ data: table === "profiles" ? { organisation_id: "org-1" } : { id: "row-1" }, error: null });
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res);
  return q;
}

const fakeClient = {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string) => {
        uploads.push({ bucket, path });
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${bucket}/${path}` } }),
    }),
  },
  from: (table: string) => ({
    insert: (row: unknown) => chain(table, "insert", row),
    update: (row: unknown) => chain(table, "update", row),
    select: () => chain(table, "select"),
  }),
  rpc: async (fn: string, args: unknown) => {
    rpcs.push({ fn, args });
    if (fn === "care_message_scope") return { data: { organisation_id: "org-1", patient_id: "user-1", thread_id: "t-1" }, error: null };
    if (fn === "submit_written_question") return { data: "consult-1", error: null };
    return { data: null, error: null };
  },
};

jest.mock("@/lib/supabase/client", () => ({ createClient: () => fakeClient }));
// A server action module (AI draft replies) the care-message hooks import; irrelevant here and needs Node globals under jsdom.
jest.mock("@/lib/care-messages/actions", () => ({ generateDraftReplyAction: jest.fn() }));
jest.mock("@/lib/uploads/confirm-direct-upload", () => ({
  confirmDirectUpload: (bucket: string, path: string) => confirm(bucket, path),
  REFUSED_UPLOAD_MESSAGE: "That file is not what it says it is.",
}));

import { useAttachVaccinationCertificate, useUploadVaccinationCard } from "@/lib/queries/vaccination";
import { useUploadCareMessageAttachment } from "@/lib/queries/care-messages";
import { useSubmitSecondOpinionRequest } from "@/lib/queries/second-opinion";
import { useSendWrittenQuestion } from "@/lib/queries/written-questions";
import { uploadClinicalStaffPhoto } from "@/lib/queries/clinical-staff";
import { createClient } from "@/lib/supabase/client";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const file = () => new File([Uint8Array.from([0xff, 0xd8, 0xff])], "a.jpg", { type: "image/jpeg" });
const REFUSED = "That file is not what it says it is.";

/** Runs a mutation that should fail and returns its error message (the mutation is awaited inside act). */
async function errorOf(run: () => Promise<unknown>): Promise<string | null> {
  let message: string | null = null;
  await act(async () => {
    await run().catch((e: unknown) => {
      message = e instanceof Error ? e.message : String(e);
    });
  });
  return message;
}

beforeEach(() => {
  uploads.length = 0;
  writes.length = 0;
  rpcs.length = 0;
  confirm.mockReset();
  confirm.mockResolvedValue(null);
});

describe("vaccination certificate", () => {
  it("a refused file never reaches the record", async () => {
    confirm.mockResolvedValue(REFUSED);
    const { result } = renderHook(() => useAttachVaccinationCertificate(), { wrapper });
    expect(await errorOf(() => result.current.mutateAsync({ recordId: "r-1", patientId: "user-1", file: file() }))).toBe(REFUSED);
    expect(confirm).toHaveBeenCalledWith("vaccination-certificates", uploads[0]?.path);
    expect(writes.some((w) => w.table === "vaccination_records")).toBe(false);
  });

  it("a checked file (or no answer from the check) is attached as before", async () => {
    const { result } = renderHook(() => useAttachVaccinationCertificate(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ recordId: "r-1", patientId: "user-1", file: file() }); });
    expect(writes.some((w) => w.table === "vaccination_records" && w.op === "update")).toBe(true);
  });
});

describe("vaccination card import", () => {
  it("a refused file creates no extraction draft", async () => {
    confirm.mockResolvedValue(REFUSED);
    const { result } = renderHook(() => useUploadVaccinationCard(), { wrapper });
    expect(await errorOf(() => result.current.mutateAsync({ patientId: "user-1", file: file() }))).toBe(REFUSED);
    expect(confirm).toHaveBeenCalledWith("vaccination-certificates", uploads[0]?.path);
    expect(writes.some((w) => w.table === "vaccination_card_extractions")).toBe(false);
  });
});

describe("care-message attachment", () => {
  it("a refused file is never attached to the message", async () => {
    confirm.mockResolvedValue(REFUSED);
    const { result } = renderHook(() => useUploadCareMessageAttachment(), { wrapper });
    expect(await errorOf(() => result.current.mutateAsync({ messageId: "m-1", threadId: "t-1", patientId: "user-1", file: file() }))).toBe(REFUSED);
    expect(confirm).toHaveBeenCalledWith("care-message-attachments", uploads[0]?.path);
    expect(writes.some((w) => w.table === "care_message_attachments")).toBe(false);
  });

  it("a checked file is attached", async () => {
    const { result } = renderHook(() => useUploadCareMessageAttachment(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ messageId: "m-1", threadId: "t-1", patientId: "user-1", file: file() }); });
    expect(writes.some((w) => w.table === "care_message_attachments" && w.op === "insert")).toBe(true);
  });
});

describe("second-opinion documents", () => {
  it("a refused file is counted as failed and never attached; the request itself still goes", async () => {
    confirm.mockResolvedValue(REFUSED);
    const { result } = renderHook(() => useSubmitSecondOpinionRequest(), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ patientId: "user-1", organisationId: "org-1", existingDiagnosisOrResult: "x", files: [file()] });
    });
    expect(out).toMatchObject({ filesFailed: 1 });
    expect(confirm).toHaveBeenCalledWith("second-opinion-documents", uploads[0]?.path);
    expect(rpcs.some((r) => r.fn === "attach_second_opinion_document")).toBe(false);
  });
});

describe("written-question photos", () => {
  it("a refused photo is not attached; the question is still sent", async () => {
    confirm.mockResolvedValue(REFUSED);
    const { result } = renderHook(() => useSendWrittenQuestion(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        clientId: "c-1",
        category: "general",
        question: "A question that is long enough to send",
        durationNote: "",
        photos: [{ id: "p-1", blob: new Blob([Uint8Array.from([0xff, 0xd8, 0xff])], { type: "image/jpeg" }) }],
        redFlagAcknowledged: false,
      });
    });
    expect(confirm).toHaveBeenCalledWith("async-consult-attachments", "user-1/consult-1/p-1.jpg");
    expect(rpcs.some((r) => r.fn === "submit_written_question")).toBe(true);
    expect(rpcs.some((r) => r.fn === "attach_written_question_photo")).toBe(false);
  });
});

describe("clinical staff photo (public bucket)", () => {
  it("a refused photo throws, so no public URL is ever saved on the staff record", async () => {
    confirm.mockResolvedValue(REFUSED);
    await expect(uploadClinicalStaffPhoto(createClient(), "org-1", file())).rejects.toThrow(REFUSED);
    expect(confirm).toHaveBeenCalledWith("clinical-staff-photos", uploads[0]?.path);
  });

  it("a checked photo returns its public URL", async () => {
    const url = await uploadClinicalStaffPhoto(createClient(), "org-1", file());
    expect(url).toBe(`https://cdn.example/clinical-staff-photos/${uploads[0]?.path}`);
  });
});
