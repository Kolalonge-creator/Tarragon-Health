import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getKnownDevices } from "./known-devices";

function client(answer: { data: unknown; error: unknown }): SupabaseClient<Database> {
  return {
    from: jest.fn(() => ({
      select: () => ({
        order: () => ({
          limit: async () => answer,
        }),
      }),
    })),
  } as unknown as SupabaseClient<Database>;
}

describe("getKnownDevices", () => {
  it("maps snake_case rows to the camelCase KnownDevice shape", async () => {
    const devices = await getKnownDevices(
      client({
        data: [
          {
            id: "d1",
            user_agent: "TestAgent/1.0",
            last_ip: "203.0.113.5",
            last_seen_at: "2026-09-18T12:00:00Z",
            sign_in_count: 3,
          },
        ],
        error: null,
      })
    );

    expect(devices).toEqual([
      {
        id: "d1",
        userAgent: "TestAgent/1.0",
        lastIp: "203.0.113.5",
        lastSeenAt: "2026-09-18T12:00:00Z",
        signInCount: 3,
      },
    ]);
  });

  it("returns an empty list rather than throwing when the read errors", () => {
    // RLS already scopes this to the caller's own rows — a failed read must
    // degrade to "no device history shown", never crash the account page.
    return expect(
      getKnownDevices(client({ data: null, error: { message: "permission denied" } }))
    ).resolves.toEqual([]);
  });

  it("returns an empty list when there is no data", () => {
    return expect(getKnownDevices(client({ data: null, error: null }))).resolves.toEqual([]);
  });
});
