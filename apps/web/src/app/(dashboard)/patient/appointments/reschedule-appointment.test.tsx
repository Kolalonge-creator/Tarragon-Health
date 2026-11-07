/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RescheduleAppointment } from "./reschedule-appointment";

let slots: { data?: unknown[]; isLoading: boolean; isError: boolean } = { data: [], isLoading: false, isError: false };
const mutateAsync = jest.fn(async () => ({}));
jest.mock("@/lib/queries/appointments", () => ({
  useAvailableAppointmentSlots: () => slots,
  useRescheduleAppointment: () => ({ mutateAsync, isPending: false }),
}));

const NOW = Date.parse("2026-11-10T10:00:00Z");
const appointment = {
  id: "appt-1",
  organisation_id: "org-1",
  clinician_id: "clin-1",
  appointment_type: "telemedicine",
  scheduled_for: "2026-11-12T10:00:00Z",
};
const slot = (clinician: string, start: string) => ({ clinician_id: clinician, slot_start: start, slot_end: start.replace(":00:00", ":20:00") });

describe("RescheduleAppointment", () => {
  beforeEach(() => mutateAsync.mockClear());

  it("lists only the same clinician's future open times, not the current one", () => {
    slots = {
      data: [
        slot("clin-1", "2026-11-12T10:00:00Z"), // the current time
        slot("clin-1", "2026-11-09T10:00:00Z"), // already past
        slot("clin-2", "2026-11-13T10:00:00Z"), // someone else
        slot("clin-1", "2026-11-14T10:00:00Z"),
      ],
      isLoading: false,
      isError: false,
    };
    render(<RescheduleAppointment appointment={appointment} patientId="p1" openedAtMs={NOW} onDone={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("moves the appointment to the chosen time and reports it", async () => {
    slots = { data: [slot("clin-1", "2026-11-14T10:00:00Z")], isLoading: false, isError: false };
    const onDone = jest.fn();
    render(<RescheduleAppointment appointment={appointment} patientId="p1" openedAtMs={NOW} onDone={onDone} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("listitem").querySelector("button")!);
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ appointmentId: "appt-1", newScheduledFor: "2026-11-14T10:00:00Z", newEndsAt: "2026-11-14T10:20:00Z" }),
    );
    expect(onDone).toHaveBeenCalledWith(expect.stringMatching(/^Moved to /));
  });

  it("says Couldn't load when the slot search fails", () => {
    slots = { data: undefined, isLoading: false, isError: true };
    render(<RescheduleAppointment appointment={appointment} patientId="p1" openedAtMs={NOW} onDone={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn.t load open times/);
  });
});
