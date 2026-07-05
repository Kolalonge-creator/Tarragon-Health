import { jest } from "@jest/globals";

import {
  createMlClient,
  createMlClientFromEnv,
  ML_DEFAULT_TIMEOUT_MS,
  type MlHealth,
} from "./ml-client";

const CONFIG = { baseUrl: "http://ml.test", serviceKey: "secret" };

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("createMlClient", () => {
  const health: MlHealth = {
    status: "ok",
    service: "tarragon-ml",
    version: "0.1.0",
    environment: "test",
  };

  it("returns parsed JSON and sends the X-Service-Key header on success", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(health));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.health();

    expect(result).toEqual(health);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://ml.test/health");
    expect((init?.headers as Record<string, string>)["X-Service-Key"]).toBe(
      "secret",
    );
  });

  it("serialises the body and sets Content-Type for POST", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ risk: 0.12 }));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.post<{ risk: number }>("/risk/cvd", {
      age: 55,
    });

    expect(result).toEqual({ risk: 0.12 });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.body).toBe(JSON.stringify({ age: 55 }));
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("returns null on a non-2xx response", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("nope", { status: 500 }));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    expect(await client.health()).toBeNull();
  });

  it("returns null when fetch rejects (network error)", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    expect(await client.health()).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>not json</html>", { status: 200 }));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    expect(await client.health()).toBeNull();
  });

  it("aborts and returns null when the request exceeds the timeout", async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = (init as RequestInit).signal;
            signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );
      const client = createMlClient({ ...CONFIG, fetchImpl, timeoutMs: 50 });

      const pending = client.health();
      jest.advanceTimersByTime(51);
      expect(await pending).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("createMlClientFromEnv", () => {
  it("returns null when env vars are missing", () => {
    expect(createMlClientFromEnv({})).toBeNull();
    expect(createMlClientFromEnv({ ML_SERVICE_URL: "http://x" })).toBeNull();
  });

  it("builds a client when both env vars are present", () => {
    const client = createMlClientFromEnv({
      ML_SERVICE_URL: "http://ml.test",
      ML_SERVICE_KEY: "secret",
    });
    expect(client).not.toBeNull();
  });

  it("exposes the documented default timeout", () => {
    expect(ML_DEFAULT_TIMEOUT_MS).toBe(5_000);
  });
});
