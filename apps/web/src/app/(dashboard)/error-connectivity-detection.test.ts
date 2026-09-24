import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "@jest/globals";
import DashboardError from "./error";

/**
 * docs/OFFLINE_RESILIENCE_AUDIT.md §4 names the general follow-up this audit
 * did NOT make: the shared (dashboard) error boundary treats a genuine
 * connectivity failure the same as any other bug, showing the generic "Oops
 * / Something didn't load properly" fallback for a dropped connection too.
 * That's misleading (it reads as "something's wrong with Tarragon") for the
 * ~113 useActionState call sites that, unlike the individually-hardened
 * logVital, have no per-form guard of their own. This proves the boundary
 * now tells the two apart and renders distinct copy for each, using the same
 * render-and-read-the-markup approach as error-recovery-link.test.ts rather
 * than grepping source text.
 */
function renderBoundary(error: Error): string {
  return renderToStaticMarkup(
    createElement(DashboardError, {
      error: Object.assign(error, { digest: undefined }),
      retry: () => {},
    })
  );
}

describe("(dashboard) error boundary — connectivity detection", () => {
  it("shows a 'connection lost' message for a browser fetch() failure", () => {
    const html = renderBoundary(new TypeError("Failed to fetch"));
    expect(html).toContain("Connection lost");
    expect(html).not.toContain("Something didn");
  });

  it("shows a 'connection lost' message for a deployment-rotation Server Action error", () => {
    const { UnrecognizedActionError } = jest.requireActual<
      typeof import("next/dist/client/components/unrecognized-action-error")
    >("next/dist/client/components/unrecognized-action-error");
    const html = renderBoundary(
      new UnrecognizedActionError('Server Action "abc123" was not found on the server.')
    );
    expect(html).toContain("Connection lost");
    expect(html).not.toContain("Something didn");
  });

  it("keeps the generic fallback for Next's 'unexpected response' error (an expired-session redirect looks identical)", () => {
    // See isConnectivityError's own doc comment: this exact Next-authored
    // literal fires for both a genuine outage AND an ordinary expired
    // session redirected to /login, and nothing left in the Error tells the
    // two apart — so it deliberately falls through to the generic fallback
    // rather than confidently (and often wrongly) saying "connection lost".
    const html = renderBoundary(new Error("An unexpected response was received from the server."));
    expect(html).toContain("Something didn");
    expect(html).not.toContain("Connection lost");
  });

  it("keeps the generic fallback for an unrelated error", () => {
    const html = renderBoundary(new Error("Cannot read properties of undefined (reading 'x')"));
    expect(html).toContain("Something didn");
    expect(html).not.toContain("Connection lost");
  });

  it("keeps the generic fallback for a non-connectivity TypeError", () => {
    const html = renderBoundary(new TypeError("Cannot read properties of undefined (reading 'x')"));
    expect(html).toContain("Something didn");
    expect(html).not.toContain("Connection lost");
  });

  it("still offers the same retry/back-to-dashboard recovery actions either way", () => {
    const connectivity = renderBoundary(new TypeError("Failed to fetch"));
    const generic = renderBoundary(new Error("boom"));
    for (const html of [connectivity, generic]) {
      expect(html).toContain("Try again");
      expect(html).toContain('href="/"');
    }
  });
});
