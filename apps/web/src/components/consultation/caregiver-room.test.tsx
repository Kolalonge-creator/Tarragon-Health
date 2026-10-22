/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CaregiverRoom } from "./caregiver-room";
import type { CaregiverInvite } from "@/lib/consultations/caregivers";
import type { CallPolicy } from "@/lib/consultations/call-controller";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: jest.fn(), replace: jest.fn() }) }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const respond = jest.fn();
jest.mock("@/lib/consultations/actions", () => ({ respondCaregiverInviteAction: (...a: unknown[]) => respond(...a) }));

// The in-app call hook is proved on its own (consultation-room-call.test.tsx); here it is a stand-in so the room's own rules can be read.
const start = jest.fn();
const leave = jest.fn().mockResolvedValue(undefined);
let hookState: "idle" | "joining" | "in_call" = "idle";
let lastOptions: { role: string; policy: unknown } | null = null;
jest.mock("./use-in-app-call", () => ({
  useInAppCall: (_ref: unknown, options: { role: string; policy: unknown }) => {
    lastOptions = options;
    return { state: hookState, notice: null, start, leave, takeVideo: jest.fn() };
  },
}));

const policy = { reconnectGraceSeconds: 120 } as unknown as CallPolicy;
const INVITE: CaregiverInvite = {
  pass_id: "pass-1",
  encounter_id: "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44",
  patient_id: "p1",
  patient_first_name: "Mama",
  relationship: "Daughter",
  state: "accepted",
  scheduled_at: "2026-10-16T09:00:00Z",
  expires_at: "2026-10-16T13:00:00Z",
  join_opens_at: "2026-10-16T08:45:00Z",
  join_closes_at: "2026-10-16T10:00:00Z",
  joinable: true,
  final_media_mode: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  hookState = "idle";
  lastOptions = null;
});

describe("CaregiverRoom", () => {
  it("runs the call as a caregiver (no fallback ladder), says it is a guest view, and shows no chart", () => {
    render(<CaregiverRoom invite={INVITE} locale="en" call={{ policy }} />);
    expect(lastOptions?.role).toBe("caregiver");
    expect(screen.getByText(/You are joining as a guest/)).toBeTruthy();
    expect(screen.getByText(/The call is not recorded/)).toBeTruthy();
    expect(screen.getByText(/AI note-taker/)).toBeTruthy();
    // nothing about the patient beyond the first name in the heading
    expect(document.body.textContent).not.toMatch(/blood|pressure|result|medicine|diagnos/i);
  });

  it("asks before joining: accept or decline, and shows a failure instead of pretending", async () => {
    respond.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: "failed" });
    render(<CaregiverRoom invite={{ ...INVITE, state: "invited" }} locale="en" call={{ policy }} />);
    expect(screen.queryByRole("button", { name: "Join with video" })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept the invite" })));
    expect(respond).toHaveBeenCalledWith("pass-1", true);
    expect(refresh).toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "No thanks" })));
    expect(respond).toHaveBeenLastCalledWith("pass-1", false);
    expect(screen.getByRole("alert").textContent).toBe("We could not do that just now. Please try again.");
  });

  it("joins inside the page, with video or with audio only, and never opens a link", async () => {
    start.mockImplementation(async () => {
      hookState = "in_call";
      return "started";
    });
    const open = jest.fn();
    window.open = open;
    render(<CaregiverRoom invite={INVITE} locale="en" call={{ policy }} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Join with audio only" })));
    expect(start).toHaveBeenCalledWith("audio_only");
    expect(screen.getByText("Please switch your camera off in the call.")).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
  });

  it("when the call cannot run in the page it says so: there is no link or phone number to fall back to", async () => {
    render(<CaregiverRoom invite={INVITE} locale="en" call={null} />);
    expect(screen.getByText(/We could not connect you to the call from this page/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Join with video" })));
    expect(start).not.toHaveBeenCalled();
    expect(document.querySelector("a[href^='http']")).toBeNull();
  });

  it("explains each way the join can not start", async () => {
    render(<CaregiverRoom invite={INVITE} locale="en" call={{ policy }} />);
    start.mockResolvedValueOnce("fallback");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Join with video" })));
    expect(screen.getByRole("alert").textContent).toMatch(/has not been opened by the care team yet/);
    start.mockResolvedValueOnce("not_open");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Join with video" })));
    expect(screen.getByRole("alert").textContent).toMatch(/The call opens at/);
    start.mockResolvedValueOnce("busy");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Join with video" })));
  });

  it("disables joining before the window opens and says when it opens", () => {
    render(<CaregiverRoom invite={{ ...INVITE, joinable: false }} locale="en" call={{ policy }} />);
    expect((screen.getByRole("button", { name: "Join with video" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/The call opens at/)).toBeTruthy();
  });

  it("joins audio only when the call has already dropped to audio only", () => {
    render(<CaregiverRoom invite={{ ...INVITE, final_media_mode: "audio_only" }} locale="en" call={{ policy }} />);
    expect((screen.getByRole("button", { name: "Join with video" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Join with audio only" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the call box and a leave button while in the call", async () => {
    hookState = "in_call";
    render(<CaregiverRoom invite={INVITE} locale="en" call={{ policy }} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Leave the call" })));
    expect(leave).toHaveBeenCalled();
    expect(screen.getByTestId("call-root")).toBeTruthy();
  });

  it("says so when the call stops under a guest who was in it (they left, or the call closed)", async () => {
    hookState = "in_call";
    const { rerender } = render(<CaregiverRoom invite={INVITE} locale="en" call={{ policy }} />);
    expect(screen.queryByText("You have left the call.")).toBeNull();
    hookState = "idle";
    await act(async () => rerender(<CaregiverRoom invite={INVITE} locale="en" call={{ policy }} />));
    expect(screen.getByRole("alert").textContent).toBe("You have left the call.");
  });

  it("when the invite is gone (removed, cancelled, ended) it says the call is not available and leaves the call", () => {
    render(<CaregiverRoom invite={null} locale="en" call={{ policy }} />);
    expect(screen.getByText("This call is not available to you.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to people you support" }).getAttribute("href")).toBe("/patient/supporting");
    expect(leave).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Join with video" })).toBeNull();
  });

  it("has no accessibility violations", async () => {
    cleanup();
    await expectNoA11yViolations(<CaregiverRoom invite={INVITE} locale="en" call={{ policy }} />);
  });
});
