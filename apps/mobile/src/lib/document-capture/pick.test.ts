import { looksLikePdf } from "./pick";

jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-document-picker", () => ({}));
jest.mock("expo-image-manipulator", () => ({ ImageManipulator: {}, SaveFormat: { JPEG: "jpeg" } }));

describe("choosing a PDF (S43m)", () => {
  it("accepts only bytes that start with the PDF signature, whatever the file is called", () => {
    expect(looksLikePdf(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe(true);
    expect(looksLikePdf(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe(false);
    expect(looksLikePdf(new Uint8Array(0))).toBe(false);
    expect(looksLikePdf(Uint8Array.from([0x25, 0x50, 0x44]))).toBe(false);
  });
});
