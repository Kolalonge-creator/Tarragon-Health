import { redirect } from "next/navigation";

/**
 * Retired in favour of /admin/ops (2026-09-03): this page and /admin/ops were
 * two independently-built consoles doing the same cross-domain worklist job.
 * /admin/ops is canonical — it's the one linked from the persistent sidebar,
 * sits next to the incident register, and its permission check
 * (private.can_view_ops_console(), mirrored by admin/page.tsx's canViewOps)
 * correctly includes the analyst role, which this route's narrower
 * ops.console.view-only gate missed. Kept as a redirect for old bookmarks.
 */
export default function OpsConsoleSettingsPage() {
  redirect("/admin/ops");
}
