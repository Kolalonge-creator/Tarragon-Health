/** @jest-environment jsdom */
/**
 * S08z: a patient adds a medicine tied to their day on the web. The schedule is stored with the anchors (never a runtime profile),
 * the legacy list of times carries the normal look of the anchored doses, the times the patient typed are saved first, and a time
 * that would make two windows overlap is refused before anything is sent. Only the patient's own add offers it.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultsProfile } from "@/lib/medication-schedule/anchor-profile";

const mutate = jest.fn();
jest.mock("@/lib/queries/medications", () => ({
  useAddMedication: () => ({ mutate, reset: jest.fn(), error: null, isError: false, isPending: false }),
  useMedications: () => ({ data: [] }),
}));
jest.mock("@/lib/queries/medicine-catalogue", () => ({
  useInteractionCheckOpen: () => ({ data: false, isPending: false, isError: false }),
  useMedicineCatalogue: () => ({ isPending: false, isError: false, data: [] }),
}));
jest.mock("@/lib/medications/pack-actions", () => ({ checkMedicationPack: jest.fn() }));
jest.mock("./actions", () => ({ checkMedicationSafetyAfterAdd: jest.fn() }));
let anchorData: unknown;
let slotsAnswer: Record<string, string> | null = null;
const ensure = jest.fn(async (..._args: unknown[]): Promise<Record<string, string> | null> => slotsAnswer);
jest.mock("@/lib/queries/dose-anchors", () => ({ useAnchors: () => ({ data: anchorData }), ensureDoseAnchorSlots: (...a: unknown[]) => ensure(...a) }));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { AddMedicationForm } from "./add-medication-form";

beforeEach(() => {
  mutate.mockReset();
  ensure.mockClear();
  anchorData = undefined;
  slotsAnswer = { breakfast: "s00000000a3", lunch: "s00000000a5", dinner: "s00000000a8" };
});

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Add medication" }));

describe("patient add form: tied to my day", () => {
  it("sends the SLOTS in the stored schedule (never the anchor's name), the normal times for older readers, and the times the patient typed", async () => {
    render(<AddMedicationForm patientId="p1" source="patient" />);
    fireEvent.change(screen.getByLabelText("Drug name"), { target: { value: "Some remedy" } });
    fireEvent.click(screen.getByRole("button", { name: "Breakfast" }));
    fireEvent.click(screen.getByRole("button", { name: "30 minutes after breakfast" }));
    fireEvent.change(screen.getByLabelText("Breakfast: time"), { target: { value: "08:00" } });
    submit();
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(ensure).toHaveBeenCalledWith(expect.anything(), "p1", ["breakfast", "breakfast"]);
    const sent = mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.schedule_spec).toMatchObject({
      kind: "daily",
      anchored: [
        { slot: "s00000000a3", offsetMinutes: 0 },
        { slot: "s00000000a3", offsetMinutes: 30 },
      ],
    });
    expect(JSON.stringify(sent.schedule_spec)).not.toContain("anchorProfile");
    // The anchor's name is nowhere in what is stored.
    expect(JSON.stringify(sent.schedule_spec)).not.toMatch(/breakfast|prayer/);
    expect(sent.schedule_times).toEqual(["08:00", "08:30"]);
    expect(sent.anchorTimes).toEqual({ breakfast: "08:00" });
    expect(sent.source).toBe("patient");
  });

  it("confirms the starting time of an anchor the patient never set, and leaves one they already set alone", async () => {
    anchorData = { profile: { ...defaultsProfile(), slots: { s00000000a8: "dinner" }, times: { dinner: [{ effectiveFrom: "2026-01-01", time: "19:20" }] } }, timeRows: [], shiftRows: [], slotRows: [], loaded: true };
    render(<AddMedicationForm patientId="p1" source="patient" />);
    fireEvent.change(screen.getByLabelText("Drug name"), { target: { value: "Some remedy" } });
    fireEvent.click(screen.getByRole("button", { name: "Dinner" }));
    fireEvent.click(screen.getByRole("button", { name: "Lunch" }));
    submit();
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const sent = mutate.mock.calls[0]?.[0] as { anchorTimes: Record<string, string>; schedule_times: string[] };
    expect(Object.keys(sent.anchorTimes)).toEqual(["lunch"]);
    expect(sent.schedule_times).toContain("19:20");
  });

  it("sends nothing when the server could not make the slots (offline), and says so", async () => {
    slotsAnswer = null;
    render(<AddMedicationForm patientId="p1" source="patient" />);
    fireEvent.change(screen.getByLabelText("Drug name"), { target: { value: "Some remedy" } });
    fireEvent.click(screen.getByRole("button", { name: "Lunch" }));
    submit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not save|Check the times/i));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("refuses a time that is not a time, and sends nothing", async () => {
    render(<AddMedicationForm patientId="p1" source="patient" />);
    fireEvent.change(screen.getByLabelText("Drug name"), { target: { value: "Some remedy" } });
    fireEvent.click(screen.getByRole("button", { name: "Lunch" }));
    fireEvent.change(screen.getByLabelText("Lunch: time"), { target: { value: "" } });
    submit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not save|Check the times/i));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("a plain medicine sends no schedule spec and no anchor times", () => {
    render(<AddMedicationForm patientId="p1" source="patient" />);
    fireEvent.change(screen.getByLabelText("Drug name"), { target: { value: "Plain" } });
    submit();
    const sent = mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("schedule_spec" in sent).toBe(false);
    expect("anchorTimes" in sent).toBe(false);
  });

  it("is not offered on the clinician's prescribing form", () => {
    render(<AddMedicationForm patientId="p1" source="clinician" />);
    expect(screen.queryByText("Tie this to my day")).toBeNull();
  });
});
