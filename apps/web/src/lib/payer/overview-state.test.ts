import { payerOverviewState } from "./overview-state";

const ready = {
  suppressed: false,
  min_cohort_size: 10,
  member_count: 40,
  programmes: [
    { programme_name: "Hypertension", condition: "hypertension", members_with_condition: 12, enrolled: 9, controlled: null, overdue_review: 2, suppressed_subgroup: true },
  ],
};

describe("payerOverviewState", () => {
  it("is ready for a normal reply, keeping a withheld cell as null", () => {
    const s = payerOverviewState({ data: ready, error: null });
    expect(s.kind).toBe("ready");
    if (s.kind === "ready") expect(s.dashboard.programmes?.[0].controlled).toBeNull();
  });

  it("is suppressed, with the database's note, when the privacy rule withholds the figures", () => {
    const s = payerOverviewState({ data: { suppressed: true, min_cohort_size: 10, note: "Withheld." }, error: null });
    expect(s).toEqual({ kind: "suppressed", note: "Withheld.", minCohortSize: 10 });
  });

  it("is failed, not suppressed, when the read errored", () => {
    expect(payerOverviewState({ data: null, error: { message: "boom" } })).toEqual({ kind: "failed" });
  });

  it.each([[null], [undefined], ["x"], [{}], [{ suppressed: "no" }], [{ suppressed: false }]])(
    "is failed, not suppressed, for a reply it does not recognise (%j)",
    (data) => {
      expect(payerOverviewState({ data, error: null })).toEqual({ kind: "failed" });
    },
  );
});
