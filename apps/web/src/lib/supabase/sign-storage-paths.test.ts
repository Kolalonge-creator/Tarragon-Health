/**
 * signStoragePaths is the one shared batching implementation behind the
 * per-row-signed-URL N+1 fix applied across lab-results/documents.ts,
 * ecg-reports/documents.ts, and clinician/vaccinations/page.tsx (previously
 * three near-identical copy-pasted implementations). This is the exhaustive
 * test for the shared logic; each call site's own test just proves it wires
 * the right bucket/paths/ttl through rather than re-proving the batching
 * and error-handling behaviour three more times.
 */

const createSignedUrls = jest.fn();
const rpc = jest.fn(async () => ({ data: [] as string[], error: null }));

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: (...a: unknown[]) => rpc(...(a as [])),
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: (paths: string[], ttl: number) => createSignedUrls(bucket, paths, ttl),
      }),
    },
  }),
}));

import { signStoragePaths } from "./sign-storage-paths";

describe("signStoragePaths", () => {
  beforeEach(() => {
    createSignedUrls.mockReset();
  });

  it("mints every path's signed URL in a single call, passing the bucket and TTL straight through", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "a.pdf", signedUrl: "https://signed/a" },
        { path: "b.pdf", signedUrl: "https://signed/b" },
      ],
      error: null,
    });

    const result = await signStoragePaths("my-bucket", ["a.pdf", "b.pdf"], 600);

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith("my-bucket", ["a.pdf", "b.pdf"], 600);
    expect(result.get("a.pdf")).toBe("https://signed/a");
    expect(result.get("b.pdf")).toBe("https://signed/b");
  });

  it("maps results back by path, not by array index, so an out-of-order batch response still lands correctly", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "b.pdf", signedUrl: "https://signed/b" },
        { path: "a.pdf", signedUrl: "https://signed/a" },
      ],
      error: null,
    });

    const result = await signStoragePaths("my-bucket", ["a.pdf", "b.pdf"], 300);

    expect(result.get("a.pdf")).toBe("https://signed/a");
    expect(result.get("b.pdf")).toBe("https://signed/b");
  });

  it("never calls the Storage API for an empty path list", async () => {
    const result = await signStoragePaths("my-bucket", [], 300);
    expect(result.size).toBe(0);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("logs a request-level batch failure instead of silently returning nothing, so it isn't mistaken for 'nothing to sign'", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    createSignedUrls.mockResolvedValue({
      data: null,
      error: { message: "storage: service unavailable" },
    });

    const result = await signStoragePaths("my-bucket", ["a.pdf", "b.pdf"], 300);

    expect(result.size).toBe(0);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [message] = consoleError.mock.calls[0];
    expect(message).toEqual(expect.stringContaining("2"));
    expect(message).toEqual(expect.stringContaining("my-bucket"));
    consoleError.mockRestore();
  });

  it("T2-08: never signs a file held for the malware scan in a scanned bucket, and leaves other buckets alone", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "upload_scan_held_paths" ? { data: ["held.pdf"], error: null } : { data: [], error: null },
    );
    createSignedUrls.mockResolvedValue({ data: [{ path: "ok.pdf", signedUrl: "https://signed/ok" }], error: null });
    const result = await signStoragePaths("lab-result-documents", ["ok.pdf", "held.pdf"], 300);
    expect(createSignedUrls).toHaveBeenCalledWith("lab-result-documents", ["ok.pdf"], 300);
    expect(result.get("held.pdf")).toBeNull();
    expect(result.get("ok.pdf")).toBe("https://signed/ok");

    rpc.mockClear();
    await signStoragePaths("vaccination-certificates", ["v.pdf"], 300);
    expect(rpc).not.toHaveBeenCalledWith("upload_scan_held_paths", expect.anything());
  });
});
