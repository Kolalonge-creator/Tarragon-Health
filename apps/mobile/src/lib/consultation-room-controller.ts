import type { MessageKey } from "@tarragon/i18n";
import {
  ROOM_POLL_MS,
  pollDelayMs,
  isLive,
  type DialInInfo,
  type DialInResponse,
  type JoinResponse,
  type RequestedMedia,
  type RoomView,
} from "./consultation-room-model";
import type { ConsultationCallResult } from "./api";
import type { LoadResult, NoShowResult } from "./consultations";

/**
 * S21 follow-up (OQ-158): the state machine behind the patient's consultation room on the phone. Plain TypeScript with every
 * outside effect injected as a port, so it is proved in Jest with the network mocked (this app's Jest setup has no component
 * renderer). The screen only subscribes to it and draws the state. NOT run on a real phone: no EAS dev-client build exists yet.
 *
 * Rules it keeps:
 *  - A join link, a dial-in number and a passcode live only in the function that opened them (the link) or in `dialIn` state for
 *    the screen's lifetime (the numbers). Nothing is stored, logged or put in a note.
 *  - A failed save never looks saved: the scribe answer is shown as saved only after both database calls succeeded.
 *  - It never refreshes faster than every ROOM_POLL_MS, never overlaps two refreshes, and stops while the app is in the background
 *    or the consultation has ended.
 *  - When the server cannot be reached the last view stays on screen with an "offline, your place is safe" flag, and it keeps
 *    trying at a slower pace.
 */
export type RoomNote =
  | { kind: "link_error" }
  | { kind: "not_open" }
  | { kind: "wait_longer" }
  | { kind: "save_error" }
  | { kind: "phone_unavailable" }
  | { kind: "phone_not_open" };

/** The words for each note. Every one says the patient's place is safe or what to do next, never a vendor message or a code. */
export function noteMessageKey(note: RoomNote): MessageKey {
  switch (note.kind) {
    case "link_error":
      return "consult.room.link_error";
    case "not_open":
      return "consult.room.not_open";
    case "wait_longer":
      return "consult.room.wait_longer";
    case "save_error":
      return "consult.room.save_error";
    case "phone_unavailable":
      return "consult.room.phone_unavailable";
    case "phone_not_open":
      return "consult.room.phone_not_open";
  }
}

export interface RoomState {
  /** True until the first load has answered. */
  loading: boolean;
  view: RoomView | null;
  /** The server answered, and this consultation is not this patient's (or does not exist). */
  notFound: boolean;
  /** The last refresh did not get an answer. `view` may be stale, or null if nothing has loaded yet. */
  offline: boolean;
  busy: boolean;
  note: RoomNote | null;
  /** True after joining audio only, so the screen can remind the patient to turn the camera off. */
  audioHint: boolean;
  dialIn: DialInInfo | null;
}

export interface RoomPorts {
  loadRoom: (encounterId: string) => Promise<LoadResult<RoomView | null>>;
  join: (encounterId: string, media: RequestedMedia) => Promise<ConsultationCallResult<JoinResponse>>;
  dialIn: (encounterId: string) => Promise<ConsultationCallResult<DialInResponse>>;
  answerScribe: (encounterId: string, granted: boolean, alreadyAsked: boolean) => Promise<boolean>;
  reportNobodyCame: (encounterId: string) => Promise<NoShowResult>;
  /** Hands the link to the Zoom app (Linking.openURL). May reject. */
  openUrl: (url: string) => Promise<unknown>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const INITIAL: RoomState = { loading: true, view: null, notFound: false, offline: false, busy: false, note: null, audioHint: false, dialIn: null };

export class RoomController {
  private state: RoomState = INITIAL;
  private readonly listeners = new Set<(s: RoomState) => void>();
  private timer: unknown = null;
  private started = false;
  private foreground = true;
  private refreshing: Promise<void> | null = null;
  /** Identifies the load that currently owns `refreshing`. */
  private token: object | null = null;

  constructor(
    private readonly encounterId: string,
    private readonly ports: RoomPorts,
  ) {}

  getState = (): RoomState => this.state;

  subscribe = (listener: (s: RoomState) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<RoomState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
  }

  stop(): void {
    this.started = false;
    this.cancelTimer();
  }

  /** Called when the app goes to the background and comes back. Nothing is polled while it is in the background. */
  setForeground(active: boolean): void {
    this.foreground = active;
    if (!active) {
      this.cancelTimer();
    } else if (this.started) {
      void this.refresh();
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) (this.ports.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>);
    this.timer = null;
  }

  private schedule(): void {
    this.cancelTimer();
    const view = this.state.view;
    // Nothing to poll for once the consultation has ended.
    if (!this.started || !this.foreground || (view && !isLive(view.status))) return;
    // Slower while we cannot reach the server, or while the answer is "not found" (which can be a session that has lapsed, or a
    // consultation not visible yet): each try costs data and battery, but it must keep trying so it recovers on its own.
    const delay = pollDelayMs(this.state.offline || this.state.notFound ? ROOM_POLL_MS * 2 : ROOM_POLL_MS);
    this.timer = (this.ports.setTimer ?? setTimeout)(() => {
      void this.refresh();
    }, delay);
  }

  /**
   * A load that starts AFTER the caller's own change was saved. A poll already in flight may have been answered before that change;
   * its answer is discarded (never applied, so the consent question cannot come back after it was answered, even if this fresh load
   * then fails) and one new load is started straight away, without waiting for the old one.
   */
  private refreshFresh(): Promise<void> {
    this.refreshing = null;
    this.token = null;
    return this.refresh();
  }

  /** One load of the room. Never overlaps another. */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const token = {};
    const run: Promise<void> = (async () => {
      try {
        // Always asynchronous from here, so the slot below is set before anything in this body can finish.
        await Promise.resolve();
        let res: Awaited<ReturnType<RoomPorts["loadRoom"]>>;
        try {
          res = await this.ports.loadRoom(this.encounterId);
        } catch {
          res = { ok: false };
        }
        // A change was saved while this load was out: what it brought back may pre-date that change.
        if (this.token !== token) return;
        if (!res.ok) {
          this.set({ loading: false, offline: true });
        } else if (res.data === null) {
          this.set({ loading: false, offline: false, notFound: true, view: null, dialIn: null, audioHint: false });
        } else {
          this.set({
            loading: false,
            offline: false,
            notFound: false,
            view: res.data,
            // The numbers belong to a live call. Once it has ended they are dropped.
            dialIn: isLive(res.data.status) ? this.state.dialIn : null,
          });
        }
      } finally {
        // Only the current load clears the slot and re-arms the timer; a superseded one leaves that to its replacement.
        if (this.token === token) {
          this.refreshing = null;
          this.schedule();
        }
      }
    })();
    this.token = token;
    this.refreshing = run;
    return run;
  }

  private async act(work: () => Promise<void>): Promise<void> {
    if (this.state.busy) return;
    this.set({ busy: true, note: null });
    try {
      await work();
    } finally {
      this.set({ busy: false });
    }
  }

  /** Asks the server for this patient's own link and hands it to the Zoom app. The link is never kept. */
  join(media: RequestedMedia): Promise<void> {
    return this.act(async () => {
      const res = await this.ports.join(this.encounterId, media);
      if (!res.ok) {
        this.set({ note: { kind: "link_error" }, offline: res.offline || this.state.offline });
        return;
      }
      const out = res.data;
      if (!out.ok) {
        if (out.reason === "not_open") this.set({ note: { kind: "not_open" } });
        else this.set({ note: { kind: "link_error" } });
        // "closed" or "not_found" means the room has moved on: show the true state.
        if (out.reason === "closed" || out.reason === "not_found") await this.refreshFresh();
        return;
      }
      try {
        await this.ports.openUrl(out.url);
      } catch {
        // The Zoom app could not be opened. Nothing about the link is kept or shown; the patient can simply try again.
        this.set({ note: { kind: "link_error" } });
        return;
      }
      this.set({ audioHint: out.mediaMode === "audio_only" });
      await this.refreshFresh();
    });
  }

  /** The last step of the ladder: the same call by an ordinary phone call. The numbers are kept in memory for this screen only. */
  phoneFallback(): Promise<void> {
    return this.act(async () => {
      const res = await this.ports.dialIn(this.encounterId);
      if (!res.ok) {
        // Only a server that says the vendor is not set up (503) says there is no phone number to give. No answer, an expired
        // session or a server hiccup keep the "your place is safe, try again" wording.
        this.set({ note: { kind: res.unavailable ? "phone_unavailable" : "link_error" }, offline: res.offline || this.state.offline });
        return;
      }
      const out = res.data;
      if (out.ok) {
        this.set({ dialIn: out.dialIn });
        await this.refreshFresh();
      } else {
        this.set({ note: { kind: out.reason === "not_open" ? "phone_not_open" : "phone_unavailable" } });
      }
    });
  }

  /** The patient's own answer to the AI note-taker question. Shown as saved only when the server confirmed it. */
  answerScribe(granted: boolean): Promise<void> {
    return this.act(async () => {
      // The question is only "opened" the first time; a later change (withdrawing) must not log a fresh "asked".
      const saved = await this.ports.answerScribe(this.encounterId, granted, this.state.view?.scribe.asked === true);
      if (!saved) {
        // A failed save must never look saved: the question stays on screen. A save that timed out may still have landed, so learn
        // the true state rather than guess.
        this.set({ note: { kind: "save_error" } });
        void this.refresh();
        return;
      }
      const view = this.state.view;
      if (view) this.set({ view: { ...view, scribe: { asked: true, granted } } });
      await this.refreshFresh();
    });
  }

  tellNobodyCame(): Promise<void> {
    return this.act(async () => {
      const res = await this.ports.reportNobodyCame(this.encounterId);
      if (res === "wait_longer") this.set({ note: { kind: "wait_longer" } });
      else if (res === "failed") {
        // A report that timed out may still have gone through: learn the true state rather than guess.
        this.set({ note: { kind: "save_error" } });
        void this.refresh();
      }
      else await this.refreshFresh();
    });
  }
}
