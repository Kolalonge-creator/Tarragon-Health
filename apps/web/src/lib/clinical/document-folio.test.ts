import { DocumentFolioRefusedError, fetchDocumentFolios } from "./document-folio";

const row = {
  document_id: "d1",
  clinician_staff_id: "s1",
  clinician_profile_id: "p1",
  full_name: "Dr A",
  credential_type: "MDCN",
  credential_number: "12345",
};

describe("fetchDocumentFolios", () => {
  it("returns an empty map without calling the database for no ids", async () => {
    const rpc = jest.fn();
    expect((await fetchDocumentFolios({ rpc }, "referral_letter", [])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps rows by document id with the same folio text the document prints", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [row], error: null });
    const m = await fetchDocumentFolios({ rpc }, "verified_document", ["d1"]);
    expect(rpc).toHaveBeenCalledWith("clinician_folio_for_document", {
      p_document_kind: "verified_document",
      p_document_ids: ["d1"],
    });
    expect(m.get("d1")).toEqual({
      documentId: "d1",
      clinicianStaffId: "s1",
      clinicianProfileId: "p1",
      fullName: "Dr A",
      credentialType: "MDCN",
      credentialNumber: "12345",
    });
  });

  it("yields no entry when the caller is not entitled (zero rows)", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    expect((await fetchDocumentFolios({ rpc }, "lab_result_interpretation", ["d1"])).has("d1")).toBe(false);
  });

  it("throws on a database error instead of printing an unnumbered document", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(fetchDocumentFolios({ rpc }, "referral_letter", ["d1"])).rejects.toThrow("boom");
  });
});

describe("fetchDocumentFolios error handling", () => {
  const dirRows = [
    { id: "s1", profile_id: "p1", full_name: "Dr A", credential_type: "MDCN", credential_number: "999", active: true },
    { id: "s2", profile_id: "p2", full_name: "Dr B", credential_type: "MDCN", credential_number: "888", active: false },
  ];
  function fakeWithMissingFunction(code: string, message = "boom") {
    const inFn = jest.fn().mockResolvedValue({ data: dirRows, error: null });
    const select = jest.fn().mockReturnValue({ in: inFn });
    const from = jest.fn().mockReturnValue({ select });
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message, code } });
    return { client: { rpc, from }, from, inFn };
  }

  it("falls back to the directory view when the function is not deployed yet (PGRST202)", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, from, inFn } = fakeWithMissingFunction("PGRST202");
    const m = await fetchDocumentFolios(client as never, "referral_letter", ["d1"], { d1: "p1" });
    expect(from).toHaveBeenCalledWith("clinical_staff_directory");
    expect(inFn).toHaveBeenCalledWith("profile_id", ["p1"]);
    expect(m.get("d1")?.credentialNumber).toBe("999");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each([["42883"], ["XX000"]])("also falls back for code/message %s", async (code) => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = fakeWithMissingFunction(code, code === "XX000" ? "Could not find the function public.clinician_folio_for_document" : "boom");
    expect((await fetchDocumentFolios(client as never, "prescription", ["d1"], { d1: "p1" })).has("d1")).toBe(true);
  });

  it("uses the staff id column for verified documents and skips inactive clinicians for referrals", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, inFn } = fakeWithMissingFunction("PGRST202");
    await fetchDocumentFolios(client as never, "verified_document", ["d1"], { d1: "s1" });
    expect(inFn).toHaveBeenCalledWith("id", ["s1"]);
    const m = await fetchDocumentFolios(fakeWithMissingFunction("PGRST202").client as never, "referral_letter", ["d2"], { d2: "p2" });
    expect(m.has("d2")).toBe(false);
  });

  it("any other error still throws", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: "db down", code: "08006" } });
    await expect(fetchDocumentFolios({ rpc } as never, "referral_letter", ["d1"])).rejects.toThrow("db down");
  });

  it("turns 42501 into a visible refusal, not an empty map", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: "not entitled", code: "42501" } });
    await expect(fetchDocumentFolios({ rpc } as never, "prescription", ["d1"])).rejects.toBeInstanceOf(DocumentFolioRefusedError);
  });

  it("omits an entitled document whose clinician has no staff row (null folio)", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ document_id: "d1", clinician_staff_id: null, clinician_profile_id: null, full_name: null, credential_type: null, credential_number: null }],
      error: null,
    });
    expect((await fetchDocumentFolios({ rpc } as never, "prescription", ["d1"])).size).toBe(0);
  });
});
