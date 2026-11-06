/** @jest-environment jsdom */
/**
 * Home's one greeting (spec 4.1, PD-05; 2026-11-06 visual pass): Lagos time of day and the first name, then one supporting
 * line; while acting, whose account it is. Other sections get only a hidden heading.
 */
import { render, screen } from "@testing-library/react";

let pathname = "/patient";
jest.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { SectionGreeting } from "./section-greeting";

afterEach(() => jest.useRealTimers());

it("greets by Lagos time and first name, with one supporting line", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-11-06T18:30:00Z")); // 19:30 in Lagos
  pathname = "/patient";
  render(<SectionGreeting firstName="Amaka" roleLabel="Patient" />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good evening, Amaka");
  expect(screen.getByText("Your health journey, all in one place.")).toBeTruthy();
  expect(screen.queryByText(/Patient dashboard/)).toBeNull();
});

it("says whose account is open while acting", () => {
  pathname = "/patient";
  render(<SectionGreeting firstName="Kola" actingFor="Adaeze Okafor" roleLabel="Acting for them" />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Adaeze Okafor's account");
  expect(screen.getByText("You are looking after Adaeze Okafor's health.")).toBeTruthy();
});

it("draws only a hidden heading on other sections", () => {
  pathname = "/patient/vitals";
  render(<SectionGreeting firstName="Amaka" roleLabel="Patient" />);
  expect(screen.getByRole("heading", { level: 1 }).className).toContain("sr-only");
});
