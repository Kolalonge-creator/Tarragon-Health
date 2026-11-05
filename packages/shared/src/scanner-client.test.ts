import { jest } from "@jest/globals";

import { createScannerClient, createScannerClientFromEnv, SCANNER_MAX_BYTES, type ScanResponse } from "./scanner-client";

const CONFIG = { baseUrl: "http://scanner.test/", serviceKey: "secret" };
const SHA = "a".repeat(64);

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
}

const clean: ScanResponse = {
  status: "clean",
  signature: null,
  engine_version: "ClamAV 1.4.1",
  db_version: "27450",
  db_date: null,
  size_bytes: 3,
  sha256: SHA,
  detail: null,
};

describe("createScannerClient", () => {
  it("posts raw bytes with the service key and returns the verdict", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(clean));
    const result = await createScannerClient({ ...CONFIG, fetchImpl }).scan(new Uint8Array([1, 2, 3]));
    expect(result).toEqual(clean);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://scanner.test/scan");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Service-Key"]).toBe("secret");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect((init?.body as ArrayBuffer).byteLength).toBe(3);
  });

  it("returns an infected verdict with its signature", async () => {
    const infected = { ...clean, status: "infected", signature: "Eicar-Test-Signature" };
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(infected));
    const result = await createScannerClient({ ...CONFIG, fetchImpl }).scan(new Blob(["x"]));
    expect(result?.status).toBe("infected");
    expect(result?.signature).toBe("Eicar-Test-Signature");
  });

  it("returns a 200 'error' verdict as-is (the caller holds the file)", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...clean, status: "error", detail: "x" }));
    expect((await createScannerClient({ ...CONFIG, fetchImpl }).scan(new Uint8Array([1])))?.status).toBe("error");
  });

  it("returns null on a non-2xx (the scanner's 503 when clamd is down)", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...clean, status: "error" }, { status: 503 }));
    expect(await createScannerClient({ ...CONFIG, fetchImpl }).scan(new Uint8Array([1]))).toBeNull();
  });

  it("returns null on a network error, never throws", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(createScannerClient({ ...CONFIG, fetchImpl }).scan(new Uint8Array([1]))).resolves.toBeNull();
  });

  it("returns null when the response is not the expected shape", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "clean" }));
    expect(await createScannerClient({ ...CONFIG, fetchImpl }).scan(new Uint8Array([1]))).toBeNull();
    const fetchBad = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...clean, status: "probably_fine" }));
    expect(await createScannerClient({ ...CONFIG, fetchImpl: fetchBad }).scan(new Uint8Array([1]))).toBeNull();
  });

  it("returns null on a timeout", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    expect(await createScannerClient({ ...CONFIG, fetchImpl, timeoutMs: 10 }).scan(new Uint8Array([1]))).toBeNull();
  });

  it("does not send an empty or over-size body", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(clean));
    const client = createScannerClient({ ...CONFIG, fetchImpl });
    expect(await client.scan(new Uint8Array([]))).toBeNull();
    expect(await client.scan(new Uint8Array(SCANNER_MAX_BYTES + 1))).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("health returns null when unreachable", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new Error("down"));
    expect(await createScannerClient({ ...CONFIG, fetchImpl }).health()).toBeNull();
  });
});

describe("createScannerClientFromEnv", () => {
  it("is null (scan switched off) without a URL or without a key", () => {
    expect(createScannerClientFromEnv({})).toBeNull();
    expect(createScannerClientFromEnv({ SCANNER_SERVICE_URL: "https://s.test" })).toBeNull();
    expect(createScannerClientFromEnv({ SCANNER_SERVICE_KEY: "k" })).toBeNull();
  });
  it("builds a client when both are set", () => {
    expect(createScannerClientFromEnv({ SCANNER_SERVICE_URL: "https://s.test", SCANNER_SERVICE_KEY: "k" })).not.toBeNull();
  });
});
