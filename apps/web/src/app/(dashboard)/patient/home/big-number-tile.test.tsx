/** @jest-environment jsdom */
/** Big-number tile: the value large with its unit, a hint instead of a dash when empty, the trend in words, a line only with two points. */
import { render, screen } from "@testing-library/react";
import { HeartPulse } from "lucide-react";
import { BigNumberTile } from "./big-number-tile";
import { DoseBars, doseDayText } from "@/components/charts/dose-bars";

it("shows the value, unit, detail and a trend line", () => {
  const { container } = render(
    <BigNumberTile icon={HeartPulse} label="Pulse" value="72" unit="bpm" detail="Today, 08:10 · Steady this month" points={[{ t: 1, v: 70 }, { t: 2, v: 72 }]} />,
  );
  expect(screen.getByText("72").textContent).toBe("72bpm");
  expect(screen.getByText("Today, 08:10 · Steady this month")).toBeTruthy();
  expect(container.querySelector('svg[role="img"]')?.getAttribute("aria-label")).toBe("Pulse, last 30 days");
});

it("shows a hint, never a dash, and no line when there is nothing to draw", () => {
  const { container } = render(<BigNumberTile icon={HeartPulse} label="Pulse" empty="No reading yet" points={[{ t: 1, v: 70 }]} />);
  expect(screen.getByText("No reading yet")).toBeTruthy();
  expect(container.textContent).not.toContain("—");
  expect(container.querySelector('svg[role="img"]')).toBeNull();
});

it("gives every dose day a sentence for screen readers", () => {
  render(<DoseBars days={[{ date: "2026-11-05", due: 2, taken: 1 }, { date: "2026-11-04", due: 0, taken: 0 }]} />);
  expect(doseDayText({ date: "2026-11-05", due: 2, taken: 1 })).toBe("Thu 5 Nov: 1 of 2 marked taken");
  expect(screen.getByText("Wed 4 Nov: nothing was due")).toBeTruthy();
  expect(screen.getByText("Marked taken")).toBeTruthy();
});

it("keeps the clinical-severity tint on the icon when given (the BP band)", () => {
  const { container } = render(<BigNumberTile icon={HeartPulse} label="Blood pressure" value="182/121" unit="mmHg" tintClassName="bg-red-100" />);
  expect(container.querySelector(".bg-red-100")).not.toBeNull();
});

it("compact dose bars carry no table, so a tile link is not named by it", () => {
  const { container } = render(<DoseBars compact days={[{ date: "2026-11-05", due: 1, taken: 1 }]} />);
  expect(container.querySelector("table")).toBeNull();
});
