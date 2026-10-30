import { AUTO_FLUSH_SECONDS, VisibleTimer, type TimeEntryInput } from "./time-capture";

/**
 * W-01: ties a VisibleTimer to one work surface (a task page, or one message thread) and decides when to send. Kept free of React so the
 * ordering rules are tested: the final send goes by beacon (it survives the page closing), a submit sends BEFORE the form's own handler
 * runs (capture phase), and a repeat of the same entry carries the same client key so the database stores it once.
 */
export interface TimeSink {
  /** Fire-and-forget send that survives unload (navigator.sendBeacon). Returns false if the browser refused it. */
  beacon(entry: TimeEntryInput): boolean;
  /** Ordinary send (server action), used while the page stays open. */
  action(entry: TimeEntryInput): Promise<unknown>;
}

export interface ControllerInit {
  source: "task" | "message";
  sourceRef: string;
  patientId: string;
  now: () => number;
  sink: TimeSink;
  newKey: () => string;
  /** Visible tab and this surface in focus. */
  active: boolean;
}

export function createTimeCaptureController(init: ControllerInit) {
  const timer = new VisibleTimer(init.now(), init.active);
  // seconds the beacon was refused for are kept and retried with the next send, under the same key
  let pending: { key: string; seconds: number } | null = null;

  function send(via: "beacon" | "action"): void {
    const now = init.now();
    const fresh = timer.take(now);
    if (fresh === 0 && pending === null) return;
    const entry: TimeEntryInput = pending
      ? { source: init.source, sourceRef: init.sourceRef, patientId: init.patientId, seconds: pending.seconds + fresh, clientKey: pending.key }
      : { source: init.source, sourceRef: init.sourceRef, patientId: init.patientId, seconds: fresh, clientKey: init.newKey() };
    pending = { key: entry.clientKey, seconds: entry.seconds };
    const done = () => {
      if (pending && pending.key === entry.clientKey) pending = null;
    };
    if (via === "beacon") {
      if (init.sink.beacon(entry)) done();
      return;
    }
    void init.sink
      .action(entry)
      .then(done)
      .catch(() => undefined);
  }

  return {
    setActive(active: boolean): void {
      timer.setVisible(active, init.now());
      if (!active) send("beacon");
    },
    input(): void {
      timer.input(init.now());
    },
    /** Called every so often: sends once enough has built up. */
    tick(): void {
      if (timer.seconds(init.now()) >= AUTO_FLUSH_SECONDS) send("action");
    },
    /** The form is being submitted: send first. */
    beforeSubmit(): void {
      send("beacon");
    },
    /** The page is being left or the surface closed. */
    finish(): void {
      timer.setVisible(false, init.now());
      send("beacon");
    },
    seconds(): number {
      return timer.seconds(init.now());
    },
  };
}

export type TimeCaptureController = ReturnType<typeof createTimeCaptureController>;

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "scroll", "wheel", "touchstart"] as const;

/** Wires a controller to the page. Returns the function that removes every listener. */
export function attachTimeCapture(doc: Document, win: Window, c: TimeCaptureController, isSurfaceActive: () => boolean): () => void {
  const sync = () => c.setActive(doc.visibilityState === "visible" && isSurfaceActive());
  const onInput = () => c.input();
  const onSubmit = () => c.beforeSubmit();
  const onHide = () => c.finish();
  const every = win.setInterval(() => c.tick(), 30000);
  doc.addEventListener("visibilitychange", sync);
  doc.addEventListener("submit", onSubmit, true);
  win.addEventListener("pagehide", onHide);
  for (const ev of INPUT_EVENTS) doc.addEventListener(ev, onInput, { capture: true, passive: true });
  return () => {
    win.clearInterval(every);
    doc.removeEventListener("visibilitychange", sync);
    doc.removeEventListener("submit", onSubmit, true);
    win.removeEventListener("pagehide", onHide);
    for (const ev of INPUT_EVENTS) doc.removeEventListener(ev, onInput, true);
  };
}
