"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { MediaMode } from "@tarragon/integrations/client";
import { prepareSdkJoinAction, reportCallEventAction } from "@/lib/consultations/actions";
import { CallController, type CallNotice, type CallPolicy } from "@/lib/consultations/call-controller";
import { loadZoomEmbedded, type ZoomEmbeddedClient, type ZoomEmbeddedGlobal } from "@/lib/consultations/zoom-sdk";

/**
 * The in-app Zoom call for the consultation room (S21 follow-up, OQ-136). `start` answers one of:
 *  - "started": the person is in the call, shown inside the page
 *  - "not_open": the join window is closed (the page says when it opens)
 *  - "busy": a call is already live or opening (the page does nothing)
 *  - "cancelled": the person pressed Leave (or left the page) while it was still opening; the page does nothing, they chose not to join
 *  - "fallback": the in-app call could not be used for ANY reason (keys not set, the SDK would not load, the browser is not supported,
 *    Zoom refused the join). The caller then opens the person's link exactly as before, so a failure here never leaves anyone without
 *    a way into the call. The reason is only ever a code, never a message from Zoom.
 *
 * Every start is its own ATTEMPT, an object that carries its own cancelled flag and its own client. Leave, a close, the phone handover
 * and leaving the page all act on the attempt they belong to, so a person who presses Leave and then Join again can never have the old
 * attempt's late failure destroy the new one, open a link, or free a guard that is not theirs.
 */
export type StartResult = "started" | "not_open" | "fallback" | "busy" | "cancelled";
export type CallState = "idle" | "joining" | "in_call";

export interface InAppCallOptions {
  readonly encounterId: string;
  readonly role: "patient" | "clinician";
  readonly policy: CallPolicy | null;
  readonly initialMode: MediaMode | null;
  /** The ladder reached the phone: show the dial-in card. */
  readonly onPhone: () => void;
}

const LANGUAGE = "en-US";
/** Leaving a call that never joined can itself hang; cleanup stops waiting for it after this long and carries on. */
const LEAVE_PATIENCE_MS = 3000;

/** The one place the page reloads itself, so a test can watch it (jsdom will not let a test replace location.reload). */
export const pageActions = { reload: () => window.location.reload() };

interface Attempt {
  cancelled: boolean;
  /** Rejects when the attempt is cancelled, so a wait on Zoom (which may never settle) can be abandoned at once. */
  readonly aborted: Promise<never>;
  abort: () => void;
  sdk: ZoomEmbeddedGlobal | null;
  client: ZoomEmbeddedClient | null;
  controller: CallController | null;
}

function newAttempt(): Attempt {
  let abort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("abandoned"));
  });
  // Rejecting with nobody racing it is normal (an attempt that finished), so it must not surface as an unhandled rejection.
  aborted.catch(() => undefined);
  return { cancelled: false, aborted, abort, sdk: null, client: null, controller: null };
}

/** Leaves the call and destroys the SDK's client for ONE attempt. Never throws and never waits longer than LEAVE_PATIENCE_MS. */
async function cleanup(a: Attempt): Promise<void> {
  a.cancelled = true;
  a.abort();
  a.controller?.stop();
  if (a.client) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, LEAVE_PATIENCE_MS);
    });
    try {
      await Promise.race([a.client.leaveMeeting().then(() => undefined, () => undefined), patience]);
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    a.sdk?.destroyClient();
  } catch {
    // nothing left to destroy
  }
}

/** `rootRef` is the box Zoom draws its call into; the page owns it so it can render it. */
export function useInAppCall(rootRef: RefObject<HTMLDivElement | null>, options: InAppCallOptions) {
  const [state, setState] = useState<CallState>("idle");
  const [notice, setNotice] = useState<CallNotice | null>(null);
  const current = useRef<Attempt | null>(null);
  // Zoom's client is one per page: a new attempt waits for the previous attempt's cleanup before it creates its own.
  const closing = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  /** Ends an attempt (if it is still the current one, the page goes back to idle). */
  const end = useCallback((a: Attempt, then?: () => void) => {
    const done = cleanup(a);
    if (current.current === a) {
      current.current = null;
      closing.current = done;
      void done.then(() => {
        if (closing.current === done) closing.current = null;
      });
      if (mounted.current) {
        setState("idle");
        then?.();
      }
    }
    return done;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // The page goes away: leave whatever is open or opening, so nobody stays in a call that nothing is showing.
      mounted.current = false;
      const a = current.current;
      if (a) void end(a);
    };
  }, [end]);

  // The wider Content-Security-Policy for the call is a header on the consultation routes, and a policy belongs to the DOCUMENT. A
  // person who got here by a client-side navigation (a Next link or router.push) is still in the document of the page they came from,
  // with the strict policy, so Zoom's script would be blocked. One full load fixes that, whatever the entry point; it cannot loop,
  // because after the reload the document's own URL is this page.
  useEffect(() => {
    if (!options.policy) return;
    const nav = typeof performance !== "undefined" ? performance.getEntriesByType?.("navigation")[0] : undefined;
    if (nav && new URL(nav.name).pathname !== window.location.pathname) pageActions.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided once, on arrival
  }, []);

  const run = useCallback(
    async (a: Attempt, media: "video" | "audio_only"): Promise<StartResult> => {
      const { encounterId, role, policy, initialMode, onPhone } = opts.current;
      if (!policy) return "fallback";
      // After every wait, the person may have pressed Leave or left the page. That is "do not join", never "use the link".
      const abandoned = () => a.cancelled || !mounted.current;
      // Every wait on something that may never settle (Zoom, the script, the server) is raced against Leave, so Leave always lands.
      const gate = <T,>(p: Promise<T>): Promise<T> => Promise.race([p, a.aborted]);
      try {
        if (closing.current) await gate(closing.current);
        const prepared = await gate(prepareSdkJoinAction(encounterId, media));
        // a stale notice (for example the phone card from an earlier drop) must not linger once the person tries again
        setNotice(null);
        if (abandoned()) return "cancelled";
        if (!prepared.ok) return prepared.reason === "not_open" ? "not_open" : "fallback";
        const root = rootRef.current;
        if (!root) return "fallback";

        // Zoom measures the box it draws into, so the box must be visible in the page before init runs.
        flushSync(() => setState("joining"));
        const sdk = await gate(loadZoomEmbedded());
        if (!sdk) return abandoned() ? "cancelled" : "fallback";
        // Leave was pressed while the script loaded: do not touch Zoom at all.
        if (abandoned()) return "cancelled";
        a.sdk = sdk;
        const client = sdk.createClient();
        a.client = client;
        // A browser that cannot do voice over the web cannot use the in-app call; the link (or the phone) still can.
        if (!client.checkSystemRequirements().audio) throw new Error("unsupported browser");
        await gate(client.init({ zoomAppRoot: root, language: LANGUAGE, patchJsMedia: true, leaveOnPageUnload: true }));
        const join = prepared.join;
        // The role word is the display label, never a name. The customer key is the opaque value the server verifies on Zoom's webhook.
        await gate(
          client.join({
            signature: join.signature,
            meetingNumber: join.meetingNumber,
            userName: join.displayLabel,
            customerKey: join.customerKey,
            ...(join.password ? { password: join.password } : {}),
            ...(join.zak ? { zak: join.zak } : {}),
          }),
        );
        if (abandoned()) throw new Error("abandoned");
        const controller = new CallController({
          client,
          policy,
          role,
          initialMode: initialMode ?? "video",
          now: () => Date.now(),
          report: (r) => reportCallEventAction(encounterId, r),
          onNotice: setNotice,
          onClosed: () => {
            // a phone notice raised by this very close stays on screen: it is how the person is told what to do next
            void end(a, () => setNotice((n) => (n === "phone" ? n : null)));
          },
          onPhone: () => {
            // The connection did not come back in time. Leave the web call so the person is not in the room twice (web and phone)
            // when it recovers, then show the dial-in card.
            void end(a);
            onPhone();
          },
        });
        a.controller = controller;
        controller.start();
        setNotice(null);
        setState("in_call");
        return "started";
      } catch {
        // Anything the SDK refuses (a bad signature, a closed room, a missing host key), or a Leave that arrived while it was joining,
        // ends here. The attempt is cleaned up; the link takes over only if nobody chose to leave.
        const wasAbandoned = abandoned();
        void end(a);
        return wasAbandoned ? "cancelled" : "fallback";
      }
    },
    [rootRef, end],
  );

  const start = useCallback(
    async (media: "video" | "audio_only"): Promise<StartResult> => {
      // Already in a call, or opening one: a second start would tear the first down (Zoom's client is one per page).
      if (current.current) return "busy";
      const a = newAttempt();
      current.current = a;
      try {
        return await run(a, media);
      } finally {
        // An attempt that did not end up in a call frees the guard; one that is live keeps it until it ends.
        if (current.current === a && !a.controller) {
          current.current = null;
          if (mounted.current) setState("idle");
        }
      }
    },
    [run],
  );

  const leave = useCallback(async () => {
    const a = current.current;
    if (!a) return;
    // Cancels this attempt wherever it is (loading, joining or live) and frees the guard at once, so Join works again immediately;
    // the next start waits for this attempt's cleanup before it creates its own Zoom client.
    await end(a, () => setNotice(null));
  }, [end]);

  const takeVideo = useCallback(() => {
    current.current?.controller?.patientTakesVideo();
  }, []);

  return { state, notice, start, leave, takeVideo };
}
