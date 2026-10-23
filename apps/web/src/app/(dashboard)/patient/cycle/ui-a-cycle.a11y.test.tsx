/** @jest-environment jsdom */
/**
 * UI-A (cycle redesign): the plain-word status, the confidence line with its three dots, the week strip, the calendar's
 * "What do these marks mean?" legend, the danger signs in the alert template, and the access list's empty and failed states.
 * Each is checked for what it says and for accessibility violations.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { addDays, predictCycle } from "@/lib/rules/cycle-prediction";
import { CycleDangerSigns } from "./cycle-danger-signs";
import { CalendarMarksLegend } from "./cycle-calendar";
import { ConfidenceLine, CycleStatusLine } from "./cycle-status";
import { CycleWeekStrip } from "./cycle-week-strip";

const today = "2026-10-10";
const predict = (starts: number[]) =>
  predictCycle({
    periods: starts.map((n) => ({ startDate: addDays(today, n), endDate: addDays(today, n + 4) })),
    today,
    lifeStage: "menstruating",
    selfReportedCycleLengthDays: null,
    heavyFlowDates: [],
    conceptionPlanning: false,
  });

describe("status line and confidence", () => {
  it("says it in one plain sentence with no red", async () => {
    const { container } = await expectNoA11yViolations(<CycleStatusLine prediction={predict([-97, -69, -41, -13])} />);
    expect(screen.getByRole("status").textContent).toMatch(/^Period expected in about \d+ days\.$/);
    expect(container.innerHTML).not.toMatch(/red-/);
  });

  it("is amber and calm when late, with no exclamation mark", () => {
    const { container } = render(<CycleStatusLine prediction={predict([-120, -92, -64, -36])} />);
    expect(screen.getByRole("status").textContent).toMatch(/later than the estimate/);
    expect(container.textContent).not.toMatch(/!/);
    expect(container.innerHTML).toMatch(/amber/);
    expect(container.innerHTML).not.toMatch(/red-/);
  });

  it("shows confidence as words plus a dot scale read as 'n of 3'", async () => {
    await expectNoA11yViolations(<ConfidenceLine confidence="medium" />);
    expect(screen.getByText("Fairly steady estimate.")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Confidence: 2 of 3 dots.");
  });

  it("does not show a filled dot when there is no estimate", () => {
    render(<ConfidenceLine confidence="none" />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Confidence: 0 of 3 dots.");
  });
});

describe("week strip", () => {
  it("offers seven days, selects with one tap, and has a 'Pick another date' link instead of a typed date", async () => {
    const onSelect = jest.fn();
    await expectNoA11yViolations(<CycleWeekStrip today={today} selectedDate={today} onSelectDate={onSelect} loggedDays={new Set([addDays(today, -1)])} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(7);
    expect(buttons[6]?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(buttons[3] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(addDays(today, -3));
    expect(screen.getByRole("link", { name: "Pick another date" }).getAttribute("href")).toBe("#cycle-calendar");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("a period in progress", () => {
  it("says it started N days ago and shows no countdown", () => {
    const p = predict([-97, -69, -41, -2]);
    render(<CycleStatusLine prediction={p} inProgress={{ startedOn: addDays(today, -2), today }} />);
    expect(screen.getByRole("status").textContent).toBe("Your period started 2 days ago.");
  });
});

describe("touch targets", () => {
  it("'Pick another date' is at least 44px tall", () => {
    render(<CycleWeekStrip today={today} selectedDate={today} onSelectDate={() => {}} loggedDays={new Set()} />);
    expect(screen.getByRole("link", { name: "Pick another date" }).className).toMatch(/min-h-11/);
  });
});

describe("calendar marks legend", () => {
  it("explains marks by shape and word; the planning rows appear only in planning mode and carry the label", async () => {
    const off = await expectNoA11yViolations(<CalendarMarksLegend planningMode={false} />);
    expect(off.container.textContent).toMatch(/Filled circle/);
    expect(off.container.textContent).not.toMatch(/fertile|ovulation/i);
    off.unmount();
    const on = render(<CalendarMarksLegend planningMode />);
    expect(on.container.textContent).toMatch(/Bar under the number: your estimated fertile window\. This is not contraception\./);
    expect(on.container.textContent).toMatch(/Diamond: your estimated ovulation day\. This is not contraception\./);
  });
});

describe("danger signs follow the alert template", () => {
  it("shows the one step first, then noticed, meaning, then a message button, with no exclamation marks or WARNING", async () => {
    const { container } = await expectNoA11yViolations(<CycleDangerSigns />);
    const text = container.textContent ?? "";
    const order = ["One step", "What to look out for", "What it may mean", "Message your care team"].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toMatch(/!|warning/i);
    const link = screen.getByRole("link", { name: "Message your care team" });
    expect(link.getAttribute("href")).toBe("/patient/messages");
    expect(link.className).toMatch(/min-h-11/);
  });
});
