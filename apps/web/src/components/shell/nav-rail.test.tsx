/** @jest-environment jsdom */
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { getNavSections } from "@/lib/navigation";
import { ConsoleBreadcrumbs, NavRail, OPEN_GROUPS_STORAGE_KEY, navGroupScope, openNavGroup, useRailCollapsed } from "./nav-rail";

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: { alt: string }) => <span data-alt={props.alt} />,
}));

const sections = getNavSections("admin", null);

function rail(onOpenGroup = jest.fn(), onExpand = jest.fn()) {
  return (
    <NavRail
      sections={sections}
      pathname="/admin/security"
      homeHref="/admin"
      profileHref="/admin/profile"
      userName="Ada Admin"
      onOpenGroup={onOpenGroup}
      onExpand={onExpand}
    />
  );
}

function renderRail(onOpenGroup = jest.fn(), onExpand = jest.fn()) {
  render(rail(onOpenGroup, onExpand));
  return { onOpenGroup, onExpand };
}

beforeEach(() => window.localStorage.clear());

describe("NavRail (the folded admin sidebar)", () => {
  it("names every icon, so the rail never relies on the icon alone", async () => {
    await expectNoA11yViolations(rail());
    for (const item of sections[0].items) expect(screen.getByRole("link", { name: item.label })).toBeTruthy();
    for (const s of sections.filter((x) => x.label)) {
      expect(screen.getByRole("button", { name: `${s.label}: open this group` })).toBeTruthy();
    }
  });

  it("opens the pressed group instead of guessing one of its pages", () => {
    const { onOpenGroup } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Membership and money: open this group" }));
    expect(onOpenGroup).toHaveBeenCalledWith("Membership and money");
  });

  it("unfolds from the expand button", () => {
    const { onExpand } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Expand menu" }));
    expect(onExpand).toHaveBeenCalled();
  });
});

describe("NavRail badges and layout", () => {
  it("puts Expand first after the logo, so a short window can never push it off-screen", () => {
    renderRail();
    const expand = screen.getByRole("button", { name: "Expand menu" });
    const firstNavLink = screen.getByRole("link", { name: "Dashboard" });
    expect(expand.compareDocumentPosition(firstNavLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("rolls a link's count up to its group icon, in words as well as the mark", () => {
    render(
      <NavRail
        sections={sections}
        pathname="/admin"
        homeHref="/admin"
        profileHref="/admin/profile"
        userName="Ada Admin"
        badgeFor={(item) => (item.href === "/admin/refund-requests" ? { count: 3, failed: false } : null)}
        onOpenGroup={jest.fn()}
        onExpand={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Membership and money: open this group, 3 waiting" }).textContent).toContain("3");
  });

  it("counts a live count shared by two links in one group once", () => {
    const shared = [{ label: "Care delivery", icon: "caseload" as const, items: [
      { label: "Queue", href: "/admin/a", icon: "review" as const, countKey: "open_tasks" as never },
      { label: "Queue again", href: "/admin/b", icon: "review" as const, countKey: "open_tasks" as never },
    ] }];
    render(
      <NavRail
        sections={shared}
        pathname="/admin"
        homeHref="/admin"
        profileHref="/admin/profile"
        userName="Ada Admin"
        badgeFor={() => ({ count: 4, failed: false })}
        onOpenGroup={jest.fn()}
        onExpand={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Care delivery: open this group, 4 waiting" })).toBeTruthy();
  });

  it("shows a failed count as could-not-load, never as nothing", () => {
    render(
      <NavRail
        sections={sections}
        pathname="/admin"
        homeHref="/admin"
        profileHref="/admin/profile"
        userName="Ada Admin"
        badgeFor={(item) => (item.href === "/admin/security" ? { count: 0, failed: true } : null)}
        onOpenGroup={jest.fn()}
        onExpand={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Security and governance: open this group, count could not load" })).toBeTruthy();
  });
});

describe("rail storage", () => {
  it("still folds when storage refuses writes", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useRailCollapsed());
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    setItem.mockRestore();
  });

  it("scopes remembered groups by the route's top segment", () => {
    expect(navGroupScope("/admin/security")).toBe("admin");
    expect(navGroupScope("/")).toBe("root");
  });

  it("remembers the fold and tells the shell in the same tab", () => {
    const { result } = renderHook(() => useRailCollapsed());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem("nav-rail-collapsed-v1")).toBe("1");
  });

  it("marks a group open in the area's namespace, keeping other areas' entries", () => {
    window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify(["clinician::Governance"]));
    openNavGroup("/admin/security", "Platform operations");
    openNavGroup("/admin/security", "Platform operations");
    expect(JSON.parse(window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY) ?? "[]")).toEqual([
      "clinician::Governance",
      "admin::Platform operations",
    ]);
  });
});

describe("ConsoleBreadcrumbs", () => {
  it("draws home, group and page, with the page marked current", () => {
    render(<ConsoleBreadcrumbs sections={sections} pathname="/admin/security" />);
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(trail.textContent).toBe("DashboardSecurity and governanceSecurity");
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/admin");
    expect(screen.getByText("Security", { selector: "[aria-current=page]" })).toBeTruthy();
  });

  it("draws nothing on the dashboard itself", () => {
    const { container } = render(<ConsoleBreadcrumbs sections={sections} pathname="/admin" />);
    expect(container.innerHTML).toBe("");
  });
});
