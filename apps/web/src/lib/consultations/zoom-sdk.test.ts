/** @jest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { loadZoomEmbedded, ZOOM_SDK_INTEGRITY, ZOOM_SDK_SCRIPT, ZOOM_SDK_VERSION, type ZoomEmbeddedGlobal } from "./zoom-sdk";

const fakeGlobal = (): ZoomEmbeddedGlobal => ({ VERSION: ZOOM_SDK_VERSION, createClient: () => { throw new Error("not used"); }, destroyClient: () => undefined });
const scripts = () => [...document.head.querySelectorAll("script")];

beforeEach(() => {
  delete window.ZoomMtgEmbedded;
  document.head.innerHTML = "";
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("loading Zoom's embedded Meeting SDK", () => {
  it("is pinned to one version on Zoom's own host", () => {
    expect(ZOOM_SDK_SCRIPT).toBe(`https://source.zoom.us/${ZOOM_SDK_VERSION}/zoom-meeting-embedded-${ZOOM_SDK_VERSION}.min.js`);
  });

  it("adds one script and resolves to the global once it has loaded", async () => {
    const p = loadZoomEmbedded();
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]?.src).toBe(ZOOM_SDK_SCRIPT);
    // the browser checks the bytes against the reviewed hash, so a changed file on Zoom's host cannot run on these pages
    expect(scripts()[0]?.integrity).toBe(ZOOM_SDK_INTEGRITY);
    expect(ZOOM_SDK_INTEGRITY).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
    window.ZoomMtgEmbedded = fakeGlobal();
    scripts()[0]?.dispatchEvent(new Event("load"));
    expect(await p).toBe(window.ZoomMtgEmbedded);
  });

  it("does not load twice when the global is already there", async () => {
    window.ZoomMtgEmbedded = fakeGlobal();
    expect(await loadZoomEmbedded()).toBe(window.ZoomMtgEmbedded);
    expect(scripts()).toHaveLength(0);
  });

  it("resolves null, and leaves no script behind, when the script is blocked or fails", async () => {
    const p = loadZoomEmbedded();
    scripts()[0]?.dispatchEvent(new Event("error"));
    expect(await p).toBeNull();
    expect(scripts()).toHaveLength(0);
  });

  it("resolves null when the script loads but the global is missing", async () => {
    const p = loadZoomEmbedded();
    scripts()[0]?.dispatchEvent(new Event("load"));
    expect(await p).toBeNull();
  });

  it("resolves null when it takes too long, and a late load after that changes nothing", async () => {
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
