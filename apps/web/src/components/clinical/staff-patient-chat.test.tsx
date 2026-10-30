/** @jest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { StaffPatientChat } from "./staff-patient-chat";

const mutate = jest.fn();
let threads: { id: string; subject: string; status: string }[] = [];

jest.mock("@/lib/queries/care-messages", () => ({
  useCareThreads: () => ({ data: threads, isLoading: false, isError: false }),
  useStartThread: () => ({ mutate, isPending: false, isError: false }),
}));
jest.mock("@/components/care-message-thread", () => ({
  CareMessageThread: ({ threadId }: { threadId: string }) => <div>thread {threadId}</div>,
}));

describe("StaffPatientChat", () => {
  beforeEach(() => mutate.mockClear());

  it("starts a thread for the patient when none is open", () => {
    threads = [];
    render(<StaffPatientChat patientId="p1" patientName="Ada" />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Please confirm your visit" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(mutate).toHaveBeenCalledWith(
      { patientId: "p1", subject: "A message from your care team", body: "Please confirm your visit" },
      expect.anything()
    );
  });

  it("shows the open conversation instead of a form", () => {
    threads = [{ id: "t1", subject: "Hello", status: "open" }];
    render(<StaffPatientChat patientId="p1" patientName="Ada" />);
    expect(screen.getByText("thread t1")).toBeTruthy();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });
});
