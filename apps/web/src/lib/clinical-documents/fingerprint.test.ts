import { fileSha256 } from "./fingerprint";
import { isDuplicateDocumentError, DUPLICATE_DOCUMENT_MESSAGE } from "./duplicate";

describe("fileSha256", () => {
  it("returns the SHA-256 of the file bytes as 64 lowercase hex characters", async () => {
    const file = new Blob([new TextEncoder().encode("abc")]);
    // FIPS 180-2 test vector for "abc"
    await expect(fileSha256(file)).resolves.toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("differs when one byte differs", async () => {
    const a = await fileSha256(new Blob([new Uint8Array([1, 2, 3])]));
    const b = await fileSha256(new Blob([new Uint8Array([1, 2, 4])]));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("isDuplicateDocumentError", () => {
  it("recognises the intake trigger's refusal", () => {
    expect(isDuplicateDocumentError({ code: "23505", message: "clinical_document_duplicate" })).toBe(true);
  });

  it("recognises the race backstop (the unique index)", () => {
    expect(
      isDuplicateDocumentError({ code: "23505", message: 'duplicate key value violates unique constraint "clinical_documents_one_file_per_patient"' }),
    ).toBe(true);
  });

  it("does not treat other unique violations or other errors as a duplicate document", () => {
    expect(isDuplicateDocumentError({ code: "23505", message: "duplicate key value violates unique constraint \"x\"" })).toBe(false);
    expect(isDuplicateDocumentError({ message: "Not permitted" })).toBe(false);
    expect(isDuplicateDocumentError(null)).toBe(false);
  });

  it("has a message that tells the uploader what happened without blaming them", () => {
    expect(DUPLICATE_DOCUMENT_MESSAGE).toContain("already in this record");
  });
});
