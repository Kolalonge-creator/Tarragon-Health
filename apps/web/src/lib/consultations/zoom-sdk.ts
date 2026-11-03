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
/**
 * Subresource Integrity for the pinned build: the browser refuses the script if its bytes are not the ones reviewed, so a changed or
 * compromised file on Zoom's host cannot run on pages that carry the most sensitive data. A mismatch is a load failure, and the room
 * then uses the link. Zoom publishes no hash, so this one was computed from the 6.5.0 file; when the version is bumped, recompute it:
 *   curl -s <ZOOM_SDK_SCRIPT> | openssl dgst -sha384 -binary | openssl base64 -A
 * If Zoom ever patches the file in place under the same version, the call quietly stops working (link fallback) until this is updated.
 */
export const ZOOM_SDK_INTEGRITY = "sha384-ImYj+E9pPxFOOyrLY/OLcP6Fke/uY5bNoTGERQFHjrHGtNc3sx3ww9mglTbnkfWe";

/**
 * The CDN build of the SDK is NOT self-contained: it reads React, ReactDOM, Redux, Redux-Thunk and Lodash from globals that Zoom
 * publishes next to it (found on the first live consultation, 2026-11-03: the SDK threw "React is not defined" at load, every join
 * fell back to the link, and the page jolted as the call box showed and hid). They load in this order, each pinned by hash the same
 * way as the SDK (computed from the 6.5.0 files with the command above), before the SDK itself. They are globals of the page, not
 * the app's own React 19, which is module-scoped and untouched.
 */
export const ZOOM_SDK_VENDOR_SCRIPTS: ReadonlyArray<{ readonly src: string; readonly integrity: string }> = [
  { src: `https://source.zoom.us/${ZOOM_SDK_VERSION}/lib/vendor/react.min.js`, integrity: "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z" },
  { src: `https://source.zoom.us/${ZOOM_SDK_VERSION}/lib/vendor/react-dom.min.js`, integrity: "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1" },
  { src: `https://source.zoom.us/${ZOOM_SDK_VERSION}/lib/vendor/redux.min.js`, integrity: "sha384-rG4GKxh/ojcHqPD0zvAWGoTbdtGOR9jTH1oeTQ5pnRNDgts3oclAi9EI63TxXfMb" },
  { src: `https://source.zoom.us/${ZOOM_SDK_VERSION}/lib/vendor/redux-thunk.min.js`, integrity: "sha384-W4l2TiN6a5ehGctYQAtP/Y30Inm1F7yySVQXePn9LgMxmr6vtKJdm/R3wgU2+yuI" },
  { src: `https://source.zoom.us/${ZOOM_SDK_VERSION}/lib/vendor/lodash.min.js`, integrity: "sha384-jC7q3III065vSuJ5pJ5KABQTNoQYM3PkN9JDtaoCro/okpUkD6IKqkYr3D8hXxBp" },
];

let knownUnavailable = false;
/**
 * True once the SDK has failed on this page, at load or at run time (an unsupported browser, a refused join). The room then opens the
 * link straight from the click (a window opened after the SDK's own slow failure arrives too late for the browser's popup rule and
 * is blocked silently). A later successful load clears it, so one transient failure does not lock the session into links.
 */
export function zoomSdkKnownUnavailable(): boolean {
  return knownUnavailable;
}
export function markZoomSdkUnavailable(): void {
  knownUnavailable = true;
}

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
export async function loadZoomEmbedded(document_?: Document | null, timeoutMs = 20_000): Promise<ZoomEmbeddedGlobal | null> {
  const doc = document_ === undefined ? (typeof document === "undefined" ? null : document) : document_;
  if (!doc) return null;
  const win = doc.defaultView;
  if (win?.ZoomMtgEmbedded) return win.ZoomMtgEmbedded;
  // One clock for the whole chain: the vendor files and the SDK together must arrive within the timeout.
  const deadline = Date.now() + timeoutMs;
  // The vendor files are fetched together (one round trip, not five) and run in order: a script with async=false keeps its place in
  // the document's queue, so React is defined before ReactDOM runs, and all of them before the SDK is even asked for.
  const missing = ZOOM_SDK_VENDOR_SCRIPTS.filter((v) => !doc.head.querySelector(`script[src="${v.src}"]`));
  const vendors = await Promise.all(missing.map((v) => loadScript(doc, v.src, v.integrity, timeoutMs, false)));
  if (vendors.some((loaded) => !loaded)) {
    knownUnavailable = true;
    return null;
  }
  const loaded = await loadScript(doc, ZOOM_SDK_SCRIPT, ZOOM_SDK_INTEGRITY, deadline - Date.now(), true);
  const sdk = loaded ? (win?.ZoomMtgEmbedded ?? null) : null;
  knownUnavailable = !sdk;
  return sdk;
}

/** Appends one pinned script and resolves true once it has run, false when it was blocked, failed, or took too long. */
function loadScript(doc: Document, src: string, integrity: string, timeoutMs: number, async: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const script = doc.createElement("script");
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A script that failed leaves nothing behind that would block a second try.
      if (!value) script.remove();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    script.src = src;
    script.async = async;
    script.crossOrigin = "anonymous";
    script.integrity = integrity;
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    doc.head.appendChild(script);
  });
}
