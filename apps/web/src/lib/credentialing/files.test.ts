import { describe, expect, it } from "@jest/globals";
import { checkDocumentUpload, detectDocumentType } from "./files";

const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);
const script = new TextEncoder().encode("#!/bin/sh\nrm -rf /\n");
const riffNotWebp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

describe("detectDocumentType", () => {
  it("recognises the four accepted types from their first bytes", () => {
    expect(detectDocumentType(pdf)).toEqual({ ext: "pdf", mime: "application/pdf" });
    expect(detectDocumentType(jpeg)).toEqual({ ext: "jpg", mime: "image/jpeg" });
    expect(detectDocumentType(png)).toEqual({ ext: "png", mime: "image/png" });
    expect(detectDocumentType(webp)).toEqual({ ext: "webp", mime: "image/webp" });
  });

  it("refuses anything else, however it is named", () => {
    expect(detectDocumentType(exe)).toBeNull();
    expect(detectDocumentType(script)).toBeNull();
    expect(detectDocumentType(riffNotWebp)).toBeNull();
    expect(detectDocumentType(new Uint8Array())).toBeNull();
    expect(detectDocumentType(Uint8Array.from([0x25, 0x50]))).toBeNull();
  });
});

describe("checkDocumentUpload", () => {
  const max = 8 * 1024 * 1024;

  it("accepts a real PDF that says it is a PDF", () => {
    const r = checkDocumentUpload({ bytes: pdf, claimedMime: "application/pdf", maxBytes: max });
    expect(r.ok).toBe(true);
  });

  it("accepts image/jpg as the JPEG alias some phones send", () => {
    const r = checkDocumentUpload({ bytes: jpeg, claimedMime: "image/jpg", maxBytes: max });
    expect(r.ok).toBe(true);
  });

  it("refuses an executable claiming to be a PDF", () => {
    const r = checkDocumentUpload({ bytes: exe, claimedMime: "application/pdf", maxBytes: max });
    expect(r).toEqual({ ok: false, error: "We can only take a PDF, JPG, PNG or WebP file." });
  });

  it("refuses a PNG that claims to be a PDF", () => {
    const r = checkDocumentUpload({ bytes: png, claimedMime: "application/pdf", maxBytes: max });
    expect(r.ok).toBe(false);
  });

  it("refuses an unknown claimed type even when the bytes are fine", () => {
    const r = checkDocumentUpload({ bytes: pdf, claimedMime: "application/octet-stream", maxBytes: max });
    expect(r.ok).toBe(false);
  });

  it("refuses an empty file and an oversize file", () => {
    expect(checkDocumentUpload({ bytes: new Uint8Array(), claimedMime: "application/pdf", maxBytes: max }).ok).toBe(false);
    const big = new Uint8Array(max + 1);
    big.set(pdf);
    const r = checkDocumentUpload({ bytes: big, claimedMime: "application/pdf", maxBytes: max });
    expect(r).toEqual({ ok: false, error: "That file is too large. The most we can take is 8 MB." });
  });
});
