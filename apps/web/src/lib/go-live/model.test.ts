import { describe, expect, it } from "@jest/globals";
import { PROPOSED_CONFIG, type ProposedConfigEntry } from "@tarragon/shared";
import {
  buildConfigRows,
  findEntry,
  groupGuards,
  guardHasDrifted,
  guardIsOpen,
  guardListSchema,
  hashConfigValue,
  openRows,
  signoffListSchema,
  viewerMaySwitchOn,
  viewerOwns,
  type ConfigSignoff,
  type GuardStatus,
} from "./model";

const entry = (over: Partial<ProposedConfigEntry> = {}): ProposedConfigEntry => ({
  key: "paging.escalation_minutes",
  value: [5, 10],
  owner: "CMO",
  status: "proposed",
  version: 1,
  effectiveFrom: "2026-09-30",
  source: "test",
  ...over,
});
const signoff = (over: Partial<ConfigSignoff> = {}): ConfigSignoff => ({
  key: "paging.escalation_minutes",
  version: 1,
  value_hash: hashConfigValue([5, 10]),
  owner: "CMO",
  decision: "confirmed",
  note: null,
  signed_at: "2026-10-06T10:00:00Z",
  signed_by_name: "Dr Test",
  ...over,
});

describe("hashConfigValue", () => {
  it("is a sha-256 hex digest and does not depend on object key order", () => {
    expect(hashConfigValue({ a: 1, b: { c: [1, 2], d: null } })).toMatch(/^[0-9a-f]{64}$/);
    expect(hashConfigValue({ a: 1, b: { d: null, c: [1, 2] } })).toBe(hashConfigValue({ b: { c: [1, 2], d: null }, a: 1 }));
  });

  it("changes when the value changes, so an old sign-off stops counting", () => {
    expect(hashConfigValue([5, 10])).not.toBe(hashConfigValue([5, 11]));
    expect(hashConfigValue(5)).not.toBe(hashConfigValue("5"));
    expect(hashConfigValue([1, 2])).not.toBe(hashConfigValue([2, 1]));
  });
});

describe("buildConfigRows", () => {
  it("shows a value nobody has signed as waiting", () => {
    const [row] = buildConfigRows([entry()], [], "2026-10-06");
    expect(row?.status).toBe("awaiting");
    expect(row?.signoff).toBeNull();
  });

  it("counts a confirmation only against the same value (hash), otherwise it is stale", () => {
    expect(buildConfigRows([entry()], [signoff()], "2026-10-06")[0]?.status).toBe("signed");
    expect(buildConfigRows([entry({ value: [5, 12] })], [signoff()], "2026-10-06")[0]?.status).toBe("stale");
  });

  it("keeps a change request as a change request and does not count it as confirmed", () => {
    const rows = buildConfigRows([entry()], [signoff({ decision: "changes_requested", note: "make it 8" })], "2026-10-06");
    expect(rows[0]?.status).toBe("changes_requested");
    expect(openRows(rows)).toHaveLength(1);
  });

  it("needs no sign-off for an entry the owner already published as confirmed", () => {
    const rows = buildConfigRows([entry({ status: "confirmed" })], [], "2026-10-06");
    expect(rows[0]?.status).toBe("confirmed_in_registry");
    expect(openRows(rows)).toHaveLength(0);
  });

  it("uses the version in force and ignores a sign-off for an older version", () => {
    const rows = buildConfigRows([entry(), entry({ version: 2, value: [5, 8] })], [signoff()], "2026-10-06");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(2);
    expect(rows[0]?.status).toBe("awaiting");
  });

  it("skips an entry that is not effective yet", () => {
    expect(buildConfigRows([entry({ effectiveFrom: "2027-01-01" })], [], "2026-10-06")).toHaveLength(0);
  });

  it("lists every key in the real registry, each once, none pre-signed", () => {
    const rows = buildConfigRows(PROPOSED_CONFIG, [], "2026-12-31");
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows.length).toBe(new Set(PROPOSED_CONFIG.map((e) => e.key)).size);
    // no entry in the registry may arrive already signed off: a sign-off is a person's judgement and lives in the database
    expect(rows.filter((r) => r.status === "signed")).toHaveLength(0);
    for (const r of rows) expect(r.owner).toMatch(/^(CMO|Founder|Founder and counsel)$/);
  });
});

describe("who may do what", () => {
  it("lets the founder (admin) confirm founder and counsel values and the CMO confirm CMO values, and nobody else's", () => {
    expect(viewerOwns("CMO", "cmo")).toBe(true);
    expect(viewerOwns("CMO", "admin")).toBe(false);
    expect(viewerOwns("Founder", "admin")).toBe(true);
    expect(viewerOwns("Founder and counsel", "admin")).toBe(true);
    expect(viewerOwns("Founder", "cmo")).toBe(false);
    expect(viewerOwns("Founder and counsel", "cmo")).toBe(false);
  });

  it("shows the switch-on control only to the role a MASTER names", () => {
    expect(viewerMaySwitchOn({ switch_role: "admin", kind: "master" }, "admin")).toBe(true);
    expect(viewerMaySwitchOn({ switch_role: "admin", kind: "master" }, "cmo")).toBe(false);
    expect(viewerMaySwitchOn({ switch_role: "cmo", kind: "master" }, "cmo")).toBe(true);
    expect(viewerMaySwitchOn({ switch_role: "cmo", kind: "master" }, "admin")).toBe(false);
    // a status read from a database without the G-01 columns behaves as before
    expect(viewerMaySwitchOn({ switch_role: "cmo" }, "admin")).toBe(false);
  });

  it("G-01: a FEATURE can be opened by either viewer, whatever role the row names", () => {
    expect(viewerMaySwitchOn({ switch_role: "cmo", kind: "feature" }, "admin")).toBe(true);
    expect(viewerMaySwitchOn({ switch_role: "admin", kind: "feature" }, "cmo")).toBe(true);
  });

  it("flags a MASTER that is on while a condition is no longer met, never a feature (its conditions are advisory)", () => {
    expect(guardHasDrifted({ is_on: true, all_met: false, kind: "master" })).toBe(true);
    expect(guardHasDrifted({ is_on: true, all_met: false })).toBe(true);
    expect(guardHasDrifted({ is_on: true, all_met: true, kind: "master" })).toBe(false);
    expect(guardHasDrifted({ is_on: false, all_met: false, kind: "master" })).toBe(false);
    expect(guardHasDrifted({ is_on: true, all_met: false, kind: "feature" })).toBe(false);
  });

  it("G-01: the effective answer is the database's open when it is present, else the row's own switch", () => {
    expect(guardIsOpen({ is_on: true, open: false })).toBe(false);
    expect(guardIsOpen({ is_on: false, open: true })).toBe(true);
    expect(guardIsOpen({ is_on: true })).toBe(true);
  });
});

describe("groupGuards (G-01 layout)", () => {
  const g = (key: string, over: Partial<GuardStatus> = {}): GuardStatus => ({
    key,
    label: key,
    blocks: "x",
    condition_text: "x",
    switch_role: "admin",
    enforced_in: [],
    not_enforced_in: "",
    is_on: false,
    changed_at: null,
    changed_by_name: null,
    change_note: null,
    conditions: [],
    all_met: true,
    recent: [],
    ...over,
  });

  it("puts each feature under its master and the rest on their own, keeping the database order", () => {
    const list = [
      g("clinical_operations_enabled", { kind: "master" }),
      g("checkout_enabled", { kind: "master" }),
      g("pathway_bp", { kind: "feature", parent_key: "clinical_operations_enabled" }),
      g("wallet_pass", { kind: "feature", parent_key: null, held_reason: "No certificate is configured yet." }),
      g("symptom_checker_enabled", { kind: "feature", parent_key: "clinical_operations_enabled" }),
    ];
    const { groups, standalone } = groupGuards(list);
    expect(groups.map((x) => x.master.key)).toEqual(["clinical_operations_enabled", "checkout_enabled"]);
    expect(groups[0]?.features.map((f) => f.key)).toEqual(["pathway_bp", "symptom_checker_enabled"]);
    expect(groups[1]?.features).toEqual([]);
    expect(standalone.map((f) => f.key)).toEqual(["wallet_pass"]);
  });

  it("treats a status without kinds (pre-G-01 database) as masters only, so the page still renders", () => {
    const { groups, standalone } = groupGuards([g("payouts_enabled"), g("scribe_enabled")]);
    expect(groups.map((x) => x.master.key)).toEqual(["payouts_enabled", "scribe_enabled"]);
    expect(standalone).toEqual([]);
  });

  it("never drops a feature whose parent is missing from the list", () => {
    const { groups, standalone } = groupGuards([g("orphan", { kind: "feature", parent_key: "no_such_master" })]);
    expect(groups).toEqual([]);
    expect(standalone.map((f) => f.key)).toEqual(["orphan"]);
  });
});

describe("findEntry", () => {
  it("finds an entry by key and version from the registry, and nothing else", () => {
    expect(findEntry(PROPOSED_CONFIG, "paging.escalation_minutes", 1)?.owner).toBe("CMO");
    expect(findEntry(PROPOSED_CONFIG, "paging.escalation_minutes", 99)).toBeNull();
    expect(findEntry(PROPOSED_CONFIG, "no.such_key", 1)).toBeNull();
  });
});

describe("result schemas", () => {
  it("parse what the database functions return and reject a changed shape", () => {
    const guard = {
      key: "payouts_enabled",
      label: "Payouts",
      blocks: "Payout sending",
      condition_text: "x",
      switch_role: "admin",
      enforced_in: [],
      not_enforced_in: "",
      is_on: false,
      changed_at: null,
      changed_by_name: null,
      change_note: null,
      conditions: [{ code: "a", label: "A", met: false, source: "attestation", detail: null }],
      all_met: false,
      recent: [],
    };
    expect(guardListSchema.safeParse([guard]).success).toBe(true);
    expect(guardListSchema.safeParse([{ ...guard, switch_role: "founder" }]).success).toBe(false);
    expect(guardListSchema.safeParse([{ ...guard, conditions: [{ code: "a" }] }]).success).toBe(false);
    expect(signoffListSchema.safeParse([signoff()]).success).toBe(true);
    expect(signoffListSchema.safeParse([{ ...signoff(), decision: "maybe" }]).success).toBe(false);
  });
});
