// Service targets from docs/plans/SCALE-READINESS-PLAN.md section 2. PROPOSED: the CMO and founder have not signed them.
// SR1 will move them into signed versioned config; until then this file is the only place the harness reads them from.
export const TARGETS = {
  pageToOnCallSeconds: 60,
  readingSaveP95Ms: 5000,
  nextTaskP95Ms: 2000,
  chartSummaryP95Ms: 3000,
  pageAckSteps: [5, 10],
  errorRateMax: 0.01,
};

// Scenario sizes by stage. A stage is a Member count; everything else scales from it. Caps keep a laptop run bounded and are printed.
export const STAGES = {
  A: { members: 500, label: "Stage A pilot" },
  B: { members: 5000, label: "Stage B launch" },
  C: { members: 25000, label: "Stage C growth" },
  D: { members: 100000, label: "Stage D scale" },
};
