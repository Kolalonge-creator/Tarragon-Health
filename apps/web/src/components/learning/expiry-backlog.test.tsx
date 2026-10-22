/** @jest-environment jsdom */
/**
 * The learning content review list (admin and Chief Medical Officer). Buckets come from the rows, hidden items come first, an item with no
 * owner is said so, assigning an owner calls the mutation with the chosen profile (and null to clear), an empty list is a calm line not an
 * error, and a failed read is a clear message that keeps the title. Also scanned for accessibility violations.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { ExpiryBacklog } from "./expiry-backlog";

const mutate = jest.fn();
let backlog: { isLoading: boolean; isError: boolean; data: unknown[] | undefined } = { isLoading: false, isError: false, data: [] };
let summary: { data: unknown[] | undefined } = { data: [] };
jest.mock("@/lib/queries/learning-centre", () => ({
  useLearningExpiryBacklog: () => backlog,
  useLearningExpirySummary: () => summary,
  useLearningOwnerCandidates: () => ({ data: [{ profile_id: "p1", full_name: "Dr Owner", role: "clinician" }] }),
  useSetLearningContentOwner: () => ({ mutate, isPending: false, isError: false, isSuccess: false }),
}));

const row = (over: Record<string, unknown>) => ({
  content_id: "c1", code: "htn-basics", title: "Blood pressure basics", category: "hypertension", content_status: "published",
  next_review_due: "2026-11-01", days_until_due: 10, bucket: "d14", hidden: false, review_flagged: false, owner_profile_id: null, owner_name: null, ...over,
});

beforeEach(() => {
  mutate.mockReset();
  backlog = { isLoading: false, isError: false, data: [] };
  summary = { data: [] };
});

describe("ExpiryBacklog", () => {
  it("lists hidden items first, then the buckets from the rows, with owner and state", () => {
    backlog.data = [
      row({ content_id: "c2", code: "late", title: "Hidden one", days_until_due: -3, bucket: "hidden", hidden: true, owner_profile_id: "p1", owner_name: "Dr Owner" }),
      row({ content_id: "c3", code: "soon", title: "Soon one", days_until_due: 5, bucket: "d7" }),
      row({}),
      row({ content_id: "c4", code: "far", title: "Far one", days_until_due: 25, bucket: "d30", review_flagged: true }),
    ];
    summary.data = [{ metric: "hidden", n: 1 }, { metric: "d7", n: 1 }, { metric: "d14", n: 1 }, { metric: "d30", n: 1 }, { metric: "no_owner", n: 3 }, { metric: "no_review_date", n: 235 }];
    render(<ExpiryBacklog />);
    const order = screen.getAllByTestId(/^expiry-bucket-/).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["expiry-bucket-hidden", "expiry-bucket-d7", "expiry-bucket-d14", "expiry-bucket-d30"]);
    const hidden = within(screen.getByTestId("expiry-bucket-hidden"));
    expect(hidden.getByText("Hidden since its review date")).toBeTruthy();
    expect(hidden.getByText("3 days past")).toBeTruthy();
    expect(within(screen.getByTestId("expiry-bucket-d14")).getByText("No owner yet")).toBeTruthy();
    expect(within(screen.getByTestId("expiry-bucket-d30")).getByText("Flagged for re-review, still live")).toBeTruthy();
    expect(screen.getByTestId("expiry-summary").textContent).toContain("Due within 14 days");
    expect(screen.getByTestId("expiry-summary").textContent).toContain("235");
  });

  it("assigns and clears an owner through the mutation", () => {
    backlog.data = [row({})];
    render(<ExpiryBacklog />);
    const select = screen.getByLabelText("Assign an owner: Blood pressure basics");
    fireEvent.change(select, { target: { value: "p1" } });
    expect(mutate).toHaveBeenCalledWith({ contentId: "c1", ownerId: "p1" });
    fireEvent.change(select, { target: { value: "" } });
    expect(mutate).toHaveBeenLastCalledWith({ contentId: "c1", ownerId: null });
  });

  it("shows a calm line, not an error, when nothing is hidden or coming up", () => {
    render(<ExpiryBacklog />);
    expect(screen.getByText("Nothing is hidden and nothing is coming up for review.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the title and says so when the list cannot load (for example the person is not allowed)", () => {
    backlog = { isLoading: false, isError: true, data: undefined };
    render(<ExpiryBacklog />);
    expect(screen.getByRole("alert").textContent).toContain("Learning content review list");
  });

  it("has no accessibility violations", async () => {
    backlog.data = [row({}), row({ content_id: "c2", bucket: "hidden", hidden: true, days_until_due: 0 })];
    summary.data = [{ metric: "hidden", n: 1 }];
    await expectNoA11yViolations(<ExpiryBacklog />);
  });
});
