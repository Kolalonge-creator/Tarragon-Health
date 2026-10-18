import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { MARKETING_FETCH_TIMEOUT_MS, marketingAnonClient } from "./anon-client";

describe("marketingAnonClient", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it("gives every request a timeout signal so a stalled call cannot hold a build worker", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
    const seen: (AbortSignal | null | undefined)[] = [];
    global.fetch = jest.fn(async (_u: unknown, init?: RequestInit) => {
      seen.push(init?.signal);
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const client = marketingAnonClient();
    expect(client).not.toBeNull();
    await client!.from("anything").select("*");
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(MARKETING_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });
});
