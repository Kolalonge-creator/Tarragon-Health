import { itemIsActive, type NavSection } from "@/lib/navigation";

export interface Crumb {
  label: string;
  /** Omitted for a group heading (not a page) and for the page you are on. */
  href?: string;
}

/**
 * The trail shown in the admin console header: the role's home, the sidebar group, then the sidebar page that holds
 * the current route. Built from the same nav tree that draws the sidebar, so there is no second list to keep in step.
 * The deepest matching link wins (on /admin/outcomes/export it is "Export outcomes", not "Outcomes"). A route under
 * no link gives an empty trail rather than a guessed one.
 */
export function buildBreadcrumbs(sections: readonly NavSection[], pathname: string): Crumb[] {
  const home = sections[0]?.items[0];
  if (!home) return [];

  let best: { section: NavSection; label: string; href: string } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (!itemIsActive(pathname, item)) continue;
      if (!best || item.href.length > best.href.length) best = { section, label: item.label, href: item.href };
    }
  }
  if (!best) return [];

  const homeCrumb: Crumb = pathname === home.href ? { label: home.label } : { label: home.label, href: home.href };
  if (best.href === home.href) return [homeCrumb];

  const trail: Crumb[] = [homeCrumb];
  if (best.section.label) trail.push({ label: best.section.label });
  trail.push(pathname === best.href ? { label: best.label } : { label: best.label, href: best.href });
  return trail;
}
