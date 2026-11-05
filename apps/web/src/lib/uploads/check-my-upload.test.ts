/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): "check the file I just uploaded". Only a signed-in user, only their own object, and a
 * file the sweep already quarantined is still reported as refused so the screen never points at a removed file.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

const run = jest.fn<(service: unknown, options: unknown) => Promise<unknown>>();
const outcome = jest.fn<() => Promise<{ data: string | null; error: null }>>();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: () => outcome() }) }));
jest.mock("./verify-stored-upload", () => ({ runClientUploadChecks: (s: unknown, o: unknown) => run(s, o) }));

import { checkMyUpload } from "./check-my-upload";

const client = (userId: string | null) =>
  ({ auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) } }) as unknown as SupabaseClient<Database>;
const none = { clean: 0, cleaned: 0, quarantined: 0, gone: 0, error: 0 };

beforeEach(() => {
  run.mockReset();
  outcome.mockReset();
});

describe("checkMyUpload", () => {
  it("refuses a caller who is not signed in, and bad input, before touching anything", async () => {
    expect(await checkMyUpload(client(null), { bucket: "meal-photos", path: "u1/a.jpg" })).toEqual({ error: "Not signed in" });
    expect(await checkMyUpload(client("u1"), { bucket: "", path: 3 })).toEqual({ error: "Invalid request" });
    expect(run).not.toHaveBeenCalled();
  });

  it("checks only that object, for the signed-in user as owner (never an id from the request)", async () => {
    run.mockResolvedValue({ checked: 1, outcomes: none });
    expect(await checkMyUpload(client("u1"), { bucket: "meal-photos", path: "u1/a.jpg", ownerId: "someone-else" })).toEqual({ checked: true, refused: false });
    expect(run.mock.calls[0]![1]).toEqual({ limit: 1, only: { bucket: "meal-photos", name: "u1/a.jpg", ownerId: "u1" } });
  });

  it("reports a refusal", async () => {
    run.mockResolvedValue({ checked: 1, outcomes: { ...none, quarantined: 1 } });
    expect(await checkMyUpload(client("u1"), { bucket: "meal-photos", path: "u1/a.jpg" })).toEqual({ checked: true, refused: true });
  });

  it("a file the sweep already quarantined is still reported as refused", async () => {
    run.mockResolvedValue({ checked: 0, outcomes: none });
    outcome.mockResolvedValue({ data: "quarantined", error: null });
    expect(await checkMyUpload(client("u1"), { bucket: "meal-photos", path: "u1/a.jpg" })).toEqual({ checked: false, refused: true });
    outcome.mockResolvedValue({ data: "clean", error: null });
    expect(await checkMyUpload(client("u1"), { bucket: "meal-photos", path: "u1/a.jpg" })).toEqual({ checked: false, refused: false });
  });
});
