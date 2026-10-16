import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { capacityRulesView, readPendingCapacityConfigSignoff } from "./pending-capacity-config-signoff";

const rules = { min_lead_headroom: 3, rota_horizon_hours: 72, rest_hours: 11, cover_offer_pages: 2, drill_ack_target_pct: 90, drill_ack_target_seconds: 300 };

type Rows = Record<string, { data: unknown; error: unknown }>;
const client = (rows: Rows): SupabaseClient<Database> =>
  ({ from: (table: string) => ({ select: () => Promise.resolve(rows[table] ?? { data: null, error: new Error("no table") }) }) }) as unknown as SupabaseClient<Database>;

describe("capacityRulesView", () => {
  it("reads the numbers the panel shows from the draft itself", () => {
    expect(capacityRulesView(rules)).toEqual({ minLeadHeadroom: 3, rotaHorizonHours: 72, restHours: 11, coverOfferPages: 2, drillTargetPct: 90, drillTargetMinutes: 5 });
  });

  it("returns null when a number the CMO must see is missing, rather than guessing", () => {
    expect(capacityRulesView({ ...rules, rest_hours: undefined })).toBeNull();
    expect(capacityRulesView(undefined)).toBeNull();
    expect(capacityRulesView({ ...rules, rest_hours: "11" })).toBeNull();
  });
});

describe("readPendingCapacityConfigSignoff", () => {
  const capacity = [
    { version: 1, is_active: true, approved_at: null, rules },
    { version: 2, is_active: false, approved_at: null, rules: { ...rules, rest_hours: 10 } },
  ];
  const lead = [
    { version: 1, is_active: true, approved_at: null, rules: { max_lead_patients: 60 } },
    { version: 2, is_active: false, approved_at: null, rules: { max_lead_patients: 40 } },
  ];

  it("finds the unsigned drafts and shows the cap in force beside the cap proposed", async () => {
    const r = await readPendingCapacityConfigSignoff(client({ capacity_cover_config: { data: capacity, error: null }, lead_config: { data: lead, error: null } }));
    expect(r).toMatchObject({ capacityVersion: 2, leadVersion: 2, leadCapDraft: 40, leadCapInForce: 60, failed: false });
    expect(r.capacityRules?.restHours).toBe(10);
  });

  it("finds nothing when everything is signed or live", async () => {
    const r = await readPendingCapacityConfigSignoff(client({ capacity_cover_config: { data: [capacity[0]], error: null }, lead_config: { data: [lead[0]], error: null } }));
    expect(r).toMatchObject({ capacityVersion: null, leadVersion: null, capacityRules: null, leadCapDraft: null, failed: false });
  });

  it("says it failed, and never reads as all clear, when a table cannot be read", async () => {
    const r = await readPendingCapacityConfigSignoff(client({ capacity_cover_config: { data: null, error: new Error("denied") }, lead_config: { data: lead, error: null } }));
    expect(r.failed).toBe(true);
    expect(r.capacityVersion).toBeNull();
  });
});
