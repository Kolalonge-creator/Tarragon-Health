import { getNavSections } from "./navigation";
import { buildBreadcrumbs } from "./navigation-breadcrumbs";

const admin = getNavSections("admin", null);

describe("buildBreadcrumbs (admin console header)", () => {
  it("shows only the home crumb, unlinked, on the dashboard", () => {
    expect(buildBreadcrumbs(admin, "/admin")).toEqual([{ label: "Dashboard" }]);
  });

  it("gives home, group and page on a sidebar page, with the page unlinked", () => {
    expect(buildBreadcrumbs(admin, "/admin/security")).toEqual([
      { label: "Dashboard", href: "/admin" },
      { label: "Security and governance" },
      { label: "Security" },
    ]);
  });

  it("links the page crumb when you are below it", () => {
    expect(buildBreadcrumbs(admin, "/admin/patients/abc")).toEqual([
      { label: "Dashboard", href: "/admin" },
      { label: "People and access" },
      { label: "Patients", href: "/admin/patients" },
    ]);
  });

  it("picks the deepest matching link", () => {
    expect(buildBreadcrumbs(admin, "/admin/outcomes/export").at(-1)).toEqual({ label: "Export outcomes" });
  });

  it("puts every settings page under Configuration > Settings", () => {
    expect(buildBreadcrumbs(admin, "/admin/settings/members")).toEqual([
      { label: "Dashboard", href: "/admin" },
      { label: "Configuration" },
      { label: "Settings", href: "/admin/settings" },
    ]);
  });

  it("gives no trail for a route under no link, rather than a guess", () => {
    expect(buildBreadcrumbs(admin, "/somewhere/else")).toEqual([]);
  });

  it("gives every labelled admin group an icon for the collapsed sidebar", () => {
    for (const section of admin.filter((s) => s.label)) expect({ group: section.label, icon: !!section.icon }).toEqual({ group: section.label, icon: true });
  });
});
