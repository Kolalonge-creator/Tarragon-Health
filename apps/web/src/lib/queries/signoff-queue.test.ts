import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getSignoffQueue, readSignoffQueue } from "./signoff-queue";

type Settled = { data: unknown; error: unknown; count: number | null };
type Chain = {
  select: () => Chain;
  eq: () => Chain;
  in: () => Chain;
  not: () => Chain;
  is: () => Chain;
  or: () => Chain;
  order: () => Chain;
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
        or: () => chain,
        order: () => chain,
        maybeSingle: async () => settled,
        then: (resolve, reject) => Promise.resolve(settled).then(resolve, reject),
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

const unsignedAlertRules = {
  alert_rules: { data: [{ id: "a4", version: 4, is_active: true, approved_by: null, approved_at: null, created_at: "2026-09-01T00:00:00Z" }] },
};

describe("getSignoffQueue links", () => {
  it("points every item into the Chief Medical Officer's own console when asked", async () => {
    const items = await getSignoffQueue(
      client({
        ...unsignedAlertRules,
        protocol_drafts: { data: [{ id: "d1", protocol_id: "htn", title: "Hypertension", status: "draft" }] },
        lpe_content_blocks: { count: 3 },
        result_release_policies: { data: [{ id: "r1", version: 1, is_active: true, approved_at: null }] },
        clinical_rules: { data: [{ id: "c1", rule_key: "k1", version: 1, status: "shadow", owner_clinical_staff_id: "s", protocol_version_id: "p", approved_by: null }] },
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

describe("getSignoffQueue clinical rules", () => {
  const rule = (over: Record<string, unknown>) => ({
    id: "r",
    rule_key: "k",
    version: 1,
    status: "shadow",
    owner_clinical_staff_id: "s",
    protocol_version_id: "p",
    approved_by: null,
    ...over,
  });

  it("does not count an old unsigned version that a newer signed version superseded", async () => {
    // Rows arrive newest version first, as the query orders them.
    const items = await getSignoffQueue(
      client({ clinical_rules: { data: [rule({ id: "v2", version: 2, status: "active", approved_by: "staff" }), rule({ id: "v1", version: 1 })] } })
    );
    expect(items.find((i) => i.key.startsWith("clinical_rules"))).toBeUndefined();
  });

  it("counts a rule whose newest version is active but was never signed", async () => {
    const items = await getSignoffQueue(client({ clinical_rules: { data: [rule({ status: "active" })] } }));
    expect(items.find((i) => i.key === "clinical_rules_ready")?.count).toBe(1);
  });

  it("counts one line per rule_key, split by whether an owner and protocol are set", async () => {
    const items = await getSignoffQueue(
      client({
        clinical_rules: {
          data: [
            rule({ id: "a", rule_key: "a" }),
            rule({ id: "b", rule_key: "b", owner_clinical_staff_id: null }),
            rule({ id: "c", rule_key: "c", protocol_version_id: null }),
          ],
        },
      })
    );
    expect(items.find((i) => i.key === "clinical_rules_ready")?.count).toBe(1);
    expect(items.find((i) => i.key === "clinical_rules_needs_setup")?.count).toBe(2);
  });
});

describe("getSignoffQueue pending drafts of governed configs", () => {
  const live = { id: "l", version: 5, is_active: true, approved_by: "staff", approved_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z" };
  const draft = (version: number, notes = "Adds fever and abdominal pain. More detail follows.") => ({
    id: `d${version}`,
    version,
    is_active: false,
    approved_by: null,
    approved_at: null,
    created_at: "2026-09-10T00:00:00Z",
    notes,
  });

  it("lists an unsigned draft newer than the live version, with what it changes", async () => {
    const items = await getSignoffQueue(client({ triage_protocols: { data: [live, draft(6)] } }), "/clinician");
    const item = items.find((i) => i.key === "versioned_draft:triage_protocols");
    expect(item?.severity).toBe("draft_pending");
    expect(item?.href).toBe("/clinician/triage-protocols");
    expect(item?.detail).toContain("Version 6");
    expect(item?.detail).toContain("newer than the live version 5");
    expect(item?.detail).toContain("Adds fever and abdominal pain.");
    expect(item?.detail).not.toContain("More detail follows");
  });

  it("ignores old unsigned drafts that a later version superseded", async () => {
    const items = await getSignoffQueue(client({ escalation_slas: { data: [live, draft(1), draft(3), draft(4)] } }));
    expect(items.find((i) => i.key.includes("escalation_slas"))).toBeUndefined();
  });

  it("names only the highest newer draft when several are waiting", async () => {
    const items = await getSignoffQueue(client({ alert_rules: { data: [live, draft(6), draft(7)] } }));
    const mine = items.filter((i) => i.key === "versioned_draft:alert_rules");
    expect(mine).toHaveLength(1);
    expect(mine[0]?.detail).toContain("Version 7");
  });

  it("reports the live-unsigned version rather than a draft when the live one is unsigned", async () => {
    const unsignedLive = { ...live, approved_by: null, approved_at: null };
    const items = await getSignoffQueue(client({ alert_rules: { data: [unsignedLive, draft(6)] } }));
    expect(items.filter((i) => i.key.includes("alert_rules")).map((i) => i.key)).toEqual(["versioned:alert_rules"]);
  });
});

describe("readSignoffQueue partial failure", () => {
  it("keeps every other line and names the source that failed", async () => {
    const result = await readSignoffQueue(
      client({
        ...unsignedAlertRules,
        lpe_content_blocks: { error: { message: "boom" } },
      }),
      "/clinician"
    );
    expect(result.failedSources).toEqual(["lpe_content_blocks"]);
    expect(result.items.find((i) => i.key === "versioned:alert_rules")).toBeDefined();
  });

  it("reports no failed sources when everything was readable", async () => {
    expect((await readSignoffQueue(client({}))).failedSources).toEqual([]);
  });

  it("getSignoffQueue still throws, naming the source, so the admin hub never shows a short list", async () => {
    await expect(getSignoffQueue(client({ lpe_content_blocks: { error: { message: "boom" } } }))).rejects.toThrow(
      /lpe_content_blocks/
    );
  });
});
