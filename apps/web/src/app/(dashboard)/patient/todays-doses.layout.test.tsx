/** @jest-environment jsdom */
/**
 * Design audit P0: each dose shows "Taken" and "More" only, so the row never overflows a phone screen.
 * The other answers (Skipped, Delayed, ...) appear after "More" is opened.
 */
import { render, screen, fireEvent } from "@testing-library/react";

let logs: unknown[] = [];
const plain = { id: "m2", drug_name: "Plain", organisation_id: "org-1", schedule_times: ["20:00"], schedule_spec: null };

jest.mock("@/lib/queries/medications", () => ({
  useMedications: () => ({ data: [plain], isLoading: false }),
  useTodaysDoseLogs: () => ({ data: logs, isLoading: false }),
  useLogDose: () => ({ mutate: jest.fn(), isPending: false }),
  todayIsoDate: () => "2026-10-29",
}));
jest.mock("@/lib/queries/dose-anchors", () => ({ useAnchors: () => ({ data: undefined }) }));

import { TodaysDoses } from "./todays-doses";

describe("Today's doses row layout", () => {
  it("shows only Taken and More until More is opened", () => {
    render(<TodaysDoses patientId="p1" />);
    expect(screen.getByRole("button", { name: "Taken" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "More" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Skipped" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("button", { name: "Skipped" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Missed" })).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Taken" })).toHaveLength(1);
  });

  it("an answered dose offers Change, which includes Taken so a wrong answer can be corrected", () => {
    logs = [{ medication_id: "m2", status: "skipped", scheduled_time: "20:00", scheduled_for_date: "2026-10-29" }];
    render(<TodaysDoses patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("button", { name: "Taken" })).not.toBeNull();
    logs = [];
  });
});
