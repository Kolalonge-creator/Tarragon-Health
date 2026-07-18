import { describe, expect, it } from "@jest/globals";
import {
  auditLogSchema,
  businessSummarySchema,
  clinicalOutcomesSchema,
  financialSummarySchema,
  operationsSummarySchema,
  populationSummarySchema,
  trafficSummarySchema,
} from "./schemas";

describe("analytics schemas", () => {
  it("parses a gated empty response ({}) into a zeroed shape", () => {
    // Non-analyst callers receive `{}` from the RPC; defaults must fill in.
    const biz = businessSummarySchema.parse({});
    expect(biz.total_orgs).toBe(0);
    expect(biz.roles).toEqual([]);

    const fin = financialSummarySchema.parse({});
    expect(fin.mrr_by_currency).toEqual([]);
    expect(fin.commissions.total_kobo).toBe(0);
    expect(fin.commissions.by_status).toEqual([]);
  });

  it("parses a real business summary payload", () => {
    const biz = businessSummarySchema.parse({
      total_orgs: 7,
      total_patients: 7,
      active_subscriptions: 4,
      roles: [{ role: "patient", count: 7 }],
    });
    expect(biz.total_orgs).toBe(7);
    expect(biz.roles[0]).toEqual({ role: "patient", count: 7 });
  });

  it("tolerates a null currency in financial rows (real payment data)", () => {
    const fin = financialSummarySchema.parse({
      revenue_by_currency: [
        { currency: "NGN", total_minor: 9800000 },
        { currency: null, total_minor: 8000000 },
      ],
      mrr_by_currency: [{ currency: null, mrr_minor: 5000 }],
      active_subscriptions: 4,
    });
    expect(fin.revenue_by_currency[1].currency).toBeNull();
    expect(fin.active_subscriptions).toBe(4);
  });

  it("allows a null risk_level bucket in the population summary", () => {
    const pop = populationSummarySchema.parse({
      total_patients: 7,
      risk_distribution: [
        { risk_level: null, patients: 2 },
        { risk_level: "high", patients: 1 },
      ],
    });
    expect(pop.risk_distribution).toHaveLength(2);
    expect(pop.risk_distribution[0].risk_level).toBeNull();
  });

  it("parses gated-empty traffic/outcomes and a null clinician tier", () => {
    const traffic = trafficSummarySchema.parse({});
    expect(traffic.visitors).toBe(0);
    expect(traffic.by_country).toEqual([]);

    const outcomes = clinicalOutcomesSchema.parse({});
    expect(outcomes.bp_control.pct).toBe(0);

    const ops = operationsSummarySchema.parse({
      clinician_load: [{ clinician: "Dr A", tier: null, patients: 130 }],
      orders: { lab: { total: 2, completed: 1 }, pharmacy: { total: 0 }, referral: { total: 0 } },
    });
    expect(ops.clinician_load[0].tier).toBeNull();
    expect(ops.target_ratio).toBe(120);
  });

  it("parses audit rows with nullable actor/org and arbitrary event jsonb", () => {
    const audit = auditLogSchema.parse({
      total: 1,
      rows: [
        {
          id: "00000000-0000-0000-0000-000000000000",
          created_at: "2026-07-17T00:00:00Z",
          action: "emergency_event.created",
          entity_type: null,
          entity_id: null,
          actor_name: null,
          organisation_name: "Tarragon",
          event: { foo: "bar" },
        },
      ],
    });
    expect(audit.total).toBe(1);
    expect(audit.rows[0].actor_name).toBeNull();
  });
});
