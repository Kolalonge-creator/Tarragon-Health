/** @jest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { loadZoomEmbedded, ZOOM_SDK_INTEGRITY, ZOOM_SDK_SCRIPT, ZOOM_SDK_VENDOR_SCRIPTS, ZOOM_SDK_VERSION, zoomSdkKnownUnavailable, type ZoomEmbeddedGlobal } from "./zoom-sdk";

const fakeGlobal = (): ZoomEmbeddedGlobal => ({ VERSION: ZOOM_SDK_VERSION, createClient: () => { throw new Error("not used"); }, destroyClient: () => undefined });
const scripts = () => [...document.head.querySelectorAll("script")];
const last = () => scripts()[scripts().length - 1]!;
/** Lets the pending script "load" and gives the loader a turn to append the next one. */
const loadLast = async () => {
  last().dispatchEvent(new Event("load"));
  await Promise.resolve();
  await Promise.resolve();
};
/** Loads every vendor script in turn, leaving the SDK script pending. */
const loadVendors = async () => {
  for (let i = 0; i < ZOOM_SDK_VENDOR_SCRIPTS.length; i += 1) await loadLast();
};

beforeEach(() => {
  delete window.ZoomMtgEmbedded;
  document.head.innerHTML = "";
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("loading Zoom's embedded Meeting SDK", () => {
  it("is pinned to one version on Zoom's own host, and so are the vendor files it needs", () => {
    expect(ZOOM_SDK_SCRIPT).toBe(`https://source.zoom.us/${ZOOM_SDK_VERSION}/zoom-meeting-embedded-${ZOOM_SDK_VERSION}.min.js`);
    // the CDN build reads React, ReactDOM, Redux, Redux-Thunk and Lodash from page globals, in this order
    expect(ZOOM_SDK_VENDOR_SCRIPTS.map((v) => v.src)).toEqual(["react", "react-dom", "redux", "redux-thunk", "lodash"].map((n) => `https://source.zoom.us/${ZOOM_SDK_VERSION}/lib/vendor/${n}.min.js`));
    for (const v of ZOOM_SDK_VENDOR_SCRIPTS) expect(v.integrity).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
  });

  it("adds the vendor scripts one at a time, then the SDK, each pinned by hash, and resolves to the global once it has loaded", async () => {
    const p = loadZoomEmbedded();
    // only the first vendor file is asked for until it has run: the SDK must find every global in place
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]?.src).toBe(ZOOM_SDK_VENDOR_SCRIPTS[0]!.src);
    expect(scripts()[0]?.integrity).toBe(ZOOM_SDK_VENDOR_SCRIPTS[0]!.integrity);
    await loadVendors();
    expect(scripts().map((s) => s.src)).toEqual([...ZOOM_SDK_VENDOR_SCRIPTS.map((v) => v.src), ZOOM_SDK_SCRIPT]);
    // the browser checks the bytes against the reviewed hash, so a changed file on Zoom's host cannot run on these pages
    expect(last().integrity).toBe(ZOOM_SDK_INTEGRITY);
    expect(ZOOM_SDK_INTEGRITY).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
    for (const s of scripts()) expect(s.crossOrigin).toBe("anonymous");
    window.ZoomMtgEmbedded = fakeGlobal();
    await loadLast();
    expect(await p).toBe(window.ZoomMtgEmbedded);
  });

  it("does not load twice when the global is already there", async () => {
    window.ZoomMtgEmbedded = fakeGlobal();
    expect(await loadZoomEmbedded()).toBe(window.ZoomMtgEmbedded);
    expect(scripts()).toHaveLength(0);
  });

  it("does not add a vendor file the page already has", async () => {
    const present = document.createElement("script");
    present.src = ZOOM_SDK_VENDOR_SCRIPTS[0]!.src;
    document.head.appendChild(present);
    void loadZoomEmbedded();
    expect(scripts()).toHaveLength(2);
    expect(scripts()[1]?.src).toBe(ZOOM_SDK_VENDOR_SCRIPTS[1]!.src);
  });

  it("resolves null, leaves no failed script behind, and remembers the failure when a vendor file is blocked", async () => {
    const p = loadZoomEmbedded();
    scripts()[0]?.dispatchEvent(new Event("error"));
    expect(await p).toBeNull();
    expect(scripts()).toHaveLength(0);
    expect(zoomSdkKnownUnavailable()).toBe(true);
  });

  it("resolves null, and leaves no script behind, when the SDK itself is blocked or fails", async () => {
    const p = loadZoomEmbedded();
    await loadVendors();
    last().dispatchEvent(new Event("error"));
    expect(await p).toBeNull();
    expect(scripts()).toHaveLength(ZOOM_SDK_VENDOR_SCRIPTS.length);
  });

  it("resolves null when the SDK loads but the global is missing", async () => {
    const p = loadZoomEmbedded();
    await loadVendors();
    await loadLast();
    expect(await p).toBeNull();
  });

  it("resolves null when the whole chain takes too long, and a late load after that changes nothing", async () => {
    const p = loadZoomEmbedded(document, 1000);
    const script = scripts()[0]!;
    jest.advanceTimersByTime(1000);
    expect(await p).toBeNull();
    window.ZoomMtgEmbedded = fakeGlobal();
    script.dispatchEvent(new Event("load"));
    expect(await p).toBeNull();
  });

  it("resolves null with no document at all (server rendering)", async () => {
    expect(await loadZoomEmbedded(null)).toBeNull();
  });
});
