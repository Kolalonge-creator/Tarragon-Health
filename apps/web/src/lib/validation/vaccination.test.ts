import {
  validateCertificateFile,
  vaccinationVerificationDecisionSchema,
} from "./vaccination";

function fakeFile(type: string, sizeBytes: number): File {
  // A File whose reported size we control without allocating the bytes.
  const file = new File(["x"], "cert", { type });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

describe("validateCertificateFile", () => {
  it("accepts a normal-sized image", () => {
    expect(validateCertificateFile(fakeFile("image/jpeg", 2 * 1024 * 1024))).toBeNull();
  });

  it("accepts a PDF", () => {
    expect(validateCertificateFile(fakeFile("application/pdf", 1024))).toBeNull();
  });

  it("rejects an unsupported type", () => {
    expect(validateCertificateFile(fakeFile("text/plain", 1024))).toMatch(/photo|PDF/i);
  });

  it("rejects a file over 10 MB", () => {
    expect(validateCertificateFile(fakeFile("image/png", 11 * 1024 * 1024))).toMatch(/10 MB/);
  });
});

describe("vaccinationVerificationDecisionSchema", () => {
  const recordId = "11111111-1111-4111-8111-111111111111";

  it("accepts a verified decision with a note", () => {
    const result = vaccinationVerificationDecisionSchema.safeParse({
      record_id: recordId,
      decision: "verified",
      note: "Certificate legible, matches record",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown decision", () => {
    const result = vaccinationVerificationDecisionSchema.safeParse({
      record_id: recordId,
      decision: "maybe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid record id", () => {
    const result = vaccinationVerificationDecisionSchema.safeParse({
      record_id: "not-a-uuid",
      decision: "rejected",
    });
    expect(result.success).toBe(false);
  });
});
