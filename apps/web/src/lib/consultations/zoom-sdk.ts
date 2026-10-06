/**
 * The small slice of Zoom's Meeting SDK for the web (Component View, the `ZoomMtgEmbedded` global) that the consultation room uses,
 * typed by hand from the SDK's published declarations (@zoom/meetingsdk 6.5.0, embedded.d.ts) so the rest of the app stays strict
 * and the SDK itself is never a build dependency.
 *
 * Why the script is loaded from Zoom's CDN at run time and not installed from npm: the npm package is about 120 MB, pins React 18
 * as a peer while this app runs React 19, and a bundled copy would still have to fetch its media assets from source.zoom.us. Loading
 * the self-contained embedded build only on the consultation page, only when someone chooses to join, keeps it out of every other
 * page and makes "the SDK failed to load" an ordinary, handled case (the room then uses the link).
 *
 * Findings from reading the declarations that shape the design (S21 follow-up, OQ-136):
 *  - There is NO programmatic camera control in Component View (no stopVideo or startVideo; the person uses Zoom's own toolbar). So
 *    "audio only" is a notice plus a recorded mode change, never a switch we throw.
 *  - Quality arrives as `network-quality-change` (levels 0 to 5, only while the camera is on) and `audio-statistic-data-change`
 *    (packet loss, round trip time, all the time once subscribed). Connection state is `connection-change`.
 *  - `join` accepts `customerKey`, which Zoom returns as `customer_key` in participant webhooks (see consultation-call.ts).
 */
export const ZOOM_SDK_VERSION = "6.5.0";
export const ZOOM_SDK_SCRIPT = `https://source.zoom.us/${ZOOM_SDK_VERSION}/zoom-meeting-embedded-${ZOOM_SDK_VERSION}.min.js`;

export interface ZoomSelfUser {
  readonly userId: number;
}

export interface ZoomEmbeddedClient {
  init(options: { zoomAppRoot: HTMLElement; language: string; patchJsMedia?: boolean; leaveOnPageUnload?: boolean }): Promise<unknown>;
  join(options: { signature: string; meetingNumber: string; userName: string; password?: string; customerKey?: string; zak?: string }): Promise<unknown>;
  on(event: string, callback: (payload: unknown) => void): void;
  off(event: string, callback: (payload: unknown) => void): void;
  subscribeStatisticData(args: { audio: boolean; video: boolean; share: boolean }): Promise<unknown>;
  unSubscribeStatisticData(args: { audio: boolean; video: boolean; share: boolean }): Promise<unknown>;
  getCurrentUser(): ZoomSelfUser | null;
  leaveMeeting(): Promise<unknown>;
  endMeeting(): Promise<unknown>;
  checkSystemRequirements(): { audio: boolean; video: boolean; screen: boolean };
}

export interface ZoomEmbeddedGlobal {
  readonly VERSION: string;
  createClient(): ZoomEmbeddedClient;
  destroyClient(): void;
}

declare global {
  interface Window {
    ZoomMtgEmbedded?: ZoomEmbeddedGlobal;
  }
}

/**
 * Loads the embedded SDK once and resolves to its global, or null when it cannot be had (blocked, offline, slow, or no `window`).
 * Never throws: the caller treats null as "use the link".
 */
export function loadZoomEmbedded(document_?: Document | null, timeoutMs = 20_000): Promise<ZoomEmbeddedGlobal | null> {
  const doc = document_ === undefined ? (typeof document === "undefined" ? null : document) : document_;
  if (!doc) return Promise.resolve(null);
  const win = doc.defaultView;
  if (win?.ZoomMtgEmbedded) return Promise.resolve(win.ZoomMtgEmbedded);
  return new Promise((resolve) => {
    const script = doc.createElement("script");
    let settled = false;
    const finish = (value: ZoomEmbeddedGlobal | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A script that failed leaves nothing behind that would block a second try.
      if (value === null) script.remove();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    script.src = ZOOM_SDK_SCRIPT;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => finish(win?.ZoomMtgEmbedded ?? null);
    script.onerror = () => finish(null);
    doc.head.appendChild(script);
  });
}
