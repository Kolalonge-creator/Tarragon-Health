const downloadMock = jest.fn();
const maybeSingleMock = jest.fn();
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }),
    storage: { from: () => ({ download: downloadMock }) },
  }),
}));

import { loadPrescriberSignature } from "./signature";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const blobOf = (bytes: Uint8Array) => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

beforeEach(() => {
  downloadMock.mockReset();
  maybeSingleMock.mockReset();
});

describe("loadPrescriberSignature", () => {
  it("returns a PNG data URL for a stored signature", async () => {
    maybeSingleMock.mockResolvedValue({ data: { signature_path: "org/id.png" } });
    downloadMock.mockResolvedValue({ data: blobOf(PNG), error: null });
    expect(await loadPrescriberSignature("profile")).toMatch(/^data:image\/png;base64,/);
    expect(downloadMock).toHaveBeenCalledWith("org/id.png");
  });

  it("returns null with no prescriber, no signature on file, a failed download, or bytes that are not an image", async () => {
    expect(await loadPrescriberSignature(null)).toBeNull();
    maybeSingleMock.mockResolvedValue({ data: { signature_path: null } });
    expect(await loadPrescriberSignature("profile")).toBeNull();
    maybeSingleMock.mockResolvedValue({ data: { signature_path: "org/id.png" } });
    downloadMock.mockResolvedValue({ data: null, error: { message: "gone" } });
    expect(await loadPrescriberSignature("profile")).toBeNull();
    downloadMock.mockResolvedValue({ data: blobOf(new TextEncoder().encode("<svg onload=alert(1)>")), error: null });
    expect(await loadPrescriberSignature("profile")).toBeNull();
  });

  it("never throws: an error while reading degrades to no signature", async () => {
    maybeSingleMock.mockRejectedValue(new Error("boom"));
    expect(await loadPrescriberSignature("profile")).toBeNull();
  });
});
