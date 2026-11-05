/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { SignoffQueueItem } from "@/lib/queries/signoff-queue";
import { signoffAnchorId } from "@/lib/signoff-anchor";
import { HubOverview } from "./hub-overview";
import { buildHubSections } from "./hub-sections";
import { OpenOnHash } from "./open-on-hash";

const item = (key: string, title: string, severity: SignoffQueueItem["severity"] = "draft_pending"): SignoffQueueItem => ({
  key,
  title,
  detail: `${title} detail`,
  href: `/clinician/${key}`,
  severity,
});

const hub = {
  items: [item("glucose_triage", "Glucose triage rules"), item("ai_governance", "AI governance", "live_unsigned"), item("community", "Community rules", "setup_needed")],
  operational: [item("capacity_configs", "Capacity settings"), item("ops_desk_config", "Ops desk settings")],
  live: [item("unified_red_paging", "Unified red paging")],
  attention: [item("mdcn_recheck", "MDCN re-checks overdue")],
};

const panels = {
  glucose_triage: <form aria-label="Sign glucose triage rules">glucose panel</form>,
  ai_governance: <div>ai panel</div>,
  capacity_configs: <div>capacity panel</div>,
  unified_red_paging: <div>red paging panel</div>,
};

function renderHub() {
  return render(<HubOverview sections={buildHubSections(hub, panels)} />);
}

const details = (key: string) => document.getElementById(signoffAnchorId(key)) as HTMLDetailsElement;

describe("buildHubSections", () => {
  it("orders sections and puts running-unsigned lines first, keeping the reader's order otherwise", () => {
    const sections = buildHubSections(hub, panels);
    expect(sections.map((s) => s.heading)).toEqual(["Awaiting your signature", "Operational settings", "Signed and running", "Needs your attention"]);
    expect(sections[0].lines.map((l) => l.key)).toEqual(["ai_governance", "glucose_triage", "community"]);
    expect(sections[0].lines[0].chip.label).toBe("Running, not signed");
    expect(sections[1].lines[0].chip.label).toBe("Operational setting");
    expect(sections[2].lines[0].chip.label).toBe("Signed, running");
  });

  it("leaves out the attention section when there is nothing in it", () => {
    expect(buildHubSections({ ...hub, attention: [] }, panels).map((s) => s.id)).not.toContain("hub-attention");
  });
});

describe("HubOverview", () => {
  afterEach(() => {
    window.location.hash = "";
  });

  it("renders every line collapsed, with counts in the section headers, and no panel mounted", () => {
    renderHub();
    for (const key of ["glucose_triage", "ai_governance", "community", "capacity_configs", "ops_desk_config", "unified_red_paging", "mdcn_recheck"]) {
      expect(details(key)).toBeTruthy();
      expect(details(key).open).toBe(false);
    }
    expect(screen.getByTestId("hub-awaiting-count").textContent).toContain("(3)");
    expect(screen.getByTestId("hub-operational-count").textContent).toContain("(2)");
    expect(screen.getByTestId("hub-live-count").textContent).toContain("(1)");
    expect(screen.getByTestId("hub-attention-count").textContent).toContain("(1)");
    expect(screen.queryByText("glucose panel")).toBeNull();
    expect(screen.queryByText("capacity panel")).toBeNull();
  });

  it("opens a line on click and mounts its panel, which stays mounted after closing", async () => {
    renderHub();
    const summary = within(details("glucose_triage")).getByText("Glucose triage rules").closest("summary") as HTMLElement;
    expect(summary.getAttribute("aria-controls")).toBe(`${signoffAnchorId("glucose_triage")}-body`);
    fireEvent.click(summary);
    expect(details("glucose_triage").open).toBe(true);
    expect(await screen.findByRole("form", { name: "Sign glucose triage rules" })).toBeTruthy();
    fireEvent.click(summary);
    expect(details("glucose_triage").open).toBe(false);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByText("glucose panel")).toBeTruthy();
    expect(screen.queryByText("ai panel")).toBeNull();
  });

  it("opens the line named in the URL hash, scrolls to it and mounts its panel", async () => {
    Element.prototype.scrollIntoView = jest.fn();
    window.location.hash = `#${signoffAnchorId("unified_red_paging")}`;
    render(
      <>
        <OpenOnHash />
        <HubOverview sections={buildHubSections(hub, panels)} />
      </>,
    );
    expect(details("unified_red_paging").open).toBe(true);
    expect(details("glucose_triage").open).toBe(false);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(await screen.findByText("red paging panel")).toBeTruthy();
  });

  it("filters lines by name and shows how many match in each section", () => {
    renderHub();
    fireEvent.change(screen.getByLabelText("Find an item by name"), { target: { value: "paging" } });
    expect(screen.getByTestId("hub-awaiting-count").textContent).toContain("(0 of 3)");
    expect(screen.getByTestId("hub-live-count").textContent).toContain("(1 of 1)");
    expect(details("glucose_triage").closest("li")?.hasAttribute("hidden")).toBe(true);
    expect(details("unified_red_paging").closest("li")?.hasAttribute("hidden")).toBe(false);
  });

  it("opens a line with no inline panel to a link to its own page", () => {
    renderHub();
    expect(within(details("community")).getByRole("link", { name: "Open its page" }).getAttribute("href")).toBe("/clinician/community");
  });
});
