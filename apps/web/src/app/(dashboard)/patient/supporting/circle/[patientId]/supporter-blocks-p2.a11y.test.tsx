/** @jest-environment jsdom */
/** Care Circle P2: tests, reviewed values, weight and yearly check-ups as a family supporter sees them, and moving between people. */
import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { parseSupporterView, type SupportedPerson } from "@/lib/care-circle/model";
import { SupporterBlocks, hasSharedBlocks } from "./supporter-blocks";
import { PersonSwitcher } from "./person-switcher";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const BASE = { patient_id: "p", name: "Mama", relationship: "Mother", shared_until: "2027-01-01T00:00:00Z" };
const VIEW = parseSupporterView({
  ...BASE,
  permissions: ["investigation_status", "investigation_values", "weekly_weight_trend", "care_plan_progress"],
  investigations: [
    { code: "hba1c", stage: "due", due_date: "2026-11-30", follow_up: false },
    { code: "lipid_panel", stage: "result_received", due_date: null, follow_up: false },
    { code: "fbc", stage: "reviewed", due_date: null, follow_up: true },
  ],
  results: [
    { code: "hba1c", at: "2026-11-01T10:00:00Z", value: 7.4, value_text: null, unit: "%", ref_low: 4, ref_high: 5.6, in_range: false },
    { code: "haemoglobin", at: "2026-11-01T10:00:00Z", value: 13.2, value_text: null, unit: "g/dL", ref_low: 12, ref_high: 16, in_range: true },
  ],
  weight_trend: { weeks: [{ week_start: "2026-10-19", kg: 82, readings: 1 }, { week_start: "2026-10-26", kg: null, readings: 0 }, { week_start: "2026-11-02", kg: 80.4, readings: 1 }], direction: "lower" },
  plan_progress: { done: 1, due: 4, overdue: 1, next_due: "2026-10-25" },
});

describe("Care Circle P2 blocks", () => {
  it("parses the four new blocks", () => {
    expect(VIEW).not.toBeNull();
    expect(VIEW?.investigations).toHaveLength(3);
    expect(VIEW?.results).toHaveLength(2);
  });

  it("shows each test's stage in plain words, never a value in the tests card, and the follow-up flag", () => {
    render(<SupporterBlocks view={VIEW!} locale="en" name="Mama" />);
    expect(screen.getByText("Result received, waiting for a doctor to look at it")).toBeTruthy();
    expect(screen.getByText("Reviewed by a doctor")).toBeTruthy();
    expect(screen.getByText(/asked for a follow-up/)).toBeTruthy();
    expect(screen.getAllByText(/Average blood sugar \(HbA1c\)/).length).toBeGreaterThan(0);
  });

  it("shows reviewed values against the lab's own range in plain words, and says who to ask", () => {
    render(<SupporterBlocks view={VIEW!} locale="en" name="Mama" />);
    expect(screen.getByText("Outside the lab's usual range")).toBeTruthy();
    expect(screen.getByText("Within the lab's usual range")).toBeTruthy();
    expect(screen.getByText(/Ask Mama or their care team what these results mean/)).toBeTruthy();
  });

  it("lists only weeks with a weight, and the plan counts", () => {
    render(<SupporterBlocks view={VIEW!} locale="en" name="Mama" />);
    expect(screen.getAllByText(/kg$/)).toHaveLength(2);
    expect(screen.getByText("Lower than a few weeks ago")).toBeTruthy();
    expect(screen.getByText("1 done, 4 still to do, 1 overdue")).toBeTruthy();
  });

  it("a page whose only shared item is a new block is not the empty state", () => {
    const only = parseSupporterView({ ...BASE, permissions: ["care_plan_progress"], plan_progress: { done: 0, due: 0, overdue: 0, next_due: null } });
    expect(hasSharedBlocks(only!, "en")).toBe(true);
  });

  it("is axe-clean", async () => {
    await expectNoA11yViolations(<SupporterBlocks view={VIEW!} locale="en" name="Mama" />);
  });
});

describe("PersonSwitcher", () => {
  const people: SupportedPerson[] = [
    { patient_id: "p1", member_id: "m1", name: "Mama", relationship: "Mother", permissions: ["appointments"], expires_at: "2027-01-01T00:00:00Z", alert_mode: "push_and_app" },
    { patient_id: "p2", member_id: "m2", name: "Papa", relationship: "Father", permissions: ["appointments"], expires_at: "2027-01-01T00:00:00Z", alert_mode: "push_and_app" },
  ];
  it("is hidden for someone who supports one person", () => {
    const { container } = render(<PersonSwitcher people={people.slice(0, 1)} current="p1" locale="en" />);
    expect(container.textContent).toBe("");
  });
  it("links each person to their own page and marks the current one", async () => {
    render(<PersonSwitcher people={people} current="p2" locale="en" />);
    expect(screen.getByRole("link", { name: /Papa/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Mama/ }).getAttribute("href")).toBe("/patient/supporting/circle/p1");
    await expectNoA11yViolations(<PersonSwitcher people={people} current="p2" locale="en" />);
  });
});
