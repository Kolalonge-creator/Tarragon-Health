/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConsultationRoom, type RoomView } from "./consultation-room";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: jest.fn(), replace: jest.fn() }) }));

const join = jest.fn();
const scribe = jest.fn();
const noShow = jest.fn();
const finish = jest.fn();
const dialIn = jest.fn();
jest.mock("@/lib/consultations/actions", () => ({
  joinConsultationAction: (...a: unknown[]) => join(...a),
  answerScribeConsentAction: (...a: unknown[]) => scribe(...a),
  reportNoShowAction: (...a: unknown[]) => noShow(...a),
  completeConsultationAction: (...a: unknown[]) => finish(...a),
  requestDialInAction: (...a: unknown[]) => dialIn(...a),
}));

const base: RoomView = {
  encounter_id: "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44",
  role: "patient",
  status: "scheduled",
  scheduled_at: "2026-10-07T09:00:00Z",
  final_media_mode: null,
  join_opens_at: "2026-10-07T08:45:00Z",
  joinable: true,
  patient_joined: false,
  clinician_joined: false,
  scribe: { asked: false, granted: null },
  can_report_clinician_absent: false,
  can_report_patient_absent: false,
  clinician_wait_minutes: 15,
  reconnect_grace_seconds: 120,
};

beforeEach(() => {
  jest.clearAllMocks();
  window.open = jest.fn(() => null);
});

describe("ConsultationRoom", () => {
  it("keeps the person's link as a tappable link, because a popup opened after an await is blocked", async () => {
    join.mockResolvedValue({ ok: true, url: "https://video.example/r/abc?as=patient", mediaMode: "video", audioOnlyEnforced: false, recorded: true });
    render(<ConsultationRoom view={base} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Join with video" }));
    const link = await screen.findByRole("link", { name: "Open the call" });
    expect(link.getAttribute("href")).toBe("https://video.example/r/abc?as=patient");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the phone number, meeting id and passcode, and a tappable call link, when the person chooses to join by phone", async () => {
    dialIn.mockResolvedValue({ ok: true, dialIn: { numbers: [{ country: "NG", number: "+234 1 888 0000", city: "Lagos", kind: "toll" }, { country: "NG", number: "+234 700 000 0000", city: null, kind: "toll_free" }], meetingId: "81000000001", passcode: "482913", expiresAtMs: 0 } });
    render(<ConsultationRoom view={base} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Join by phone call instead" }));
    const box = await screen.findByTestId("dial-in");
    expect(box.textContent).toContain("81000000001");
    expect(box.textContent).toContain("482913");
    expect(box.textContent).toContain("+234 700 000 0000");
    expect(screen.getByRole("link", { name: "+234 1 888 0000" }).getAttribute("href")).toBe("tel:+23418880000");
  });

  it("leaves out the passcode step when the room needs none", async () => {
    dialIn.mockResolvedValue({ ok: true, dialIn: { numbers: [{ country: "NG", number: "+234 1 888 0000", city: null, kind: "toll" }], meetingId: "81000000001", passcode: null, expiresAtMs: 0 } });
    render(<ConsultationRoom view={base} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Join by phone call instead" }));
    expect((await screen.findByTestId("dial-in")).textContent).not.toContain("passcode");
  });

  it("says so, kindly, when there is no phone number, it is too early, or it fails", async () => {
    dialIn.mockResolvedValueOnce({ ok: false, reason: "phone_unavailable" });
    render(<ConsultationRoom view={base} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Join by phone call instead" }));
    expect((await screen.findByRole("alert")).textContent).toContain("could not find a phone number");
    dialIn.mockResolvedValueOnce({ ok: false, reason: "not_open" });
    fireEvent.click(screen.getByRole("button", { name: "Join by phone call instead" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("You can dial in then"));
    dialIn.mockResolvedValueOnce({ ok: false, reason: "not_allowed" });
    fireEvent.click(screen.getByRole("button", { name: "Join by phone call instead" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not open the room"));
  });

  it("does not offer the phone before the room opens", () => {
    render(<ConsultationRoom view={{ ...base, joinable: false }} locale="en" />);
    expect((screen.getByRole("button", { name: "Join by phone call instead" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows no link before anyone has joined", () => {
    render(<ConsultationRoom view={base} locale="en" />);
    expect(screen.queryByRole("link", { name: "Open the call" })).toBeNull();
  });

  it("says so when a scribe consent answer could not be saved, instead of looking saved", async () => {
    scribe.mockResolvedValue({ ok: false });
    render(<ConsultationRoom view={base} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect((await screen.findByRole("alert")).textContent).toContain("We could not save that");
  });

  it("says so when a no-show report is refused for a reason other than waiting", async () => {
    noShow.mockResolvedValue({ ok: false, reason: "not_allowed" });
    render(<ConsultationRoom view={{ ...base, can_report_clinician_absent: true }} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Tell us nobody came" }));
    expect((await screen.findByRole("alert")).textContent).toContain("We could not save that");
  });

  it("asks the patient to wait when it is too early to report", async () => {
    noShow.mockResolvedValue({ ok: false, reason: "wait_longer" });
    render(<ConsultationRoom view={{ ...base, can_report_clinician_absent: true }} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Tell us nobody came" }));
    expect((await screen.findByRole("alert")).textContent).toContain("wait a little longer");
  });

  it("speaks to the clinician as a clinician: waits for the patient, not 'your care team'", () => {
    render(<ConsultationRoom view={{ ...base, role: "clinician" }} locale="en" />);
    expect(screen.getByText("Waiting for the patient to join.")).toBeTruthy();
    expect(screen.queryByText(/your care team/i)).toBeNull();
    expect(screen.getByText(/admit them/)).toBeTruthy();
    // the patient's consent card is not the clinician's to answer
    expect(screen.queryByRole("button", { name: "No thanks" })).toBeNull();
  });

  it("tells the clinician what finishing does to their access, and shows an error if finishing fails", async () => {
    finish.mockResolvedValue({ ok: false });
    render(<ConsultationRoom view={{ ...base, role: "clinician", status: "in_progress", patient_joined: true, clinician_joined: true }} locale="en" />);
    expect(screen.getByText(/Write your note and prescribe before you finish/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish consultation" }));
    await waitFor(() => expect(finish).toHaveBeenCalled());
    expect((await screen.findByRole("alert")).textContent).toContain("We could not save that");
  });

  it("shows only the ended notice for a finished consultation", () => {
    render(<ConsultationRoom view={{ ...base, status: "completed" }} locale="en" />);
    expect(screen.getByText("This consultation has ended.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join with video" })).toBeNull();
  });
});
