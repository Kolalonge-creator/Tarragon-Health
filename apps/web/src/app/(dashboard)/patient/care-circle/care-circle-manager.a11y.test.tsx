/** @jest-environment jsdom */
/**
 * The patient's Care Circle screen (S29): lists members and waiting invites with a masked hint only, shows the invite link once
 * after it is made, refuses to submit with nothing ticked, confirms before removing, and is axe-clean.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CircleError } from "@/lib/queries/care-circle";
import { CareCircleManager } from "./care-circle-manager";

const MEMBER = { member_id: "m1", name: "Ngozi Eze", relationship: "Daughter", permissions: ["red_alerts"], expires_at: "2027-06-01T00:00:00Z", since: "2026-10-01T00:00:00Z" };
const INVITE = { invite_id: "i1", hint: "+234•••••4567", kind: "phone", relationship: "Son", permissions: ["pay_for_care"], expires_at: "2026-10-10T00:00:00Z" };

let circle: { data: unknown; isSuccess: boolean };
let log: { data: unknown[]; isSuccess: boolean };
const create = jest.fn();
const update = jest.fn();
const revoke = jest.fn();
const cancel = jest.fn();
jest.mock("@/lib/queries/care-circle", () => {
  const actual = jest.requireActual("@/lib/queries/care-circle");
  return {
    ...actual,
    useMyCircle: () => circle,
    useCircleViewLog: () => log,
    useCreateInvite: () => ({ mutateAsync: create, isPending: false }),
    useUpdateMember: () => ({ mutateAsync: update, isPending: false }),
    useRevokeMember: () => ({ mutate: revoke, isPending: false }),
    useCancelInvite: () => ({ mutate: cancel, isPending: false }),
  };
});

beforeEach(() => {
  circle = { data: { members: [MEMBER], invites: [INVITE] }, isSuccess: true };
  log = { data: [{ viewer: "Ngozi Eze", at: "2026-10-06T10:00:00Z" }], isSuccess: true };
  [create, update, revoke, cancel].forEach((f) => f.mockReset());
});

describe("CareCircleManager", () => {
  it("shows members, a masked hint for a waiting invite, and who looked", async () => {
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    expect(screen.getByText("Ngozi Eze")).toBeTruthy();
    expect(screen.getByText(/\+234•••••4567/)).toBeTruthy();
    expect(screen.getByText(/Ngozi Eze, /)).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<CareCircleManager locale="en" origin="https://app.example" />);
  });

  it("says so when the circle is empty", () => {
    circle = { data: { members: [], invites: [] }, isSuccess: true };
    log = { data: [], isSuccess: true };
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    expect(screen.getByText(/No one yet/)).toBeTruthy();
    expect(screen.getByText(/No invites waiting/)).toBeTruthy();
    expect(screen.getByText(/No one has looked yet/)).toBeTruthy();
  });

  it("does not offer to make an invite until a contact, a relationship and at least one permission are given", () => {
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    const make = screen.getByRole("button", { name: "Make invite link" }) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Their email or phone number"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText(/How are they related/), { target: { value: "Daughter" } });
    expect(make.disabled).toBe(true);
    fireEvent.click(screen.getAllByLabelText(/message asking them to check on me/)[1]!);
    expect(make.disabled).toBe(false);
  });

  it("sends exactly the ticked permissions and shows the link once", async () => {
    create.mockResolvedValue({ invite_id: "i2", token: "t".repeat(43), expires_at: "2026-10-09T10:00:00Z", grant_days: 365 });
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    fireEvent.change(screen.getByLabelText("Their email or phone number"), { target: { value: " ada@example.com " } });
    fireEvent.change(screen.getByLabelText(/How are they related/), { target: { value: "Daughter" } });
    fireEvent.click(screen.getAllByLabelText(/message asking them to check on me/)[1]!);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Make invite link" })));
    expect(create).toHaveBeenCalledWith({ kind: "email", contact: "ada@example.com", relationship: "Daughter", permissions: ["red_alerts"], days: 365 });
    expect(screen.getByText(`https://app.example/patient/supporting/join/${"t".repeat(43)}`)).toBeTruthy();
    expect(screen.getByText(/only once/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText(/patient\/supporting\/join/)).toBeNull();
  });

  it("shows a database refusal in plain words", async () => {
    create.mockRejectedValue(new CircleError("invite_rate_limited"));
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    fireEvent.change(screen.getByLabelText("Their email or phone number"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText(/How are they related/), { target: { value: "Daughter" } });
    fireEvent.click(screen.getAllByLabelText(/message asking them to check on me/)[1]!);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Make invite link" })));
    expect(screen.getByRole("alert").textContent).toMatch(/several invites today/);
  });

  it("asks before removing a member and does nothing if the patient says no", () => {
    const confirm = jest.spyOn(window, "confirm");
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    const remove = screen.getByRole("button", { name: "Remove" });
    fireEvent.click(remove);
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(remove);
    expect(revoke).toHaveBeenCalledWith("m1");
    confirm.mockRestore();
  });

  it("saves changed permissions for a member and cancels a waiting invite", async () => {
    update.mockResolvedValue(undefined);
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getAllByLabelText(/Paying for my care/)[0]!);
    expect(save.disabled).toBe(false);
    await act(async () => fireEvent.click(save));
    expect(update).toHaveBeenCalledWith({ memberId: "m1", permissions: ["red_alerts", "pay_for_care"] });
    expect(screen.getByRole("status").textContent).toMatch(/Saved/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel invite" }));
    expect(cancel).toHaveBeenCalledWith("i1");
  });
});
