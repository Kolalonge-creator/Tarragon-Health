import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "@jest/globals";
import MarketingError from "./error";

/**
 * Next 16.3.3 (this repo's pinned version) invokes an error.tsx boundary
 * with `retry`, not the interim v16.2.0 `unstable_retry` name — see
 * [[reference_next16_error_boundary_retry_prop_renamed]] in memory. A
 * boundary still typed against `unstable_retry` destructures `undefined` at
 * runtime, so its "Try again" button throws instead of retrying, silently
 * and without failing any build: the framework's own call site is untyped,
 * so a stale prop name only shows up here, where TypeScript checks this
 * file's props against the component's declared signature.
 */
function renderBoundary(): string {
  return renderToStaticMarkup(
    createElement(MarketingError, {
      error: Object.assign(new Error("boom"), { digest: "test-digest" }),
      retry: () => {},
    })
  );
}

describe("(marketing) error boundary", () => {
  it("accepts Next 16's `retry` prop and renders the retry action", () => {
    expect(renderBoundary()).toContain("Try again");
  });
});
