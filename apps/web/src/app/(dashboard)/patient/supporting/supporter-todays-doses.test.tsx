/** @jest-environment jsdom */
/**
 * S08y: the supporter's read-only "today's doses". Nothing at all without the medicines category, nothing while the
 * database says not shared or closed, an honest "could not load" on a failure (never an empty list that reads as all done).
 */
import { render, screen } from "@testing-library/react";

let hook: { data?: unknown; isLoading: boolean; isError: boolean } = { isLoading: false, isError: false };
const enabledArgs: boolean[] = [];
jest.mock("@/lib/queries/medicine-safety", () => ({
  useSupporterTodaysDoses: (_id: string, enabled: boolean) => {
    enabledArgs.push(enabled);
    return hook;
  },
}));

import { SupporterTodaysDoses } from "./supporter-todays-doses";

const dose = (answer: string, dueAtMs: number) => ({ medicationId: "m1", name: "Amlodipine", time: "08:00", dueAtMs, answer });

beforeEach(() => {
  hook = { isLoading: false, isError: false };
  enabledArgs.length = 0;
});

describe("SupporterTodaysDoses", () => {
  it("renders nothing, and does not even ask, without the medicines category", () => {
    const { container } = render(<SupporterTodaysDoses patientId="p1" name="Ada" hasMedicinesCategory={false} />);
    expect(container.textContent).toBe("");
    expect(enabledArgs).toEqual([false]);
  });

  it("renders nothing when the database says not shared or closed", () => {
    for (const status of ["not_shared", "closed"]) {
      hook = { data: { status }, isLoading: false, isError: false };
      const { container, unmount } = render(<SupporterTodaysDoses patientId="p1" name="Ada" hasMedicinesCategory />);
      expect(container.textContent).toBe("");
      unmount();
    }
  });

  it("says it could not load on an error or an unreadable answer", () => {
    hook = { isLoading: false, isError: true };
    const first = render(<SupporterTodaysDoses patientId="p1" name="Ada" hasMedicinesCategory />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
    first.unmount();
    hook = { data: { status: "unreadable" }, isLoading: false, isError: false };
    render(<SupporterTodaysDoses patientId="p1" name="Ada" hasMedicinesCategory />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("lists today's doses with a plain state and the read-only note, never the word missed", () => {
    hook = {
      data: { status: "ok", date: "2026-10-20", activeMedicines: 2, doses: [dose("taken", 0), dose("none", Date.now() + 3_600_000), dose("none", 1000)] },
      isLoading: false,
      isError: false,
    };
    const { container } = render(<SupporterTodaysDoses patientId="p1" name="Ada" hasMedicinesCategory />);
    const text = container.textContent ?? "";
    expect(text).toContain("Taken");
    expect(text).toContain("Not due yet");
    expect(text).toContain("No record yet");
    expect(text).toMatch(/You can read this\. You cannot change it\./);
    expect(text).not.toMatch(/missed/i);
  });

  it("an empty day is not read as an empty list: no medicines, versus nothing scheduled", () => {
    hook = { data: { status: "ok", date: "2026-10-20", activeMedicines: 0, doses: [] }, isLoading: false, isError: false };
    const first = render(<SupporterTodaysDoses patientId="p1" name="Ada" hasMedicinesCategory />);
    expect(screen.getByText(/no medicines listed/)).toBeTruthy();
    first.unmount();
    hook = { data: { status: "ok", date: "2026-10-20", activeMedicines: 3, doses: [] }, isLoading: false, isError: false };
    render(<SupporterTodaysDoses patientId="p1" name="Ada" hasMedicinesCategory />);
    expect(screen.getByText(/No dose is scheduled for today/)).toBeTruthy();
    expect(screen.getByText(/Only medicines with a schedule appear here/)).toBeTruthy();
  });
});
