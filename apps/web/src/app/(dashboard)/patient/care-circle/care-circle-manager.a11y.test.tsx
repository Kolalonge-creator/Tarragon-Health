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
const renew = jest.fn();
const pause = jest.fn();
const resume = jest.fn();
let previewMember: { data: unknown; isPending: boolean; isError: boolean };
let previewPerms: { data: unknown; isPending: boolean; isError: boolean };
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
    useRenewMember: () => ({ mutateAsync: renew, isPending: false }),
    usePauseCircle: () => ({ mutateAsync: pause, isPending: false }),
    useResumeCircle: () => ({ mutateAsync: resume, isPending: false }),
    usePreviewMember: () => previewMember,
    usePreviewPermissions: () => previewPerms,
    usePendingGifts: () => ({ data: [] }),
    useRespondToGift: () => ({ mutateAsync: jest.fn(), isPending: false }),
  };
});

beforeEach(() => {
  circle = { data: { members: [MEMBER], invites: [INVITE], pause: null, pause_days: 7 }, isSuccess: true };
  previewMember = { data: undefined, isPending: true, isError: false };
  previewPerms = { data: undefined, isPending: true, isError: false };
  log = { data: [{ viewer: "Ngozi Eze", at: "2026-10-06T10:00:00Z" }], isSuccess: true };
  [create, update, revoke, cancel, renew, pause, resume].forEach((f) => f.mockReset());
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
    const remove = screen.getByRole("button", { name: "Stop sharing" });
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

  it("renews a member with one tap and leaves their permissions alone (the server does the dates)", async () => {
    renew.mockResolvedValue(undefined);
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Renew for a year" })));
    expect(renew).toHaveBeenCalledWith("m1");
    expect(update).not.toHaveBeenCalled();
  });

  it("says when a member's access ends soon, and not when it does not", () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    circle = { data: { members: [{ ...MEMBER, expires_at: soon }], invites: [] }, isSuccess: true };
    const { unmount } = render(<CareCircleManager locale="en" origin="https://app.example" />);
    expect(screen.getByText(/Access ends soon/)).toBeTruthy();
    unmount();
    circle = { data: { members: [{ ...MEMBER, expires_at: new Date(Date.now() + 200 * 86_400_000).toISOString() }], invites: [] }, isSuccess: true };
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    expect(screen.queryByText(/Access ends soon/)).toBeNull();
  });

  it("keeps stopping as visible as sharing: the button says Stop sharing and a reminder says it is one tap", () => {
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    expect(screen.getByText(/stop sharing with anyone, at any time, with one tap/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeTruthy();
  });

  it("pauses sharing but keeps check-in requests on unless the patient ticks to pause them too", async () => {
    pause.mockResolvedValue(undefined);
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    expect(screen.getByText(/no one in your circle can see anything. They are not told/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pause for 7 days" })));
    expect(pause).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByLabelText(/Also pause check-in requests/));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pause for 7 days" })));
    expect(pause).toHaveBeenLastCalledWith(true);
  });

  it("while paused, says so with the date and offers to start again", async () => {
    resume.mockResolvedValue(undefined);
    circle = { data: { members: [MEMBER], invites: [], pause: { paused_until: "2026-10-14T00:00:00Z", pause_alerts: false }, pause_days: 7 }, isSuccess: true };
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    expect(screen.getByText(/Sharing is paused until/)).toBeTruthy();
    expect(screen.getByText("Check-in requests are still on.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start sharing again" })));
    expect(resume).toHaveBeenCalled();
  });

  it("shows what a member sees, only when asked, in the supporter page's own blocks", () => {
    previewMember = { data: { patient_id: "p", name: "Me", relationship: "Daughter", permissions: ["adherence_summary", "red_alerts"], shared_until: "2027-06-01T00:00:00Z", preview: true, alert_sample: true, adherence: { days: 7, taken: 5, due: 7, percent: 71 } }, isPending: false, isError: false };
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    expect(screen.queryByText("Medicines this week")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See what they see" }));
    expect(screen.getByText("Medicines this week")).toBeTruthy();
    expect(screen.getByText(/5 of 7 doses taken/)).toBeTruthy();
    expect(screen.getByText(/They see only your name, never what happened/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Hide" })[0]!);
    expect(screen.queryByText("Medicines this week")).toBeNull();
  });

  it("previews an invite before it is made, and asks for a choice first when nothing is ticked", () => {
    previewPerms = { data: { patient_id: "p", name: "Me", relationship: "", permissions: ["adherence_summary"], shared_until: null, preview: true, alert_sample: false, adherence: { days: 7, taken: 1, due: 2, percent: 50 } }, isPending: false, isError: false };
    render(<CareCircleManager locale="en" origin="https://app.example" />);
    fireEvent.click(screen.getByRole("button", { name: "See what this would show" }));
    expect(screen.getByText("Choose something to share to see what it would show.")).toBeTruthy();
  });

  it("is axe-clean with a pause, a preview and an ending-soon notice on screen", async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    circle = { data: { members: [{ ...MEMBER, expires_at: soon }], invites: [INVITE], pause: { paused_until: "2026-10-14T00:00:00Z", pause_alerts: true }, pause_days: 7 }, isSuccess: true };
    previewMember = { data: { patient_id: "p", name: "Me", relationship: "Daughter", permissions: ["red_alerts"], shared_until: soon, preview: true, alert_sample: true }, isPending: false, isError: false };
    await expectNoA11yViolations(<CareCircleManager locale="en" origin="https://app.example" />);
  });
});
