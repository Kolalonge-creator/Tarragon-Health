import { beforeEach, describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  ANY_GROUP_CACHE_MS,
  isMfaEnrolmentExemptPath,
  isMfaRequiredForCaller,
  mfaEnrolmentVerdict,
  resetMfaRequirementCache,
} from "./mfa-policy";

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

function fakeClient(answers: Record<string, RpcResult | (() => RpcResult)>) {
  const calls: string[] = [];
  const client = {
    rpc: async (fn: string) => {
      calls.push(fn);
      const a = answers[fn];
      if (!a) throw new Error(`unexpected rpc ${fn}`);
      return typeof a === "function" ? a() : a;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

describe("mfaEnrolmentVerdict", () => {
  it("allows everything while the account's group is off, with or without a factor (today's behaviour)", () => {
    for (const nextLevel of ["aal1", "aal2", undefined, null]) {
      expect(mfaEnrolmentVerdict({ pathname: "/clinician", required: false, nextLevel })).toBe("allow");
      expect(mfaEnrolmentVerdict({ pathname: "/api/anything", required: false, nextLevel })).toBe("allow");
    }
  });

  it("sends a required account without a factor to set-up", () => {
    expect(mfaEnrolmentVerdict({ pathname: "/clinician", required: true, nextLevel: "aal1" })).toBe("setup");
    expect(mfaEnrolmentVerdict({ pathname: "/patient/vitals", required: true, nextLevel: "aal1" })).toBe("setup");
  });

  it("fails closed when the assurance level could not be read", () => {
    expect(mfaEnrolmentVerdict({ pathname: "/admin", required: true, nextLevel: undefined })).toBe("setup");
    expect(mfaEnrolmentVerdict({ pathname: "/admin", required: true, nextLevel: null })).toBe("setup");
  });

  it("refuses an API call from a required account without a factor instead of redirecting it", () => {
    expect(mfaEnrolmentVerdict({ pathname: "/api/admin/search", required: true, nextLevel: "aal1" })).toBe("refuse_api");
    expect(mfaEnrolmentVerdict({ pathname: "/api", required: true, nextLevel: "aal1" })).toBe("refuse_api");
  });

  it("leaves a required account WITH a factor to the step-up challenge gate", () => {
    expect(mfaEnrolmentVerdict({ pathname: "/clinician", required: true, nextLevel: "aal2" })).toBe("allow");
  });

  it("never blocks the set-up page, the challenge or the auth callbacks, so nobody is trapped in a redirect loop", () => {
    for (const pathname of ["/account", "/account/anything", "/login/mfa-challenge", "/auth/callback", "/auth/signout"]) {
      expect(mfaEnrolmentVerdict({ pathname, required: true, nextLevel: "aal1" })).toBe("allow");
    }
  });

  it("does not treat a lookalike path as the set-up page", () => {
    expect(isMfaEnrolmentExemptPath("/accounts")).toBe(false);
    expect(isMfaEnrolmentExemptPath("/account-settings")).toBe(false);
    expect(isMfaEnrolmentExemptPath("/login/mfa-challenge/x")).toBe(false);
    expect(mfaEnrolmentVerdict({ pathname: "/accounts", required: true, nextLevel: "aal1" })).toBe("setup");
  });
});

describe("isMfaRequiredForCaller", () => {
  beforeEach(() => resetMfaRequirementCache());

  it("reads nobody's own answer while no group is on, and caches that for the window", async () => {
    const { client, calls } = fakeClient({ mfa_any_group_required: { data: false, error: null } });
    expect(await isMfaRequiredForCaller(client, 1_000)).toBe(false);
    expect(await isMfaRequiredForCaller(client, 1_000 + ANY_GROUP_CACHE_MS - 1)).toBe(false);
    expect(calls).toEqual(["mfa_any_group_required"]);
    // Window over: asked again.
    await isMfaRequiredForCaller(client, 1_000 + ANY_GROUP_CACHE_MS);
    expect(calls).toEqual(["mfa_any_group_required", "mfa_any_group_required"]);
  });

  it("reads the caller's own answer, uncached, when a group is on", async () => {
    let required = true;
    const { client, calls } = fakeClient({
      mfa_any_group_required: { data: true, error: null },
      my_mfa_requirement: () => ({ data: [{ required, has_verified_factor: false }], error: null }),
    });
    expect(await isMfaRequiredForCaller(client, 1)).toBe(true);
    required = false;
    expect(await isMfaRequiredForCaller(client, 2)).toBe(false);
    expect(calls).toEqual(["mfa_any_group_required", "my_mfa_requirement", "my_mfa_requirement"]);
  });

  it("is not required when the functions do not exist yet (code deployed before the migration)", async () => {
    const { client } = fakeClient({ mfa_any_group_required: { data: null, error: { code: "PGRST202" } } });
    expect(await isMfaRequiredForCaller(client, 1)).toBe(false);
  });

  it("fails closed when the caller's own answer cannot be read", async () => {
    const { client } = fakeClient({
      mfa_any_group_required: { data: true, error: null },
      my_mfa_requirement: { data: null, error: { code: "57014", message: "timeout" } },
    });
    expect(await isMfaRequiredForCaller(client, 1)).toBe(true);
  });

  it("does not cache a failed 'is any group on' read, and still asks for the caller's own answer", async () => {
    const { client, calls } = fakeClient({
      mfa_any_group_required: { data: null, error: { code: "08006" } },
      my_mfa_requirement: { data: [{ required: true, has_verified_factor: false }], error: null },
    });
    expect(await isMfaRequiredForCaller(client, 1)).toBe(true);
    expect(await isMfaRequiredForCaller(client, 2)).toBe(true);
    expect(calls).toEqual(["mfa_any_group_required", "my_mfa_requirement", "mfa_any_group_required", "my_mfa_requirement"]);
  });

  it("treats an empty answer as not required (no signed-in user)", async () => {
    const { client } = fakeClient({
      mfa_any_group_required: { data: true, error: null },
      my_mfa_requirement: { data: [], error: null },
    });
    expect(await isMfaRequiredForCaller(client, 1)).toBe(false);
  });
});
