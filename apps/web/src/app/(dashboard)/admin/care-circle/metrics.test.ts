import { en } from "@tarragon/i18n";
import { careCircleMetricsSchema, METRIC_GROUPS, parseCareCircleMetrics } from "./metrics";

describe("Care Circle admin metrics", () => {
  it("every field the page shows is in the schema and has a label", () => {
    for (const g of METRIC_GROUPS) {
      const shape = careCircleMetricsSchema.shape[g.group].shape as Record<string, unknown>;
      expect(en[g.titleKey]).toBeTruthy();
      for (const f of g.fields) {
        expect(shape[f.key]).toBeDefined();
        expect(en[f.labelKey]).toBeTruthy();
      }
    }
  });

  it("parses the database shape, reads a missing count as 0, and refuses a wrong shape", () => {
    const ok = parseCareCircleMetrics({
      adoption: { patients_with_circle: 2, active_supporters: 1 },
      engagement: {},
      commercial: { gifts_paid: 2, gift_revenue_kobo: 100000 },
      safety: { paused_now: 1 },
    });
    expect(ok?.adoption.patients_with_circle).toBe(2);
    expect(ok?.adoption.invites_sent).toBe(0);
    expect(ok?.commercial.gift_revenue_kobo).toBe(100000);
    expect(parseCareCircleMetrics({ error: "x" })).toBeNull();
    expect(parseCareCircleMetrics(null)).toBeNull();
  });
});
