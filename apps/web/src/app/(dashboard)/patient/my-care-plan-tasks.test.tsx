/** @jest-environment jsdom */
/** PD-06 on the patient care plan card: a failed read says "Couldn't load", never "no care plan"; review dates, actions and the change box render. */
import { render, screen } from "@testing-library/react";

type Q = { data: unknown; isError: boolean; isLoading?: boolean };
let plans: Q = { data: [], isError: false };
let actions: Q = { data: [], isError: false };
let revisions: Q = { data: [], isError: false };
let acting: { fullName: string | null } | null = null;

jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("@/lib/queries/care-plans", () => ({ useCarePlans: () => plans }));
jest.mock("@/lib/queries/care-tasks", () => ({
  useCareTasks: () => ({ data: [], isLoading: false, isError: false }),
  useCompleteCareTask: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
}));
jest.mock("@/lib/queries/care-plan-goals", () => ({
  useCarePlanGoals: () => ({ data: [] }),
  useProposeCarePlanGoal: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
}));
jest.mock("@/lib/queries/care-plan-revisions", () => ({
  carePlanRevisionKeys: { patientRevisions: (id: string) => ["r", id] },
  usePatientCarePlanActions: () => actions,
  usePatientCarePlanRevisions: () => revisions,
}));
jest.mock("@/components/acting-for-context", () => ({ useActingFor: () => acting }));
jest.mock("@/components/upgrade-prompt", () => ({ UpgradePrompt: () => null }));
jest.mock("@/app/(dashboard)/patient/care-plan-acknowledge-action", () => ({ acknowledgeCarePlanChange: jest.fn() }));

import { MyCarePlanTasks } from "./my-care-plan-tasks";
import { CARE_PLAN_COPY } from "@/lib/care-plan/patient-copy";

const PLAN = {
  id: "plan-1",
  condition: "hypertension",
  status: "active",
  target_ranges: {},
  notes: null,
  assigned_clinician: null,
  hasScheduledReview: true,
  last_reviewed_at: "2026-11-01T11:00:00Z",
  next_review_at: "2027-02-01",
};

beforeEach(() => {
  plans = { data: [PLAN], isError: false };
  actions = { data: [], isError: false };
  revisions = { data: [], isError: false };
  acting = null;
});

it("a failed plan read says Couldn't load, not that there is no plan", () => {
  plans = { data: undefined, isError: true };
  render(<MyCarePlanTasks patientId="pat" organisationId="org" />);
  expect(screen.getByText(CARE_PLAN_COPY.loadFailed)).toBeTruthy();
  expect(screen.queryByText(/You do not have a care plan yet/)).toBeNull();
});

it("a failed versions read also says Couldn't load", () => {
  revisions = { data: undefined, isError: true };
  render(<MyCarePlanTasks patientId="pat" organisationId="org" />);
  expect(screen.getByText(CARE_PLAN_COPY.loadFailed)).toBeTruthy();
});

it("a failed actions read says Couldn't load inside the plan, not that there are no actions", () => {
  actions = { data: undefined, isError: true };
  render(<MyCarePlanTasks patientId="pat" organisationId="org" />);
  expect(screen.getByText(CARE_PLAN_COPY.loadFailed)).toBeTruthy();
  expect(screen.queryByText(CARE_PLAN_COPY.noActions)).toBeNull();
});

it("shows review dates, grouped actions, the change box and earlier versions", () => {
  actions = {
    data: [{ carePlanId: "plan-1", description: "Check your blood pressure", frequency: null, category: "monitoring", why: "W", when: "Mornings", how: null }],
    isError: false,
  };
  revisions = {
    data: [
      {
        id: "r1", organisation_id: "o", patient_id: "pat", care_plan_id: "plan-1", version_number: 1,
        change_summary: "We added a morning check.", needs_acknowledgement: true, plan_snapshot: {}, published_by: "d",
        published_at: "2026-11-05T10:00:00Z", acknowledged_at: null, acknowledged_by: null,
      },
    ],
    isError: false,
  };
  render(<MyCarePlanTasks patientId="pat" organisationId="org" />);
  expect(screen.getByText("1 Nov 2026")).toBeTruthy();
  expect(screen.getByText("Checks you do at home")).toBeTruthy();
  expect(screen.getByText(CARE_PLAN_COPY.changeNoticeTitle)).toBeTruthy();
  expect(screen.getAllByText("We added a morning check.").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: CARE_PLAN_COPY.gotIt })).toBeTruthy();
  expect(screen.getByText(CARE_PLAN_COPY.earlierVersions)).toBeTruthy();
});

it("hides Got it while acting for someone", () => {
  revisions = {
    data: [
      {
        id: "r1", organisation_id: "o", patient_id: "pat", care_plan_id: "plan-1", version_number: 1,
        change_summary: "We added a morning check.", needs_acknowledgement: true, plan_snapshot: {}, published_by: "d",
        published_at: "2026-11-05T10:00:00Z", acknowledged_at: null, acknowledged_by: null,
      },
    ],
    isError: false,
  };
  acting = { fullName: "Ada Obi" };
  render(<MyCarePlanTasks patientId="pat" organisationId="org" />);
  expect(screen.queryByRole("button", { name: CARE_PLAN_COPY.gotIt })).toBeNull();
});
