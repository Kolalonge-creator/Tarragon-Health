/** @jest-environment jsdom */
/**
 * T2-11b: the /verify-rx index offers the Rx number and code box, shows a plain notice for each outcome it is sent back with, ignores an
 * unknown notice, and keeps the page out of search and out of Referer headers.
 */
import { render, screen } from "@testing-library/react";

jest.mock("./actions", () => ({ checkPrescriptionCodeAction: jest.fn() }));

import VerifyPrescriptionIndex, { metadata } from "./page";
import { CODE_LOOKUP_MESSAGE } from "@/lib/prescriptions/public-verification";

async function renderWith(n?: string) {
  const element = await VerifyPrescriptionIndex({ searchParams: Promise.resolve(n === undefined ? {} : { n }) });
  render(element);
}

describe("/verify-rx index", () => {
  it("offers the Rx number and verification code box", async () => {
    await renderWith();
    expect(screen.getByLabelText(/Rx number/)).toBeTruthy();
    expect(screen.getByLabelText(/Verification code/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Check this prescription/ })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the notice it was sent back with", async () => {
    await renderWith("locked");
    expect(screen.getByRole("alert").textContent).toBe(CODE_LOOKUP_MESSAGE.locked);
  });

  it("ignores a notice it does not know", async () => {
    await renderWith("<script>");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is not indexed and sends no referrer", () => {
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("no notice uses an em dash", () => {
    for (const text of Object.values(CODE_LOOKUP_MESSAGE)) expect(text).not.toMatch(/—/);
  });
});
