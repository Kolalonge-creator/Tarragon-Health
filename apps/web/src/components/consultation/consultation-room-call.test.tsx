/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConsultationRoom, type RoomView } from "./consultation-room";
import type { CallPolicy } from "@/lib/consultations/call-controller";
import type { ZoomEmbeddedClient, ZoomEmbeddedGlobal } from "@/lib/consultations/zoom-sdk";
import { pageActions } from "./use-in-app-call";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: jest.fn(), replace: jest.fn() }) }));

const join = jest.fn();
const prepare = jest.fn();
const report = jest.fn();
const dialIn = jest.fn();
jest.mock("@/lib/consultations/actions", () => ({
  joinConsultationAction: (...a: unknown[]) => join(...a),
  prepareSdkJoinAction: (...a: unknown[]) => prepare(...a),
  reportCallEventAction: (...a: unknown[]) => report(...a),
  requestDialInAction: (...a: unknown[]) => dialIn(...a),
  answerScribeConsentAction: jest.fn(),
  reportNoShowAction: jest.fn(),
  completeConsultationAction: jest.fn(),
}));

const loadSdk = jest.fn();
jest.mock("@/lib/consultations/zoom-sdk", () => ({ loadZoomEmbedded: (...a: unknown[]) => loadSdk(...a) }));

const view: RoomView = {
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
  reconnect_grace_seconds: 1,
};
const policy: CallPolicy = { poorSamplesToDowngrade: 3, goodSamplesToOfferVideo: 6, poorBelowKbps: 100, reconnectGraceSeconds: 1, poorAudioLossPercent: 10, poorAudioRttMs: 600, sampleIntervalSeconds: 3 };
const joinInfo = { meetingNumber: "81000000001", signature: "sig.jwt.value", password: "pw1", zak: null, customerKey: "pabc", displayLabel: "patient", role: "patient", mediaMode: "video", recordedAtIssue: false };

type Handler = (p: unknown) => void;
function fakeSdk(over: Partial<ZoomEmbeddedClient> = {}) {
  const handlers = new Map<string, Handler>();
  const client: ZoomEmbeddedClient = {
    init: jest.fn(async () => undefined),
    join: jest.fn(async () => undefined),
    on: (e, cb) => void handlers.set(e, cb),
    off: (e) => void handlers.delete(e),
    subscribeStatisticData: jest.fn(async () => undefined),
    unSubscribeStatisticData: jest.fn(async () => undefined),
    getCurrentUser: () => ({ userId: 1 }),
    leaveMeeting: jest.fn(async () => undefined),
    endMeeting: jest.fn(async () => undefined),
    checkSystemRequirements: () => ({ audio: true, video: true, screen: true }),
    ...over,
  };
  const sdk: ZoomEmbeddedGlobal = { VERSION: "6.5.0", createClient: () => client, destroyClient: jest.fn() };
  return { client, sdk, emit: (e: string, p: unknown) => handlers.get(e)?.(p) };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.open = jest.fn(() => null);
  report.mockResolvedValue({ ok: true });
});

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("a client-side navigation into the room", () => {
  // jsdom has no navigation timing, so the document's own navigation entry is supplied by the test
  const entry = (name: string) => Object.defineProperty(performance, "getEntriesByType", { value: () => [{ name }], configurable: true, writable: true });
  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(performance, "getEntriesByType");
  });

  it("reloads once, because the wider Content-Security-Policy belongs to the document and the old page's was strict", () => {
    const reload = jest.spyOn(pageActions, "reload").mockImplementation(() => undefined);
    entry(`${window.location.origin}/patient/care`);
    render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when the document was loaded at this page, or when the in-app call is not on", () => {
    const reload = jest.spyOn(pageActions, "reload").mockImplementation(() => undefined);
    entry(`${window.location.origin}${window.location.pathname}`);
    render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
    entry(`${window.location.origin}/patient/care`);
    render(<ConsultationRoom view={view} locale="en" />);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("ConsultationRoom with the in-app call", () => {
  it("joins inside the page with the role word as the label and the server's key, and never opens the link", async () => {
    const f = fakeSdk();
    loadSdk.mockResolvedValue(f.sdk);
    prepare.mockResolvedValue({ ok: true, join: joinInfo });
    render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
    click("Join with video");
    await waitFor(() => expect(f.client.join).toHaveBeenCalled());
    expect(f.client.init).toHaveBeenCalledWith(expect.objectContaining({ language: "en-US" }));
    const args = (f.client.join as jest.Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({ signature: "sig.jwt.value", meetingNumber: "81000000001", userName: "patient", customerKey: "pabc", password: "pw1" });
    expect(args).not.toHaveProperty("zak");
    expect(join).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(await screen.findByText(/camera button/i)).toBeTruthy();
    expect(screen.getByTestId("call-root").classList.contains("hidden")).toBe(false);
    // a second tap on join cannot tear down the call that is already live
    expect((screen.getByRole("button", { name: "Join with video" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Join with audio only" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hands the clinician's host key to the SDK, and only when there is one", async () => {
    const f = fakeSdk();
    loadSdk.mockResolvedValue(f.sdk);
    prepare.mockResolvedValue({ ok: true, join: { ...joinInfo, role: "clinician", displayLabel: "clinician", zak: "hostkey", password: null } });
    render(<ConsultationRoom view={{ ...view, role: "clinician" }} locale="en" call={{ policy }} />);
    click("Join with video");
    await waitFor(() => expect(f.client.join).toHaveBeenCalled());
    const args = (f.client.join as jest.Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({ userName: "clinician", zak: "hostkey" });
    expect(args).not.toHaveProperty("password");
  });

  describe("every failure falls back to the person's own link, so the room still works", () => {
    const linkWorks = () => join.mockResolvedValue({ ok: true, url: "https://zoom.example/j/1", mediaMode: "video", audioOnlyEnforced: false, recorded: true });

    async function expectLink() {
      expect(await screen.findByRole("link", { name: "Open the call" })).toBeTruthy();
      expect(join).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/could not open the call inside the app/i)).toBeTruthy();
    }

    it("when the server will not give an in-app join (keys not set, Zoom refused)", async () => {
      linkWorks();
      prepare.mockResolvedValue({ ok: false, reason: "not_configured" });
      render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await expectLink();
      expect(loadSdk).not.toHaveBeenCalled();
    });

    it("when the SDK script cannot be loaded", async () => {
      linkWorks();
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      loadSdk.mockResolvedValue(null);
      render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await expectLink();
      expect(screen.getByTestId("call-root").classList.contains("hidden")).toBe(true);
    });

    it("when the browser cannot do voice over the web", async () => {
      linkWorks();
      const f = fakeSdk({ checkSystemRequirements: () => ({ audio: false, video: false, screen: false }) });
      loadSdk.mockResolvedValue(f.sdk);
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await expectLink();
      expect(f.client.join).not.toHaveBeenCalled();
      expect(f.sdk.destroyClient).toHaveBeenCalled();
    });

    it("when Zoom refuses the join (a bad signature, a closed room, no host key)", async () => {
      linkWorks();
      const f = fakeSdk({ join: jest.fn(async () => Promise.reject({ errorCode: 3000 })) });
      loadSdk.mockResolvedValue(f.sdk);
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await expectLink();
      expect(f.sdk.destroyClient).toHaveBeenCalled();
    });

    it("when the SDK throws while it is being created", async () => {
      linkWorks();
      loadSdk.mockResolvedValue({ VERSION: "6.5.0", createClient: () => { throw new Error("boom"); }, destroyClient: jest.fn() });
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await expectLink();
    });
  });

  it("says when the room opens and does not open the link when it is too early", async () => {
    prepare.mockResolvedValue({ ok: false, reason: "not_open", opensAt: "2026-10-07T08:45:00Z" });
    render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
    click("Join with video");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(join).not.toHaveBeenCalled();
  });

  it("is untouched when the in-app call is not on: the link flow runs and the SDK is never asked for", async () => {
    join.mockResolvedValue({ ok: true, url: "https://zoom.example/j/1", mediaMode: "video", audioOnlyEnforced: false, recorded: true });
    render(<ConsultationRoom view={view} locale="en" />);
    click("Join with video");
    await screen.findByRole("link", { name: "Open the call" });
    expect(prepare).not.toHaveBeenCalled();
    expect(loadSdk).not.toHaveBeenCalled();
    expect(screen.queryByTestId("call-root")).toBeNull();
  });

  describe("once in the call", () => {
    async function joined(f = fakeSdk()) {
      loadSdk.mockResolvedValue(f.sdk);
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      const rendered = render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      // the Leave button is there while Zoom is still opening; the camera hint appears only once the person is in the call
      await screen.findByText(/camera button/i);
      return Object.assign(f, { unmount: rendered.unmount });
    }

    it("holds the place when the connection drops, and says so when it returns", async () => {
      const f = await joined();
      act(() => f.emit("connection-change", { state: "Reconnecting" }));
      expect((await screen.findByTestId("call-notice")).textContent).toContain("holding your place for 1 seconds");
      expect(report).toHaveBeenCalledWith(view.encounter_id, { kind: "reconnect_grace_started" });
      act(() => f.emit("connection-change", { state: "Connected" }));
      expect((await screen.findByTestId("call-notice")).textContent).toContain("You are back");
    });

    it("moves to the phone by itself when the connection does not come back, showing the numbers, meeting id and passcode", async () => {
      jest.useFakeTimers();
      try {
        dialIn.mockResolvedValue({ ok: true, dialIn: { numbers: [{ country: "NG", number: "+234 1 888 0000", city: "Lagos", kind: "toll" }], meetingId: "81000000001", passcode: "482913", expiresAtMs: 0 } });
        const f = await joined();
        act(() => f.emit("connection-change", { state: "Reconnecting" }));
        await act(async () => {
          jest.advanceTimersByTime(1100);
        });
        const box = await screen.findByTestId("dial-in");
        expect(box.textContent).toContain("81000000001");
        expect(box.textContent).toContain("482913");
        expect(dialIn).toHaveBeenCalledWith(view.encounter_id);
        expect(screen.getByTestId("call-notice").textContent).toContain("join by phone");
        // the web call is left, so the person is not in the room twice (web and phone) if the connection recovers
        expect(f.client.leaveMeeting).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("moves to audio only after a sustained poor link, tells the person, and records it", async () => {
      jest.useFakeTimers();
      try {
        const f = await joined();
        for (let i = 0; i < 3; i++) {
          await act(async () => {
            jest.advanceTimersByTime(3100);
          });
          act(() => f.emit("audio-statistic-data-change", { data: { avg_loss: 50, rtt: 10, encoding: true } }));
        }
        expect((await screen.findByTestId("call-notice")).textContent).toContain("audio only");
        expect(report).toHaveBeenCalledWith(view.encounter_id, { kind: "mode_changed", mode: "audio_only" });
      } finally {
        jest.useRealTimers();
      }
    });

    it("leaving ends the SDK session and hides the call", async () => {
      const f = await joined();
      click("Leave the call");
      await waitFor(() => expect(f.client.leaveMeeting).toHaveBeenCalled());
      await waitFor(() => expect(f.sdk.destroyClient).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole("button", { name: "Leave the call" })).toBeNull());
    });

    it("when the call is closed from the other end the call box goes away", async () => {
      const f = await joined();
      act(() => f.emit("connection-change", { state: "Closed" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Leave the call" })).toBeNull());
      expect(f.sdk.destroyClient).toHaveBeenCalled();
    });

    it("the phone card stays on screen when the call closes because the connection was lost for good", async () => {
      dialIn.mockResolvedValue({ ok: true, dialIn: { numbers: [{ country: "NG", number: "+234 1 888 0000", city: "Lagos", kind: "toll" }], meetingId: "81000000001", passcode: "482913", expiresAtMs: 0 } });
      const f = await joined();
      act(() => f.emit("connection-change", { state: "Reconnecting" }));
      act(() => f.emit("connection-change", { state: "Closed" }));
      expect((await screen.findByTestId("dial-in")).textContent).toContain("482913");
      await waitFor(() => expect(screen.queryByRole("button", { name: "Leave the call" })).toBeNull());
      expect(screen.getByTestId("call-notice").textContent).toContain("join by phone");
    });

    it("Leave works while Zoom is still opening (a join that hangs, or waits for the host): it leaves again, and does not open the link", async () => {
      let release: () => void = () => undefined;
      const f = fakeSdk({ join: jest.fn(() => new Promise<unknown>((resolve) => (release = () => resolve(undefined)))) });
      loadSdk.mockResolvedValue(f.sdk);
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await waitFor(() => expect(f.client.join).toHaveBeenCalled());
      click("Leave the call");
      release();
      await waitFor(() => expect(f.client.leaveMeeting).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole("button", { name: "Leave the call" })).toBeNull());
      expect(join).not.toHaveBeenCalled();
      expect(window.open).not.toHaveBeenCalled();
      // and the person can try again afterwards
      await waitFor(() => expect((screen.getByRole("button", { name: "Join with video" }) as HTMLButtonElement).disabled).toBe(false));
    });

    it("leaves the call when the consultation stops being live under it (cancelled, completed, no-show)", async () => {
      const f = fakeSdk();
      loadSdk.mockResolvedValue(f.sdk);
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      const { rerender } = render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await screen.findByText(/camera button/i);
      rerender(<ConsultationRoom view={{ ...view, status: "completed" }} locale="en" call={{ policy }} />);
      await waitFor(() => expect(f.client.leaveMeeting).toHaveBeenCalled());
      expect(f.sdk.destroyClient).toHaveBeenCalled();
    });

    it("Leave pressed while opening is honoured even when the SDK then fails: the link is not opened for someone who chose not to join", async () => {
      let fail: (e: unknown) => void = () => undefined;
      const f = fakeSdk({ join: jest.fn(() => new Promise<unknown>((_, reject) => (fail = reject))) });
      loadSdk.mockResolvedValue(f.sdk);
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await waitFor(() => expect(f.client.join).toHaveBeenCalled());
      click("Leave the call");
      fail({ errorCode: 3000 });
      await waitFor(() => expect(screen.queryByRole("button", { name: "Leave the call" })).toBeNull());
      expect(join).not.toHaveBeenCalled();
    });

    it("Leave then Join again during a hung join: the old attempt's late failure cannot destroy the new one or open a link", async () => {
      const hung: ((e: unknown) => void)[] = [];
      const first = fakeSdk({ join: jest.fn(() => new Promise<unknown>((_, reject) => hung.push(reject))) });
      const second = fakeSdk();
      loadSdk.mockResolvedValueOnce(first.sdk).mockResolvedValueOnce(second.sdk);
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await waitFor(() => expect(first.client.join).toHaveBeenCalled());
      click("Leave the call");
      await waitFor(() => expect(first.client.leaveMeeting).toHaveBeenCalled());
      await waitFor(() => expect((screen.getByRole("button", { name: "Join with video" }) as HTMLButtonElement).disabled).toBe(false));
      click("Join with video");
      await screen.findByText(/camera button/i);
      expect(second.client.join).toHaveBeenCalled();
      // the first attempt now fails late: it must not touch the second one, and must not open the link
      hung.forEach((reject) => reject({ errorCode: 3000 }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(second.sdk.destroyClient).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Leave the call" })).toBeTruthy();
      expect(join).not.toHaveBeenCalled();
    });

    it("does not touch Zoom at all when Leave is pressed while the script is still loading", async () => {
      let loaded: (g: ZoomEmbeddedGlobal) => void = () => undefined;
      const f = fakeSdk();
      loadSdk.mockReturnValue(new Promise<ZoomEmbeddedGlobal>((resolve) => (loaded = resolve)));
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await screen.findByRole("button", { name: "Leave the call" });
      click("Leave the call");
      loaded(f.sdk);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(f.client.init).not.toHaveBeenCalled();
      expect(f.client.join).not.toHaveBeenCalled();
      expect(join).not.toHaveBeenCalled();
    });

    it("Leave does not wait for a leave that never settles", async () => {
      const f = fakeSdk({ join: jest.fn(() => new Promise<unknown>(() => undefined)), leaveMeeting: jest.fn(() => new Promise<unknown>(() => undefined)) });
      loadSdk.mockResolvedValue(f.sdk);
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await waitFor(() => expect(f.client.join).toHaveBeenCalled());
      click("Leave the call");
      // the page is usable again at once; the stuck leave is abandoned after its patience runs out
      await waitFor(() => expect((screen.getByRole("button", { name: "Join with video" }) as HTMLButtonElement).disabled).toBe(false));
      await waitFor(() => expect(f.sdk.destroyClient).toHaveBeenCalled(), { timeout: 5000 });
    }, 10_000);

    it("leaves again at once if the page went away while Zoom was still joining, instead of staying in a call nobody can see", async () => {
      let release: () => void = () => undefined;
      const f = fakeSdk({ join: jest.fn(() => new Promise<unknown>((resolve) => (release = () => resolve(undefined)))) });
      loadSdk.mockResolvedValue(f.sdk);
      prepare.mockResolvedValue({ ok: true, join: joinInfo });
      const { unmount } = render(<ConsultationRoom view={view} locale="en" call={{ policy }} />);
      click("Join with video");
      await waitFor(() => expect(f.client.join).toHaveBeenCalled());
      unmount();
      release();
      await waitFor(() => expect(f.client.leaveMeeting).toHaveBeenCalled());
      expect(f.sdk.destroyClient).toHaveBeenCalled();
    });

    it("leaves the SDK session when the page goes away", async () => {
      const f = await joined();
      f.unmount();
      await waitFor(() => expect(f.client.leaveMeeting).toHaveBeenCalled());
      expect(f.sdk.destroyClient).toHaveBeenCalled();
    });
  });
});
