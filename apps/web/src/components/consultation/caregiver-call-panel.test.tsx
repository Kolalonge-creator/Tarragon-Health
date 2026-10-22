/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CaregiverCallPanel } from "./caregiver-call-panel";
import type { CaregiverList } from "@/lib/consultations/caregivers";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: jest.fn(), replace: jest.fn() }) }));

const invite = jest.fn();
const cancel = jest.fn();
const remove = jest.fn();
jest.mock("@/lib/consultations/actions", () => ({
  inviteCaregiverAction: (...a: unknown[]) => invite(...a),
  cancelCaregiverInviteAction: (...a: unknown[]) => cancel(...a),
  removeCaregiverAction: (...a: unknown[]) => remove(...a),
}));

const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const pass = (over: Partial<CaregiverList["passes"][number]> = {}): CaregiverList["passes"][number] => ({
  pass_id: "pass-1",
  relationship: "Daughter",
  state: "accepted",
  expires_at: "2026-10-16T22:00:00Z",
  present: false,
  removable: false,
  name: "Ada",
  ...over,
});
const patientList = (over: Partial<CaregiverList> = {}): CaregiverList => ({ role: "patient", live: true, max: 1, passes: [], invitable: [], ...over });
const clinicianList = (over: Partial<CaregiverList> = {}): CaregiverList => ({ role: "clinician", live: true, max: 1, passes: [], invitable: [], ...over });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("CaregiverCallPanel, patient side", () => {
  it("offers each person from the Care Circle who may be invited, and invites on one tap", async () => {
    invite.mockResolvedValue({ ok: true, passId: "p" });
    render(<CaregiverCallPanel encounterId={ENC} locale="en" list={patientList({ invitable: [{ member_id: "m1", name: "Ada", relationship: "Daughter" }] })} />);
    expect(screen.getByText(/the call is never recorded/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Invite Ada (Daughter)" })));
    expect(invite).toHaveBeenCalledWith(ENC, "m1");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Invite sent. They will see it in the app.")).toBeTruthy();
  });

  it("says plainly when no one can be invited yet", () => {
    render(<CaregiverCallPanel encounterId={ENC} locale="en" list={patientList()} />);
    expect(screen.getByText(/No one in your Care Circle can be invited to calls yet/)).toBeTruthy();
  });

  it("shows the state of the person invited, lets the patient cancel, and offers no more invites once the call is full", async () => {
    cancel.mockResolvedValue({ ok: true });
    render(
      <CaregiverCallPanel
        encounterId={ENC}
        locale="en"
        list={patientList({ passes: [pass({ state: "invited" })], invitable: [{ member_id: "m2", name: "Bola", relationship: "Son" }] })}
      />,
    );
    expect(screen.getByText(/Ada \(Daughter\): Invited, waiting for their answer/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Invite Bola/ })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel this invite" })));
    expect(cancel).toHaveBeenCalledWith("pass-1");
  });

  it("says when the care team removed someone, and keeps the call open for the cap again", () => {
    render(<CaregiverCallPanel encounterId={ENC} locale="en" list={patientList({ passes: [pass({ state: "removed" })], invitable: [{ member_id: "m2", name: "Bola", relationship: "Son" }] })} />);
    expect(screen.getByText(/Removed from this call by your care team/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel this invite" })).toBeNull();
  });

  it("shows an error, never a silent success, when the invite is refused", async () => {
    invite.mockResolvedValue({ ok: false, reason: "not_allowed" });
    render(<CaregiverCallPanel encounterId={ENC} locale="en" list={patientList({ invitable: [{ member_id: "m1", name: "Ada", relationship: "Daughter" }] })} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Invite Ada (Daughter)" })));
    expect(screen.getByRole("alert").textContent).toBe("That invite is not allowed for this call.");
    invite.mockResolvedValue({ ok: false, reason: "failed" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Invite Ada (Daughter)" })));
    expect(screen.getByRole("alert").textContent).toBe("We could not do that just now. Please try again.");
  });

  it("renders nothing when the call is over and nobody was invited", () => {
    const { container } = render(<CaregiverCallPanel encounterId={ENC} locale="en" list={patientList({ live: false })} />);
    expect(container.textContent).toBe("");
  });

  it("has no accessibility violations", async () => {
    cleanup();
    await expectNoA11yViolations(<CaregiverCallPanel encounterId={ENC} locale="en" list={patientList({ passes: [pass({ state: "invited" })] })} />);
  });
});

describe("CaregiverCallPanel, clinician side", () => {
  it("shows 'Caregiver present' with the relationship label only, never a name", () => {
    render(<CaregiverCallPanel encounterId={ENC} locale="en" list={clinicianList({ passes: [pass({ present: true, removable: true, name: null })] })} />);
    expect(screen.getByText("Caregiver present: Daughter")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Ada");
  });

  it("distinguishes accepted-but-not-in from invited-and-silent", () => {
    render(
      <CaregiverCallPanel
        encounterId={ENC}
        locale="en"
        list={clinicianList({ passes: [pass({ name: null }), pass({ pass_id: "pass-2", state: "invited", relationship: "Son", name: null })] })}
      />,
    );
    expect(screen.getByText("Caregiver accepted: Daughter (not in the call yet)")).toBeTruthy();
    expect(screen.getByText("Caregiver invited: Son (not answered yet)")).toBeTruthy();
  });

  it("removes with one tap, says what that does and does not do, and shows a failure", async () => {
    remove.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: "failed" });
    render(<CaregiverCallPanel encounterId={ENC} locale="en" list={clinicianList({ passes: [pass({ present: true, removable: true, name: null })] })} />);
    expect(screen.getByText(/also remove them in the call's own participant list/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove from this call" })));
    expect(remove).toHaveBeenCalledWith("pass-1");
    expect(screen.getByText("Removed. They cannot join this call again.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove from this call" })));
    expect(screen.getByRole("alert").textContent).toBe("We could not do that just now. Please try again.");
  });

  it("keeps a removal on screen, with the one thing the platform cannot do for them: expel someone already in the video", () => {
    render(<CaregiverCallPanel encounterId={ENC} locale="en" list={clinicianList({ passes: [pass({ state: "removed", name: null })] })} />);
    expect(screen.getByText(/Caregiver removed: Daughter\. If they are still in the video, also remove them/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove from this call" })).toBeNull();
  });

  it("offers no invite controls to the clinician, and nothing at all when nobody was invited", () => {
    const { container } = render(<CaregiverCallPanel encounterId={ENC} locale="en" list={clinicianList()} />);
    expect(container.textContent).toBe("");
    cleanup();
    render(<CaregiverCallPanel encounterId={ENC} locale="en" list={clinicianList({ passes: [pass({ name: null })], invitable: [{ member_id: "m2", name: "Bola", relationship: "Son" }] })} />);
    expect(screen.queryByRole("button", { name: /Invite/ })).toBeNull();
  });

  it("has no accessibility violations", async () => {
    cleanup();
    await expectNoA11yViolations(<CaregiverCallPanel encounterId={ENC} locale="en" list={clinicianList({ passes: [pass({ present: true, removable: true, name: null })] })} />);
  });
});
