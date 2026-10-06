"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { MediaMode } from "@tarragon/integrations";
import { prepareSdkJoinAction, reportCallEventAction } from "@/lib/consultations/actions";
import { CallController, type CallNotice, type CallPolicy } from "@/lib/consultations/call-controller";
import { loadZoomEmbedded, type ZoomEmbeddedClient, type ZoomEmbeddedGlobal } from "@/lib/consultations/zoom-sdk";

/**
 * The in-app Zoom call for the consultation room (S21 follow-up, OQ-136). `start` answers one of:
 *  - "started": the person is in the call, shown inside the page
 *  - "not_open": the join window is closed (the page says when it opens)
 *  - "busy": a call is already live or opening (the page does nothing)
 *  - "cancelled": the person pressed Leave while it was still opening (the page does nothing; they chose not to join)
 *  - "fallback": the in-app call could not be used for ANY reason (keys not set, the SDK would not load, the browser is not supported,
 *    Zoom refused the join). The caller then opens the person's link exactly as before, so a failure here never leaves anyone without
 *    a way into the call. The reason is only ever a code, never a message from Zoom.
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

/** The one place the page reloads itself, so a test can watch it (jsdom will not let a test replace location.reload). */
export const pageActions = { reload: () => window.location.reload() };

/** `rootRef` is the box Zoom draws its call into; the page owns it so it can render it. */
export function useInAppCall(rootRef: RefObject<HTMLDivElement | null>, options: InAppCallOptions) {
  const [state, setState] = useState<CallState>("idle");
  const [notice, setNotice] = useState<CallNotice | null>(null);
  const live = useRef<{ sdk: ZoomEmbeddedGlobal; client: ZoomEmbeddedClient; controller: CallController } | null>(null);
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  const teardown = useCallback(async () => {
    const current = live.current;
    live.current = null;
    if (!current) return;
    current.controller.stop();
    try {
      await current.client.leaveMeeting();
    } catch {
      // already out of the call
    }
    try {
      current.sdk.destroyClient();
    } catch {
      // nothing left to destroy
    }
  }, []);

  // A start that is still loading or joining when the page goes away must not leave the person in a call nothing is showing.
  const mounted = useRef(true);
  const cancelled = useRef(false);
  // The client while it is still joining, so Leave can act on it at once instead of waiting for a join that may never settle.
  const opening = useRef<{ sdk: ZoomEmbeddedGlobal; client: ZoomEmbeddedClient } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void teardown();
    };
  }, [teardown]);

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
    async (media: "video" | "audio_only"): Promise<StartResult> => {
      const { encounterId, role, policy, initialMode, onPhone } = opts.current;
      if (!policy) return "fallback";
      cancelled.current = false;
      const prepared = await prepareSdkJoinAction(encounterId, media);
      // a stale notice (for example the phone card from an earlier drop) must not linger once the person tries again
      setNotice(null);
      if (!prepared.ok) return prepared.reason === "not_open" ? "not_open" : "fallback";
      const root = rootRef.current;
      if (!root) return "fallback";
      // Pressing Leave while the call is opening means "do not join": a failure after that must not open the link instead.
      // (Leaving the page counts the same: nobody is there to be shown a link.)
      const fallbackOrCancelled = (): StartResult => (cancelled.current || !mounted.current ? "cancelled" : "fallback");

      // Zoom measures the box it draws into, so the box must be visible in the page before init runs.
      flushSync(() => setState("joining"));
      const sdk = await loadZoomEmbedded();
      if (!sdk) {
        setState("idle");
        return fallbackOrCancelled();
      }
      let client: ZoomEmbeddedClient | null = null;
      try {
        client = sdk.createClient();
        opening.current = { sdk, client };
        // A browser that cannot do voice over the web cannot use the in-app call; the link (or the phone) still can.
        if (!client.checkSystemRequirements().audio) throw new Error("unsupported browser");
        await client.init({ zoomAppRoot: root, language: LANGUAGE, patchJsMedia: true, leaveOnPageUnload: true });
        const join = prepared.join;
        // The role word is the display label, never a name. The customer key is the opaque value the server verifies on Zoom's webhook.
        await client.join({
          signature: join.signature,
          meetingNumber: join.meetingNumber,
          userName: join.displayLabel,
          customerKey: join.customerKey,
          ...(join.password ? { password: join.password } : {}),
          ...(join.zak ? { zak: join.zak } : {}),
        });
        const controller = new CallController({
          client,
          policy,
          role,
          initialMode: initialMode ?? "video",
          now: () => Date.now(),
          report: (r) => reportCallEventAction(encounterId, r),
          onNotice: setNotice,
          onClosed: () => {
            void teardown().then(() => {
              setState("idle");
              // a phone notice raised by this very close stays on screen: it is how the person is told what to do next
              setNotice((n) => (n === "phone" ? n : null));
            });
          },
          onPhone: () => {
            // The connection did not come back in time. Leave the web call so the person is not in the room twice (web and phone)
            // when it recovers, then show the dial-in card.
            void teardown().then(() => setState("idle"));
            onPhone();
          },
        });
        if (!mounted.current || cancelled.current) {
          // the page went away, or the person pressed Leave, while Zoom was joining: leave again at once rather than stay in a call
          // nobody is showing. (A hung join is also how Leave is reached: the call box has a Leave button from the moment it opens.)
          try {
            await client.leaveMeeting();
          } catch {
            // already out
          }
          sdk.destroyClient();
          setState("idle");
          return "cancelled";
        }
        opening.current = null;
        controller.start();
        live.current = { sdk, client, controller };
        setNotice(null);
        setState("in_call");
        return "started";
      } catch {
        // Anything the SDK refuses (a bad signature, a closed room, a missing host key) ends here, and the link takes over.
        if (client) {
          try {
            sdk.destroyClient();
          } catch {
            // nothing to destroy
          }
        }
        setState("idle");
        return fallbackOrCancelled();
      }
    },
    [rootRef, teardown],
  );

  const starting = useRef(false);
  const start = useCallback(
    async (media: "video" | "audio_only"): Promise<StartResult> => {
      // Already in a call, or opening one: a second start would tear the first down (Zoom's client is a singleton) and leak its listeners.
      if (live.current || starting.current) return "busy";
      starting.current = true;
      try {
        return await run(media);
      } finally {
        starting.current = false;
      }
    },
    [run],
  );

  const leave = useCallback(async () => {
    // Pressed while Zoom is still opening: the start in flight sees this and leaves again as soon as it can.
    cancelled.current = true;
    const pending = opening.current;
    opening.current = null;
    if (pending) {
      // Zoom's client is a singleton and may never settle (a hung join, or one waiting for the host): leave it now, which also makes the
      // join in flight fail, and free the start guard so the person can try again.
      try {
        await pending.client.leaveMeeting();
      } catch {
        // not in the meeting yet
      }
      try {
        pending.sdk.destroyClient();
      } catch {
        // nothing to destroy
      }
      starting.current = false;
    }
    await teardown();
    setState("idle");
    setNotice(null);
  }, [teardown]);

  const takeVideo = useCallback(() => {
    live.current?.controller.patientTakesVideo();
  }, []);

  return { state, notice, start, leave, takeVideo };
}
