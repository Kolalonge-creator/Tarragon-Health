import { SIGNATURE_MAX_BYTES, sniffImageFormat, signatureDataUrl, signatureObjectPath, validateSignatureFile } from "./signature-image";

describe("validateSignatureFile", () => {
  it("accepts a PNG and a JPEG within the limit", () => {
    expect(validateSignatureFile({ type: "image/png", size: 1000 })).toEqual({ status: "ok", format: "png", contentType: "image/png" });
    expect(validateSignatureFile({ type: "image/jpeg", size: 1000 })).toEqual({ status: "ok", format: "jpg", contentType: "image/jpeg" });
  });
  it("refuses WebP, SVG, PDF, empty and oversize files", () => {
    for (const type of ["image/webp", "image/svg+xml", "application/pdf", ""]) {
      expect(validateSignatureFile({ type, size: 1000 }).status).toBe("error");
    }
    expect(validateSignatureFile({ type: "image/png", size: 0 }).status).toBe("error");
    expect(validateSignatureFile({ type: "image/png", size: SIGNATURE_MAX_BYTES + 1 }).status).toBe("error");
    expect(validateSignatureFile({ type: "image/png", size: SIGNATURE_MAX_BYTES }).status).toBe("ok");
  });
});

describe("signatureObjectPath", () => {
  it("is organisation folder, uuid, extension", () => {
    expect(signatureObjectPath("org", "id", "png")).toBe("org/id.png");
  });
});

describe("sniffImageFormat / signatureDataUrl", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  it("recognises real PNG and JPEG bytes", () => {
    expect(sniffImageFormat(png)).toBe("png");
    expect(sniffImageFormat(jpg)).toBe("jpg");
    expect(signatureDataUrl(png)).toMatch(/^data:image\/png;base64,/);
    expect(signatureDataUrl(jpg)).toMatch(/^data:image\/jpeg;base64,/);
  });
  it("refuses anything else, whatever its name said", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(sniffImageFormat(html)).toBeNull();
    expect(signatureDataUrl(svg)).toBeNull();
    expect(signatureDataUrl(new Uint8Array())).toBeNull();
  });
});
