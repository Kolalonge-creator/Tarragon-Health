/** @jest-environment jsdom */
/**
 * S08z: a dose tied to the patient's day is shown only once their own anchor times have been read. At the proposed starting times it
 * could show a time that is not theirs, and an answer logged against it would sit on a slot the server does not hold.
 */
import { render, screen } from "@testing-library/react";
import { defaultsProfile } from "@/lib/medication-schedule/anchor-profile";

let anchorData: unknown;
const anchored = {
  id: "m1",
  drug_name: "Anchored",
  organisation_id: "org-1",
  schedule_times: ["07:30"],
  schedule_spec: { kind: "daily", times: [], startDate: null, endDate: null, foodNote: null, anchored: [{ slot: "s00000000a3", offsetMinutes: 0 }] },
};
const plain = { id: "m2", drug_name: "Plain", organisation_id: "org-1", schedule_times: ["20:00"], schedule_spec: null };
let meds: unknown[] = [anchored];

jest.mock("@/lib/queries/medications", () => ({
  useMedications: () => ({ data: meds, isLoading: false }),
  useTodaysDoseLogs: () => ({ data: [], isLoading: false }),
  useLogDose: () => ({ mutate: jest.fn(), isPending: false }),
  todayIsoDate: () => "2026-10-07",
}));
jest.mock("@/lib/queries/dose-anchors", () => ({ useAnchors: () => ({ data: anchorData }) }));

import { TodaysDoses } from "./todays-doses";

describe("Today's doses with doses tied to the day", () => {
  beforeEach(() => {
    meds = [anchored];
  });

  it("shows no time, and says why, while the patient's own times have not been read (or could not be)", () => {
    for (const data of [undefined, { profile: defaultsProfile(), timeRows: [], shiftRows: [], slotRows: [], loaded: false }]) {
      anchorData = data;
      const { unmount } = render(<TodaysDoses patientId="p1" />);
      expect(screen.getByRole("status").textContent).toMatch(/as soon as we have read your times/);
      expect(screen.queryByRole("button", { name: "Taken" })).toBeNull();
      unmount();
    }
  });

  it("shows the dose at the patient's own time, in plain words, once their times are read", () => {
    anchorData = {
      profile: { ...defaultsProfile(), slots: { s00000000a3: "breakfast" }, times: { breakfast: [{ effectiveFrom: "2026-01-01", time: "09:05" }] } },
      timeRows: [],
      shiftRows: [],
      slotRows: [],
      loaded: true,
    };
    render(<TodaysDoses patientId="p1" />);
    expect(screen.getByText("09:05")).not.toBeNull();
    expect(screen.getByText(/with breakfast/)).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a patient with no doses tied to their day never waits on their anchors", () => {
    meds = [plain];
    anchorData = undefined;
    render(<TodaysDoses patientId="p1" />);
    expect(screen.getByText("20:00")).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
