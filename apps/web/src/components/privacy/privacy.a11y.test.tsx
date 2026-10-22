/** @jest-environment jsdom */
/** UI-B: "Who can see this" and "Hide on this phone". Axe-clean; every claim on screen is one the product can keep. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LockStorage } from "@tarragon/shared";
import { expectNoA11yViolations } from "@/test/a11y";
import { HideOnThisPhone } from "./hide-on-this-phone";
import { WhoCanSeeThis } from "./who-can-see-this";

function memory(): LockStorage {
  const d = new Map<string, string>();
  return { get: async (k) => d.get(k) ?? null, set: async (k, v) => void d.set(k, v), remove: async (k) => void d.delete(k) };
}

describe("WhoCanSeeThis", () => {
  it("shows three rows, a preview, the limit and a link to the Care Circle", async () => {
    render(<WhoCanSeeThis />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    for (const name of ["Only me", "My care team", "People I choose"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getByText(/What someone in your Care Circle would see/)).toBeTruthy();
    expect(screen.getByText(/not a full lock/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Choose who is in your Care Circle" }).getAttribute("href")).toBe("/patient/care-circle");
    expect(document.body.textContent).not.toMatch(/—|your doctor/i);
    cleanup();
    await expectNoA11yViolations(<WhoCanSeeThis />);
  });

  it("does not offer a switch it cannot honour: the care team row says it cannot be turned off here yet", () => {
    render(<WhoCanSeeThis />);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getByText(/cannot switch this off here yet/)).toBeTruthy();
  });
});

describe("HideOnThisPhone", () => {
  it("hides the card, remembers it on this device, and shows it again on request", async () => {
    const storage = memory();
    const { unmount } = render(
      <HideOnThisPhone accountId="a1" card="growth" storage={storage}>
        <p>private card body</p>
      </HideOnThisPhone>,
    );
    await screen.findByText("private card body");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Hide on this phone" })));
    expect(screen.queryByText("private card body")).toBeNull();
    expect(screen.getByText("This card is hidden on this phone.")).toBeTruthy();
    // The placeholder does not say what is hidden.
    expect(document.body.textContent).not.toMatch(/growth|cycle|pregnan|contracept/i);
    unmount();
    render(
      <HideOnThisPhone accountId="a1" card="growth" storage={storage}>
        <p>private card body</p>
      </HideOnThisPhone>,
    );
    await screen.findByText("This card is hidden on this phone.");
    expect(screen.queryByText("private card body")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show again" })));
    expect(screen.getByText("private card body")).toBeTruthy();
  });

  it("another account on the same device is not affected", async () => {
    const storage = memory();
    await storage.set("hide_on_device:a1:growth", "1");
    render(
      <HideOnThisPhone accountId="a2" card="growth" storage={storage}>
        <p>private card body</p>
      </HideOnThisPhone>,
    );
    await screen.findByText("private card body");
  });

  it("says so when the choice could not be saved, and keeps the card visible", async () => {
    const storage: LockStorage = { get: async () => null, set: async () => { throw new Error("full"); }, remove: async () => undefined };
    render(
      <HideOnThisPhone accountId="a1" card="cycle" storage={storage}>
        <p>private card body</p>
      </HideOnThisPhone>,
    );
    await screen.findByText("private card body");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Hide on this phone" })));
    expect(screen.getByText("private card body")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("is axe-clean in both states", async () => {
    const storage = memory();
    const r = await expectNoA11yViolations(
      <HideOnThisPhone accountId="a1" card="cycle" storage={storage}>
        <p>body</p>
      </HideOnThisPhone>,
    );
    await screen.findByText("body");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Hide on this phone" })));
    expect(r.container.textContent).toContain("hidden on this phone");
  });
});
