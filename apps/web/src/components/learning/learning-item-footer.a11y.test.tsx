/** @jest-environment jsdom */
/**
 * The fixed template under every learning item (S55, spec 9.4, 9.6): reviewer, review date and sources are shown from the item's
 * real record, "What can I do next?" is always present with ask / book, the urgent-help box can never be left out, the self-care
 * step appears only when authored, and "ask your care team" saves the lesson. Also scanned for accessibility violations.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { LearningItemFooter } from "./learning-item-footer";

type Trust = Record<string, unknown> | null;
let trust: Trust = null;
const mutateAsync = jest.fn();
jest.mock("@/lib/queries/learning-centre", () => ({
  useHealthEducationItemTrust: () => ({ data: trust }),
  useSaveLessonForConsultation: () => ({ mutateAsync: (c: string) => mutateAsync(c), isPending: false }),
}));

const FULL = {
  code: "htn-basics", reviewed_by_name: "Dr Amaka Obi", reviewed_at: "2026-09-01T10:00:00Z", next_review_due: "2027-09-01",
  source_reference: "WHO hypertension guideline 2021", evidence_source: null, clinical_author_name: null, creator_name: "Dr Creator Name",
  self_care_action: "Check your blood pressure at the same time each day.", share_enabled: true,
};

beforeEach(() => {
  mutateAsync.mockReset();
  trust = FULL;
});

describe("LearningItemFooter", () => {
  it("shows reviewer, review date, sources and credit from the record", () => {
    render(<LearningItemFooter code="htn-basics" title="Basics" contentType="article" />);
    const line = screen.getByTestId("trust-line");
    expect(line.textContent).toContain("Reviewed by Dr Amaka Obi");
    expect(line.textContent).toContain("Last reviewed 2026-09-01");
    expect(line.textContent).toContain("Next review due 2027-09-01");
    expect(line.textContent).toContain("Sources: WHO hypertension guideline 2021");
    expect(line.textContent).toContain("Written by Dr Creator Name");
    expect(line.textContent).not.toContain("Review details are being added");
  });

  it("says details are being added, and invents nothing, when the record lacks them", () => {
    trust = { code: "old", reviewed_by_name: null, reviewed_at: null, source_reference: null, evidence_source: null, self_care_action: null, share_enabled: false };
    render(<LearningItemFooter code="old" title="Old" contentType="article" />);
    const line = screen.getByTestId("trust-line");
    expect(line.textContent).toContain("Review details are being added");
    expect(line.textContent).not.toContain("Reviewed by");
  });

  it("always has the next-step block and the urgent-help box; self-care only when authored", () => {
    const { rerender } = render(<LearningItemFooter code="htn-basics" title="Basics" contentType="article" />);
    expect(screen.getByText("What can I do next?")).toBeTruthy();
    expect(screen.getByText(/Check your blood pressure at the same time each day/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask your care team about this" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Book a consultation" })).toBeTruthy();
    expect(screen.getByTestId("urgent-help-box").textContent).toContain("do not wait");
    trust = { ...FULL, self_care_action: null };
    rerender(<LearningItemFooter code="htn-basics" title="Basics" contentType="article" />);
    expect(screen.queryByText(/Try this at home/)).toBeNull();
    expect(screen.getByRole("button", { name: "Ask your care team about this" })).toBeTruthy();
    expect(screen.getByTestId("urgent-help-box")).toBeTruthy();
  });

  it("saves the lesson for the next consultation and says so; says so plainly when it cannot", async () => {
    mutateAsync.mockResolvedValueOnce(true);
    render(<LearningItemFooter code="htn-basics" title="Basics" contentType="article" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask your care team about this" }));
    await waitFor(() => expect(screen.getByText(/Your care team can see it at your next consultation/)).toBeTruthy());
    expect(mutateAsync).toHaveBeenCalledWith("htn-basics");
  });

  it("shows a calm failure and no success message when the save is refused (for example the lesson has expired)", async () => {
    mutateAsync.mockResolvedValueOnce(false);
    render(<LearningItemFooter code="htn-basics" title="Basics" contentType="article" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask your care team about this" }));
    await waitFor(() => expect(screen.getByText(/could not save that just now/i)).toBeTruthy());
    expect(screen.queryByText(/can see it at your next consultation/)).toBeNull();
  });

  it("offers sharing only for a shareable article", () => {
    const { rerender } = render(<LearningItemFooter code="htn-basics" title="Basics" contentType="article" />);
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(decodeURIComponent(screen.getByRole("link", { name: "Share by email" }).getAttribute("href") ?? "")).toContain("/learn/htn-basics");
    expect(screen.getByRole("link", { name: "Share by email" }).getAttribute("href")).not.toMatch(/patient|user|token/i);
    rerender(<LearningItemFooter code="htn-basics" title="Basics" contentType="video" />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    trust = { ...FULL, share_enabled: false };
    rerender(<LearningItemFooter code="htn-basics" title="Basics" contentType="article" />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("has no accessibility violations", async () => {
    await expectNoA11yViolations(<LearningItemFooter code="htn-basics" title="Basics" contentType="article" />);
  });
});
