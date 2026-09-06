import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "@jest/globals";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "./form-error";

/**
 * The whole point of this primitive is the two attributes a hand-rolled
 * `<p className="text-red-600">` never had: `role="alert"`, which is what
 * makes a submit failure audible at all, and a stable `id` for the failing
 * field's `aria-describedby` to point at. Both are asserted on the rendered
 * markup rather than by reading the source, so moving the element behind a
 * wrapper or dropping an attribute fails the test.
 *
 * `renderToStaticMarkup` needs no DOM, so this runs under this project's
 * `testEnvironment: "node"` with no jsdom and no new dependency, the same way
 * app/(dashboard)/error-recovery-link.test.ts does it.
 */
function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

describe("FormError", () => {
  it("renders nothing when there is no message", () => {
    expect(render(createElement(FormError, { id: "x-error" }))).toBe("");
    expect(render(createElement(FormError, { id: "x-error", message: null }))).toBe("");
    expect(render(createElement(FormError, { id: "x-error", message: "" }))).toBe("");
    expect(render(createElement(FormError, { id: "x-error", message: false }))).toBe("");
  });

  it("announces the message as an alert, under the given id", () => {
    const html = render(
      createElement(FormError, { id: "email-error", message: "Check your email." })
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="email-error"');
    expect(html).toContain("Check your email.");
  });

  it("stays out of the tab order while remaining focusable", () => {
    const html = render(createElement(FormError, { id: "e", message: "boom" }));
    expect(html).toContain('tabindex="-1"');
  });
});

describe("FormSuccess", () => {
  it("renders nothing when there is no message", () => {
    expect(render(createElement(FormSuccess, {}))).toBe("");
    expect(render(createElement(FormSuccess, { message: false }))).toBe("");
  });

  it("announces politely rather than assertively", () => {
    const html = render(createElement(FormSuccess, { message: "Saved." }));
    // A success must be announced, but interrupting whatever the user is
    // reading for good news is the wrong trade.
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });
});

describe("fieldErrorId", () => {
  it("derives a stable id from the field id", () => {
    expect(fieldErrorId("password")).toBe("password-error");
  });
});

describe("fieldErrorProps", () => {
  it("marks nothing invalid when the field is fine", () => {
    expect(fieldErrorProps("e", false)).toEqual({});
  });

  it("marks the field invalid and points it at the error", () => {
    expect(fieldErrorProps("email-error", true)).toEqual({
      "aria-invalid": true,
      "aria-describedby": "email-error",
    });
  });

  it("keeps existing hint text described even when there is no error", () => {
    // Regression guard: an aria-describedby naming only the error would
    // silence the format hint a sighted user can still read.
    expect(fieldErrorProps("phone-error", false, "phone-format-hint")).toEqual({
      "aria-describedby": "phone-format-hint",
    });
  });

  it("lists the error first, then the hints", () => {
    expect(fieldErrorProps("phone-error", true, "phone-format-hint")["aria-describedby"]).toBe(
      "phone-error phone-format-hint"
    );
  });

  it("drops absent hint ids rather than emitting empty tokens", () => {
    expect(fieldErrorProps("e", true, null, undefined, false, "")["aria-describedby"]).toBe("e");
  });

  it("survives being spread onto a real input", () => {
    const html = render(
      createElement("input", {
        id: "phone",
        ...fieldErrorProps("phone-error", true, "phone-format-hint"),
      })
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="phone-error phone-format-hint"');
  });
});
