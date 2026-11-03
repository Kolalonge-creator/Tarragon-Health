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
/** Lets every vendor script "load", after which the loader appends the SDK script. */
const loadVendors = async () => {
  for (const s of scripts().filter((x) => x.src !== ZOOM_SDK_SCRIPT)) s.dispatchEvent(new Event("load"));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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

  it("adds the vendor scripts together and in order, then the SDK once they have all run, each pinned by hash, and resolves to the global", async () => {
    const p = loadZoomEmbedded();
    // all five vendor files are fetched at once (one round trip) but run in document order, so each global is in place for the next
    expect(scripts().map((s) => s.src)).toEqual(ZOOM_SDK_VENDOR_SCRIPTS.map((v) => v.src));
    expect(scripts().map((s) => s.integrity)).toEqual(ZOOM_SDK_VENDOR_SCRIPTS.map((v) => v.integrity));
    for (const s of scripts()) expect(s.async).toBe(false);
    await loadVendors();
    expect(scripts().map((s) => s.src)).toEqual([...ZOOM_SDK_VENDOR_SCRIPTS.map((v) => v.src), ZOOM_SDK_SCRIPT]);
    // the browser checks the bytes against the reviewed hash, so a changed file on Zoom's host cannot run on these pages
    expect(last().integrity).toBe(ZOOM_SDK_INTEGRITY);
    expect(ZOOM_SDK_INTEGRITY).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
    for (const s of scripts()) expect(s.crossOrigin).toBe("anonymous");
    window.ZoomMtgEmbedded = fakeGlobal();
    await loadLast();
    expect(await p).toBe(window.ZoomMtgEmbedded);
    // a good load clears any earlier failure, so one bad moment does not lock the page into links
    expect(zoomSdkKnownUnavailable()).toBe(false);
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
    expect(scripts()).toHaveLength(ZOOM_SDK_VENDOR_SCRIPTS.length);
    expect(scripts().filter((s) => s.src === ZOOM_SDK_VENDOR_SCRIPTS[0]!.src)).toHaveLength(1);
  });

  it("resolves null, leaves no failed script behind, and remembers the failure when a vendor file is blocked", async () => {
    const p = loadZoomEmbedded();
    scripts()[0]?.dispatchEvent(new Event("error"));
    // the failed one is gone at once; the others still arrive, and the chain still answers null
    for (const s of scripts()) s.dispatchEvent(new Event("load"));
    expect(await p).toBeNull();
    expect(scripts().map((s) => s.src)).toEqual(ZOOM_SDK_VENDOR_SCRIPTS.slice(1).map((v) => v.src));
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
