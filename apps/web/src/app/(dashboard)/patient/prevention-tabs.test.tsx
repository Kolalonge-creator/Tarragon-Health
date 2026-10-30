/** @jest-environment jsdom */
/**
 * The tab bar is shared by the Prevention and Labs pages. Panels stay mounted (an upload in progress must survive a tab
 * switch), a hash deep link opens the tab that owns it, and the bar is announced with the page's own name.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { PreventionTabs } from "./prevention-tabs";

const tabs = [
  { id: "a", label: "First", content: <p>first body</p> },
  { id: "b", label: "Second", anchorIds: ["deep"], content: <div id="deep">second body</div> },
];

const panelOf = (text: string) => screen.getByText(text).closest('[role="tabpanel"]') as HTMLElement;

describe("PreventionTabs", () => {
  beforeEach(() => {
    window.location.hash = "";
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  it("shows the first tab and keeps the other panel mounted but hidden", () => {
    render(<PreventionTabs tabs={tabs} />);
    expect(screen.getByRole("tab", { name: "First" }).getAttribute("aria-selected")).toBe("true");
    expect(panelOf("first body").hidden).toBe(false);
    expect(panelOf("second body").hidden).toBe(true);
  });

  it("switches panel on click", () => {
    render(<PreventionTabs tabs={tabs} />);
    fireEvent.click(screen.getByRole("tab", { name: "Second" }));
    expect(panelOf("second body").hidden).toBe(false);
    expect(panelOf("first body").hidden).toBe(true);
  });

  it("opens the tab that owns a hash deep link", () => {
    window.location.hash = "#deep";
    render(<PreventionTabs tabs={tabs} />);
    expect(screen.getByRole("tab", { name: "Second" }).getAttribute("aria-selected")).toBe("true");
  });

  it("labels the tab bar with the page's own name, defaulting to Prevention", () => {
    const { rerender } = render(<PreventionTabs tabs={tabs} />);
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe("Prevention sections");
    rerender(<PreventionTabs tabs={tabs} ariaLabel="Labs sections" />);
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe("Labs sections");
  });
});
