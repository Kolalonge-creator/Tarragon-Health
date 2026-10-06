import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getSignoffQueue } from "./signoff-queue";

type Settled = { data: unknown; error: unknown; count: number | null };
type Chain = {
  select: () => Chain;
  eq: () => Chain;
  in: () => Chain;
  not: () => Chain;
  is: () => Chain;
  maybeSingle: () => Promise<Settled>;
  then: Promise<Settled>["then"];
};

/** A client whose every query chain resolves to the canned answer for its table. */
function client(tables: Record<string, { data?: unknown; error?: unknown; count?: number }>): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      const answer = tables[table] ?? {};
      const settled: Settled = { data: answer.data ?? null, error: answer.error ?? null, count: answer.count ?? null };
      const chain: Chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        not: () => chain,
        is: () => chain,
        maybeSingle: async () => settled,
        then: (resolve, reject) => Promise.resolve(settled).then(resolve, reject),
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

const unsignedAlertRules = {
  alert_rules: { data: { version: 4, approved_by: null, created_at: "2026-09-01T00:00:00Z" } },
};

describe("getSignoffQueue links", () => {
  it("points every item into the Chief Medical Officer's own console when asked", async () => {
    const items = await getSignoffQueue(
      client({
        ...unsignedAlertRules,
        protocol_drafts: { data: [{ id: "d1", protocol_id: "htn", title: "Hypertension", status: "draft" }] },
        lpe_content_blocks: { count: 3 },
        result_release_policies: { data: [{ id: "r1", version: 1, is_active: true, approved_at: null }] },
        clinical_rules: { data: [{ id: "c1", status: "shadow", owner_clinical_staff_id: "s", protocol_version_id: "p", approved_by: null }] },
      }),
      "/clinician"
    );

    expect(items.length).toBeGreaterThan(0);
    // /admin/* is refused for a `clinician` login, so a single admin link is a dead end for the CMO.
    expect(items.filter((i) => i.href.startsWith("/admin"))).toEqual([]);
    expect(items.find((i) => i.key === "versioned:alert_rules")?.href).toBe("/clinician/alert-rules");
    expect(items.find((i) => i.key === "lpe_content_blocks")?.href).toBe("/clinician/lpe-content-library");
    expect(items.find((i) => i.key === "result_release_policies")?.href).toBe("/clinician/result-release-policies");
    expect(items.find((i) => i.key === "protocol_draft:d1")?.href).toBe("/clinician/protocols");
  });

  it("keeps the admin hub's links unchanged by default", async () => {
    const items = await getSignoffQueue(client(unsignedAlertRules));
    expect(items.find((i) => i.key === "versioned:alert_rules")?.href).toBe("/admin/settings/alert-rules");
  });
});

describe("getSignoffQueue result release policy", () => {
  it("flags a live policy that was never signed as live and unsigned", async () => {
    const items = await getSignoffQueue(
      client({ result_release_policies: { data: [{ id: "r1", version: 1, is_active: true, approved_at: null }] } })
    );
    expect(items.find((i) => i.key === "result_release_policies")?.severity).toBe("live_unsigned");
  });

  it("flags a drafted re-attestation as ready to sign when the live one is already signed", async () => {
    const items = await getSignoffQueue(
      client({
        result_release_policies: {
          data: [
            { id: "r1", version: 1, is_active: true, approved_at: "2026-09-04T00:00:00Z" },
            { id: "r2", version: 2, is_active: false, approved_at: null },
          ],
        },
      })
    );
    expect(items.find((i) => i.key === "result_release_policies")?.severity).toBe("draft_pending");
  });

  it("says nothing when the live policy is signed and no draft is waiting", async () => {
    const items = await getSignoffQueue(
      client({ result_release_policies: { data: [{ id: "r1", version: 1, is_active: true, approved_at: "2026-09-04T00:00:00Z" }] } })
    );
    expect(items.find((i) => i.key === "result_release_policies")).toBeUndefined();
  });

  it("throws on a failed read rather than reporting the policy as signed", async () => {
    await expect(getSignoffQueue(client({ result_release_policies: { error: { message: "boom" } } }))).rejects.toThrow(
      /result_release_policies/
    );
  });
});
