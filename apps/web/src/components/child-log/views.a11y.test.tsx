/** @jest-environment jsdom */
/**
 * S68b: accessibility and behaviour of the daily child log views. The views are presentational (no data fetching), so each is rendered with fixed
 * props. Checks: axe finds nothing; a status is a WORD as well as a shape; the crisis lead is a real tel link; a mother's record cannot reach the
 * timeline; the "checked by your care team" line exists only when a reviewer record does.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { buildChildTimeline, buildChildVaccineChecklist, checklistCounts, bandForPoint, type ChildEvent, type ChartPointInput } from "@tarragon/shared";
import { CrisisLead, GrowthBandsView, OneTapButtons, TimelineList, VaccineChecklistView, type GrowthTableRow } from "./views";

const ev = (id: string, kind: ChildEvent["kind"], occurredAt: string, extra: Partial<ChildEvent> = {}): ChildEvent => ({
  id, kind, occurredAt, feedType: null, loggedBy: null, correctsId: null, pendingOnPhone: false, ...extra,
});

const base = { weightForAgeZ: 0, heightForAgeZ: 0, weightForHeightZ: 0, nutritionClass: "none" as const, implausible: false };
const rows: GrowthTableRow[] = [
  { id: "g1", measuredAt: "2026-08-20T09:00:00Z", weightKg: 4.1, heightCm: 54, result: bandForPoint(base) },
  { id: "g2", measuredAt: "2026-09-20T09:00:00Z", weightKg: 4.8, heightCm: 57, result: bandForPoint({ ...base, heightForAgeZ: -2.5 }) },
  { id: "g3", measuredAt: "2026-10-20T09:00:00Z", weightKg: 5.0, heightCm: 59, result: bandForPoint({ ...base, weightForAgeZ: -3.4 }) },
];
const pts = (pick: (r: GrowthTableRow) => number): ChartPointInput[] =>
  rows.map((r, i) => ({ id: r.id, ageMonths: i + 1, value: pick(r), band: r.result.kind === "band" ? r.result.band : null }));

describe("CrisisLead", () => {
  it("leads with go to the nearest clinic now and a tap-to-call link, and has no axe violations", async () => {
    await expectNoA11yViolations(<CrisisLead emergencyNumber="112" />);
    expect(screen.getByRole("heading", { name: /nearest clinic now/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /call 112 now/i }).getAttribute("href")).toBe("tel:112");
  });
  it("offers no call link for a number that is not plausible (nothing is smuggled into a tel: link)", () => {
    render(<CrisisLead emergencyNumber="112;evil" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("heading", { name: /nearest clinic now/i })).toBeTruthy();
  });
});

describe("OneTapButtons", () => {
  const actions = [
    { id: "feed_breast", label: "Breast", glyph: "♥" },
    { id: "sleep", label: "Asleep", glyph: "☾" },
    { id: "nappy_wet", label: "Wet nappy", glyph: "💧" },
  ];
  it("every button has a word, taps report their id, and axe is satisfied", async () => {
    const onTap = jest.fn();
    await expectNoA11yViolations(<OneTapButtons actions={actions} disabled={false} status={null} onTap={onTap} />);
    fireEvent.click(screen.getByRole("button", { name: /wet nappy/i }));
    expect(onTap).toHaveBeenCalledWith("nappy_wet");
  });
  it("announces the result politely and disables the buttons while one is being saved", () => {
    render(<OneTapButtons actions={actions} disabled status="Saved." onTap={() => undefined} />);
    expect(screen.getByRole("status").textContent).toBe("Saved.");
    expect((screen.getByRole("button", { name: /breast/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("TimelineList", () => {
  const items = buildChildTimeline({
    events: [
      ev("e1", "feed", "2026-10-22T08:00:00Z", { loggedBy: "Aunty", feedType: "bottle" }),
      ev("e2", "nappy_wet", "2026-10-22T09:00:00Z", { pendingOnPhone: true }),
      ev("e3", "sleep_start", "2026-10-22T05:00:00Z"),
      ev("e4", "sleep_stop", "2026-10-22T06:30:00Z"),
    ],
    growth: [{ id: "g1", measuredAt: "2026-10-21T09:00:00Z", weightKg: 5.2, heightCm: 58 }],
    vaccines: [
      { id: "v1", name: "BCG", doseNumber: 1, dateAdministered: "2026-10-20", verifiedBy: "staff-1", verifiedAt: "2026-10-21T10:00:00Z" },
      { id: "v2", name: "OPV", doseNumber: 1, dateAdministered: "2026-10-19", verifiedBy: null, verifiedAt: "2026-10-21T10:00:00Z" },
    ],
  });
  it("is newest first, one line each, shows the caregiver label and the on-this-phone badge, and has no axe violations", async () => {
    await expectNoA11yViolations(<TimelineList items={items} />);
    const lines = screen.getAllByRole("listitem");
    expect(lines).toHaveLength(items.length);
    expect(within(lines[0]!).getByText(/wet nappy/i)).toBeTruthy();
    expect(within(lines[0]!).getByText(/on this phone/i)).toBeTruthy();
    expect(screen.getByText(/by Aunty/)).toBeTruthy();
    expect(screen.getByText(/Slept for 1 h 30 min/)).toBeTruthy();
    expect(screen.getByText(/5.2 kg, 58 cm/)).toBeTruthy();
  });
  it("shows 'checked by your care team' only for the dose that has a reviewer record", () => {
    render(<TimelineList items={items} />);
    expect(screen.getAllByText(/checked by your care team/i)).toHaveLength(1);
  });
  it("shows a calm empty line", async () => {
    await expectNoA11yViolations(<TimelineList items={[]} />);
    expect(screen.getByText(/nothing logged yet/i)).toBeTruthy();
  });
});

describe("GrowthBandsView", () => {
  it("names the latest band in words, draws one marker per point with a shape, has a table alternative and no axe violations", async () => {
    const { container } = await expectNoA11yViolations(<GrowthBandsView rows={rows} weightPoints={pts((r) => r.weightKg ?? 0)} heightPoints={pts((r) => r.heightCm ?? 0)} />);
    expect(screen.getAllByText("Talk to your care team").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("img", { name: /weight in kilograms/i })).toBeTruthy();
    expect(container.querySelectorAll("svg path")).toHaveLength(6);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("Keep an eye on")).toBeTruthy();
    expect(screen.getByText(/triangle: talk to your care team/i)).toBeTruthy();
    expect(container.textContent).toMatch(/not a diagnosis/i);
    expect(container.textContent).not.toMatch(/\b(lb|lbs|oz|inch)/i);
  });
  it("says so when a measurement could not be read, instead of calling it fine", () => {
    render(<GrowthBandsView rows={[{ id: "x", measuredAt: "2026-10-20T00:00:00Z", weightKg: 5, heightCm: null, result: { kind: "no_reference" } }]} weightPoints={[]} heightPoints={[]} />);
    expect(screen.getByText(/could not read this measurement/i)).toBeTruthy();
    expect(screen.queryByText("Growing well")).toBeNull();
  });
});

describe("VaccineChecklistView", () => {
  const catalog = [{ id: "penta", code: "child_penta", name: "Pentavalent", recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 } }];
  const doses = buildChildVaccineChecklist({
    dateOfBirth: "2026-01-01", sex: "female", today: "2026-03-30", catalog,
    records: [{ vaccination_catalog_id: "penta", dose_number: 1, date_administered: "2026-02-15", verification_status: "pending_verification" }],
  });
  it("gives every status a word, never colour alone, says who checked it, and has no axe violations", async () => {
    await expectNoA11yViolations(<VaccineChecklistView doses={doses} counts={checklistCounts(doses)} />);
    expect(screen.getByText(/1 done, 1 due now, 1 overdue/)).toBeTruthy();
    expect(screen.getByText(/waiting for your care team to check/i)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/^Done/)).toBeTruthy();
  });
  it("asks for a date of birth rather than showing an empty list that looks like nothing is due", () => {
    render(<VaccineChecklistView doses={[]} counts={{ done: 0, due: 0, overdue: 0 }} />);
    expect(screen.getByText(/add your child's date of birth/i)).toBeTruthy();
  });
});
