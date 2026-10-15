import { fetchDocumentFolios } from "./document-folio";

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
