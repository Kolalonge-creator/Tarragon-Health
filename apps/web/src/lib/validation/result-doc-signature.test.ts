import { describe, expect, it } from "@jest/globals";
import { detectResultDocType, verifyResultDocSignature } from "./result-doc-signature";

const bytes = (...parts: (number[] | string)[]): Uint8Array<ArrayBuffer> =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

const PDF = bytes("%PDF-1.7\n", [0x25, 0xe2, 0xe3]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "JFIF");
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR");
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ");
const HEIC = bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0], "mif1heic");
const EXE = bytes("MZ", [0x90, 0, 3, 0, 0, 0]);
const HTML = bytes("<!doctype html><script>alert(1)</script>");

const file = (data: Uint8Array<ArrayBuffer>, type: string) => new Blob([data], { type });

describe("detectResultDocType", () => {
  it.each([
    ["PDF", PDF, "application/pdf"],
    ["PDF after a few leading bytes", bytes([0x0d, 0x0a], "%PDF-1.4"), "application/pdf"],
    ["JPEG", JPEG, "image/jpeg"],
    ["PNG", PNG, "image/png"],
    ["WebP", WEBP, "image/webp"],
    ["HEIC", HEIC, "image/heic"],
  ])("recognises %s", (_name, data, expected) => {
    expect(detectResultDocType(data)).toBe(expected);
  });

  it.each([
    ["an executable", EXE],
    ["an HTML page", HTML],
    ["an empty file", new Uint8Array()],
  ])("recognises nothing in %s", (_name, data) => {
    expect(detectResultDocType(data)).toBeNull();
  });
});

describe("verifyResultDocSignature", () => {
  it("accepts a real PDF declared as a PDF", async () => {
    await expect(verifyResultDocSignature(file(PDF, "application/pdf"))).resolves.toBeNull();
  });

  it("accepts a real photo declared as a photo", async () => {
    await expect(verifyResultDocSignature(file(JPEG, "image/jpeg"))).resolves.toBeNull();
    await expect(verifyResultDocSignature(file(HEIC, "image/heic"))).resolves.toBeNull();
  });

  it("accepts a photo under another photo type (a PNG named .jpg)", async () => {
    await expect(verifyResultDocSignature(file(PNG, "image/jpeg"))).resolves.toBeNull();
  });

  it.each([
    ["an executable declared as a PDF", EXE, "application/pdf"],
    ["an HTML page declared as a PNG", HTML, "image/png"],
    ["a photo declared as a PDF", JPEG, "application/pdf"],
    ["a PDF declared as a photo", PDF, "image/jpeg"],
  ])("refuses %s", async (_name, data, type) => {
    await expect(verifyResultDocSignature(file(data, type))).resolves.toMatch(/upload it again/);
  });

  it("refuses a type that is not accepted at all", async () => {
    await expect(verifyResultDocSignature(file(PDF, "application/zip"))).resolves.toMatch(/Upload a photo/);
  });
});
