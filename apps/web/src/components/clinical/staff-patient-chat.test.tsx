/** @jest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StaffPatientChat } from "./staff-patient-chat";

const mutate = jest.fn();
let threads: { id: string; subject: string; status: string; confidential?: boolean }[] = [];

jest.mock("@/lib/queries/care-messages", () => ({
  useCareThreads: () => ({ data: threads, isLoading: false, isError: false }),
  useStartThread: () => ({ mutate, isPending: false, isError: false }),
}));
jest.mock("@/lib/queries/current-user", () => ({ useCurrentUserId: () => ({ data: "staff1" }) }));
jest.mock("@/components/masked-call-button", () => ({ MaskedCallButton: () => <button>Call</button> }));
jest.mock("@/components/care-message-thread", () => ({
  CareMessageThread: ({ threadId }: { threadId: string }) => <div>thread {threadId}</div>,
}));

const renderChat = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("StaffPatientChat", () => {
  beforeEach(() => mutate.mockClear());

  it("starts a thread for the patient when none is open", () => {
    threads = [];
    renderChat(<StaffPatientChat patientId="p1" patientName="Ada" />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Please confirm your visit" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(mutate).toHaveBeenCalledWith(
      { patientId: "p1", subject: "A message from your care team", body: "Please confirm your visit" },
      expect.anything()
    );
  });

  it("shows the open conversation instead of a form", () => {
    threads = [{ id: "t1", subject: "Hello", status: "open" }];
    renderChat(<StaffPatientChat patientId="p1" patientName="Ada" />);
    expect(screen.getByText("thread t1")).toBeTruthy();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("never lists a confidential thread", () => {
    threads = [{ id: "c1", subject: "Private", status: "open", confidential: true }];
    renderChat(<StaffPatientChat patientId="p1" patientName="Ada" />);
    expect(screen.queryByText("thread c1")).toBeNull();
    expect(screen.getByLabelText("Message")).toBeTruthy();
  });

  it("loads only the newest open thread until an earlier one is asked for", () => {
    threads = [
      { id: "t1", subject: "New", status: "open" },
      { id: "t2", subject: "Old", status: "open" },
    ];
    renderChat(<StaffPatientChat patientId="p1" patientName="Ada" />);
    expect(screen.getByText("thread t1")).toBeTruthy();
    expect(screen.queryByText("thread t2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Earlier conversation: Old/ }));
    expect(screen.getByText("thread t2")).toBeTruthy();
  });

  it("opens nothing on load when startClosed", () => {
    threads = [{ id: "t1", subject: "New", status: "open" }];
    renderChat(<StaffPatientChat patientId="p1" patientName="Ada" startClosed />);
    expect(screen.queryByText("thread t1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open chat with Ada/ }));
    expect(screen.getByText("thread t1")).toBeTruthy();
  });

  it("offers a call once the signed-in staff member is known", async () => {
    threads = [];
    renderChat(<StaffPatientChat patientId="p1" patientName="Ada" />);
    expect(await screen.findByText("Call")).toBeTruthy();
  });
});
