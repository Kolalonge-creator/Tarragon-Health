"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Collapses a long-running version/sign-off history behind a "show more"
 * toggle instead of rendering every entry forever.
 *
 * These pages are deliberately append-only — nothing here is ever deleted,
 * because a signed clinical protocol/config version is a regulatory record
 * (an MDCN inquiry or a patient dispute years later can need to know exactly
 * what was in force on a given date). Deleting old versions to keep the page
 * short would destroy that. This solves the actual problem — a page that
 * reads fine at 3 versions and unreadable at 100 — the other way: everything
 * stays in the database and stays reachable, it's just not all rendered by
 * default. Client-only state, nothing persisted: reopening the page always
 * starts collapsed, which is the safe default (a Director shouldn't need to
 * remember they left an old list expanded).
 */
export function VersionHistoryList({
  children,
  defaultVisibleCount = 3,
  itemNoun = "version",
}: {
  children: React.ReactElement[];
  defaultVisibleCount?: number;
  /** Singular noun for what's being collapsed, e.g. "version", "sign-off", "rule". */
  itemNoun?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = children.length - defaultVisibleCount;

  if (hiddenCount <= 0) {
    return <div className="space-y-3">{children}</div>;
  }

  const visible = expanded ? children : children.slice(0, defaultVisibleCount);

  return (
    <div className="space-y-3">
      {visible}
      <Button type="button" variant="outline" size="sm" onClick={() => setExpanded((e) => !e)}>
        {expanded
          ? `Show fewer ${itemNoun}s`
          : `Show ${hiddenCount} earlier ${itemNoun}${hiddenCount === 1 ? "" : "s"}`}
      </Button>
    </div>
  );
}
