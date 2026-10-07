/** @jest-environment jsdom */
/**
 * S85 D2 / OQ-12: the fertile window is hidden by default and shown only in "Planning a pregnancy" mode, and every
 * surface that shows it carries the exact label and link text.
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FERTILE_WINDOW_LABEL, FERTILE_WINDOW_LINK_TEXT } from "@tarragon/i18n";
import { lagosDateString } from "@/lib/ai-coach/lagos-day";
import { addDays, predictCycle, type CyclePrediction } from "@/lib/rules/cycle-prediction";
import { detectThermalShift } from "@/lib/rules/cycle-thermal-shift";
import { CycleTracker } from "./cycle-tracker";
import { CycleCalendar } from "./cycle-calendar";
import { CycleInsightsCard } from "./cycle-insights-card";
import { CycleDayLog } from "./cycle-day-log";
import { CycleLegend, CycleRing } from "./cycle-ring";
import { FertileWindowNotice } from "./fertile-window-notice";
import { setPlanningPregnancyMode } from "@/app/(dashboard)/patient/womens-health-actions";

jest.mock("@/app/(dashboard)/patient/womens-health-actions", () => ({
  setPlanningPregnancyMode: jest.fn(),
}));

const today = lagosDateString();
// Four 28-day cycles, the last one started 13 days ago: today is inside the window, one day before ovulation.
const starts = [-97, -69, -41, -13].map((n) => addDays(today, n));
const periodRows = [...starts].reverse().map((start, i) => ({
  id: `c${i}`,
  patient_id: "p1",
  organisation_id: "o1",
  period_start_date: start,
  period_end_date: addDays(start, 4),
  notes: null,
}));

type Rows = unknown[];
interface Builder {
  select: () => Builder;
  eq: () => Builder;
  gte: () => Builder;
  order: () => Builder;
  then: (resolve: (value: { data: Rows; error: null }) => unknown) => unknown;
}
function builder(rows: Rows): Builder {
  const b: Builder = {
    select: () => b,
    eq: () => b,
    gte: () => b,
    order: () => b,
    then: (resolve) => resolve({ data: rows, error: null }),
  };
  return b;
}
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => builder(table === "menstrual_cycles" ? periodRows : []),
  }),
}));

function withQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const rawPrediction = (): CyclePrediction =>
  predictCycle({
    periods: periodRows.map((c) => ({ startDate: c.period_start_date, endDate: c.period_end_date })),
    today,
    lifeStage: "menstruating",
    selfReportedCycleLengthDays: null,
    heavyFlowDates: [],
  });

const mockedAction = setPlanningPregnancyMode as jest.MockedFunction<typeof setPlanningPregnancyMode>;

beforeEach(() => {
  mockedAction.mockReset();
  mockedAction.mockResolvedValue({ success: true });
});

/** Every surface that shows the window must carry both strings. Throws on the first one that does not. */
function assertLabelled(root: HTMLElement) {
  const notices = within(root).queryAllByTestId("fertile-window-notice");
  if (notices.length === 0) throw new Error("no fertile-window label on this surface");
  for (const n of notices) {
    expect(n.textContent).toContain(FERTILE_WINDOW_LABEL);
    expect(within(n).getByRole("link", { name: FERTILE_WINDOW_LINK_TEXT })).toBeTruthy();
  }
}

const NEVER_WHILE_OFF = /fertile window|estimated ovulation|suggests ovulation|safe days|avoid pregnancy|natural contraception/i;

describe("the label itself", () => {
  it("is the founder's exact wording, with a link", () => {
    render(<FertileWindowNotice />);
    expect(screen.getByText("Not contraception. This cannot prevent pregnancy.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Learn about contraception and talk to your care team." }).getAttribute("href")).toBe("/patient/womens-health");
  });
});

describe("each surface that shows the window carries the label (mode on)", () => {
  it("the legend", () => {
    const { container } = render(<CycleLegend planningMode />);
    expect(screen.getByText("Fertile window")).toBeTruthy();
    assertLabelled(container);
  });

  it("the calendar", () => {
    const { container } = render(
      <CycleCalendar
        cycles={[]}
        dailyLogs={[]}
        prediction={rawPrediction()}
        planningMode
        today={today}
        selectedDate={today}
        onSelectDate={() => {}}
      />
    );
    expect(container.textContent).toMatch(/estimated fertile window/);
    assertLabelled(container);
  });

  it("the temperature card", () => {
    const thermalShift = detectThermalShift(
      [36.3, 36.4, 36.3, 36.35, 36.3, 36.4, 36.7, 36.75, 36.8].map((temperature, i) => ({
        date: addDays("2026-08-01", i),
        temperature,
      }))
    );
    const { container } = render(
      <CycleInsightsCard insights={[]} thermalShift={thermalShift} hasAnyLogs planningMode />
    );
    expect(container.textContent).toMatch(/follows ovulation/);
    assertLabelled(container);
  });

  it("the day log's temperature hint", () => {
    const { container } = render(
      withQuery(
        <CycleDayLog patientId="p1" organisationId="o1" date={today} existing={null} planningMode />
      )
    );
    expect(container.textContent).toMatch(/confirms rather than predicts/);
    assertLabelled(container);
  });

  it("the tracker's 'What to expect' card, the estimated ovulation tile and the reading card", async () => {
    render(withQuery(<CycleTracker patientId="p1" organisationId="o1" lifeStage="menstruating" selfReportedCycleLengthDays={null} initialPlanningMode />));
    const expectCard = (await screen.findByText("What to expect")).closest("div[class*='rounded']") as HTMLElement;
    const card = expectCard.parentElement as HTMLElement;
    expect(within(card).getByText("Estimated ovulation")).toBeTruthy();
    assertLabelled(card);
    expect(document.body.textContent).toMatch(/Fertility basics/);
    // every fertile-window surface on the page is labelled: the page holds no window text without a label near it
    expect(screen.getAllByTestId("fertile-window-notice").length).toBeGreaterThanOrEqual(4);
  });
});

describe("with Planning a pregnancy OFF (the default) the window is not shown anywhere", () => {
  it("the legend and calendar", () => {
    const legend = render(<CycleLegend planningMode={false} />);
    expect(legend.container.textContent).not.toMatch(NEVER_WHILE_OFF);
    expect(legend.container.textContent).not.toMatch(/ovulation|luteal/i);
    expect(within(legend.container).queryByTestId("fertile-window-notice")).toBeNull();
    legend.unmount();

    const { container } = render(
      <CycleCalendar
        cycles={[]}
        dailyLogs={[]}
        prediction={rawPrediction()}
        planningMode={false}
        today={today}
        selectedDate={today}
        onSelectDate={() => {}}
      />
    );
    expect(container.textContent).not.toMatch(NEVER_WHILE_OFF);
    // not even when handed the raw prediction: no day is labelled as fertile or ovulation
    for (const cell of container.querySelectorAll("button[aria-label]")) {
      expect(cell.getAttribute("aria-label")).not.toMatch(/fertile|ovulation/i);
    }
  });

  it("the ring draws no fertile, ovulation or luteal arc even when handed the raw prediction", () => {
    const { container } = render(<CycleRing prediction={rawPrediction()} planningMode={false} />);
    const strokes = [...container.querySelectorAll("path")].map((p) => p.getAttribute("stroke"));
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes).not.toContain("var(--cycle-fertile)");
    expect(strokes).not.toContain("var(--cycle-ovulation)");
    expect(strokes).not.toContain("var(--cycle-luteal)");
    expect(container.querySelector("svg")?.getAttribute("aria-label")).not.toMatch(/fertile|ovulation/i);
  });

  it("the temperature card and the day log say nothing about ovulation being confirmed", () => {
    const thermalShift = detectThermalShift(
      [36.3, 36.4, 36.3, 36.35, 36.3, 36.4, 36.7, 36.75, 36.8].map((temperature, i) => ({
        date: addDays("2026-08-01", i),
        temperature,
      }))
    );
    expect(thermalShift.detected).toBe(true);
    const card = render(<CycleInsightsCard insights={[]} thermalShift={thermalShift} hasAnyLogs planningMode={false} />);
    expect(card.container.textContent ?? "").not.toMatch(/ovulation|temperature/i);
    card.unmount();

    const log = render(withQuery(<CycleDayLog patientId="p1" organisationId="o1" date={today} existing={null} planningMode={false} />));
    expect(log.container.textContent).not.toMatch(/suggests ovulation|confirms rather than predicts/i);
  });

  it("the whole tracker: period prediction stays, the window and its label do not", async () => {
    // Today really is inside the window and one day from ovulation, so a leak would show.
    const raw = rawPrediction();
    expect(raw.currentPhase === "fertile" || raw.currentPhase === "ovulation").toBe(true);

    const { container } = render(withQuery(<CycleTracker patientId="p1" organisationId="o1" lifeStage="menstruating" selfReportedCycleLengthDays={null} initialPlanningMode={false} />));
    await screen.findByText("What to expect");
    expect(screen.getByText("Next period")).toBeTruthy();
    expect(container.textContent).not.toMatch(NEVER_WHILE_OFF);
    expect(screen.queryByTestId("fertile-window-notice")).toBeNull();
    expect(screen.queryByText("Estimated ovulation")).toBeNull();
    expect(container.textContent).not.toMatch(/Fertility basics/);
    expect(screen.getByRole("switch", { name: "Planning a pregnancy" }).getAttribute("aria-checked")).toBe("false");
  });
});

describe("the switch", () => {
  const tracker = (initial: boolean) =>
    withQuery(<CycleTracker patientId="p1" organisationId="o1" lifeStage="menstruating" selfReportedCycleLengthDays={null} initialPlanningMode={initial} />);

  it("turning it on saves it, shows the window and the label", async () => {
    render(tracker(false));
    await screen.findByText("What to expect");
    fireEvent.click(screen.getByRole("switch", { name: "Planning a pregnancy" }));
    await waitFor(() => expect(mockedAction).toHaveBeenCalledWith({ enabled: true }));
    expect(await screen.findByText("Estimated ovulation")).toBeTruthy();
    expect(screen.getAllByTestId("fertile-window-notice").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("switch", { name: "Planning a pregnancy" }).getAttribute("aria-checked")).toBe("true");
  });

  it("turning it off hides everything again", async () => {
    render(tracker(true));
    await screen.findByText("Estimated ovulation");
    fireEvent.click(screen.getByRole("switch", { name: "Planning a pregnancy" }));
    await waitFor(() => expect(mockedAction).toHaveBeenCalledWith({ enabled: false }));
    await waitFor(() => expect(screen.queryByText("Estimated ovulation")).toBeNull());
    expect(screen.queryByTestId("fertile-window-notice")).toBeNull();
  });

  it("a failed save puts it back to off, with an error, rather than leaving the window showing", async () => {
    mockedAction.mockResolvedValue({ error: "Could not save that just now. Please try again." });
    render(tracker(false));
    await screen.findByText("What to expect");
    fireEvent.click(screen.getByRole("switch", { name: "Planning a pregnancy" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not save that just now");
    expect(screen.queryByText("Estimated ovulation")).toBeNull();
    expect(screen.getByRole("switch", { name: "Planning a pregnancy" }).getAttribute("aria-checked")).toBe("false");
  });
});

describe("sabotage: the label test fails when the label is removed", () => {
  it("assertLabelled throws on a surface rendered without the label", () => {
    const { container } = render(<CycleLegend planningMode />);
    assertLabelled(container); // passes with the label
    for (const n of container.querySelectorAll('[data-testid="fertile-window-notice"]')) n.remove();
    expect(() => assertLabelled(container)).toThrow(/no fertile-window label/);
  });

  it("and fails when the words are changed", () => {
    const { container } = render(<CycleLegend planningMode />);
    const notice = container.querySelector('[data-testid="fertile-window-notice"] p') as HTMLElement;
    notice.textContent = "Fertile days";
    expect(() => assertLabelled(container)).toThrow();
  });
});
