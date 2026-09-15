import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "@jest/globals";
import { ROLE_HOME_PATH } from "@/lib/auth/roles";
import DashboardError from "./error";

/**
 * The (dashboard) error boundary is shared by every signed-in role, so its
 * one recovery link must not point at any single role's home. It previously
 * linked to /patient, which proxy.ts bounces for a clinician, admin, finance,
 * pharmacist or coordinator account, leaving the only offered way out of an
 * error screen in a redirect loop.
 *
 * This renders the component and reads the anchors it actually produces. The
 * earlier version of this file grepped the source text for `href="/"`, which
 * would have gone on passing for `href={"/patient"}`, for a link moved behind
 * a helper, or for a second anchor added alongside the first. Rendering is
 * cheap here: the boundary is a Client Component with no data of its own, and
 * renderToStaticMarkup needs no DOM, so it runs under this project's
 * `testEnvironment: "node"` with no new dependency and no jsdom.
 */
function renderBoundary(): string {
  return renderToStaticMarkup(
    createElement(DashboardError, {
      error: Object.assign(new Error("boom"), { digest: "test-digest" }),
      unstable_retry: () => {},
    })
  );
}

/** Every `href="…"` in the rendered markup, in document order. */
function renderedHrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

describe("(dashboard) error boundary recovery link", () => {
  it("renders exactly one recovery link", () => {
    expect(renderedHrefs(renderBoundary())).toHaveLength(1);
  });

  it("does not send every role to one role's dashboard", () => {
    const hrefs = renderedHrefs(renderBoundary());
    for (const home of Object.values(ROLE_HOME_PATH)) {
      expect(hrefs).not.toContain(home);
    }
  });

  it('offers "/" instead, which proxy.ts resolves per role', () => {
    expect(renderedHrefs(renderBoundary())).toEqual(["/"]);
  });

  it("shows the digest so a report can be matched to server logs", () => {
    expect(renderBoundary()).toContain("test-digest");
  });
});
