"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { NAV_ICON } from "@/lib/icons";
import type { NavItem } from "@/lib/navigation";
import { useT } from "@/components/ui-language-provider";

/**
 * The quieter links of a long sidebar group (NavItem.more), behind one "More in <group>" toggle. Closed by default; open on its own
 * when the current page is one of them, so the patient always sees where they are. Collapsed links are `inert`, out of the tab order
 * and the accessibility tree, the same way a collapsed group is.
 */
export function NavMoreItems({
  groupLabel,
  items,
  activeInside,
  renderItem,
}: {
  groupLabel: string;
  items: NavItem[];
  /** True when the current page is one of `items`. */
  activeInside: boolean;
  renderItem: (item: NavItem) => React.ReactNode;
}) {
  const tr = useT();
  const panelId = React.useId();
  const [manual, setManual] = React.useState<boolean | undefined>(undefined);
  // Landing on one of these pages re-opens the toggle even after a manual close (state-adjust-during-render).
  const [prevActive, setPrevActive] = React.useState(activeInside);
  if (prevActive !== activeInside) {
    setPrevActive(activeInside);
    if (activeInside) setManual(undefined);
  }
  if (items.length === 0) return null;
  const open = manual ?? activeInside;
  const name = tr(groupLabel);

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setManual(!open)}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-charcoal-ink/60 transition-colors hover:bg-charcoal-ink/5 hover:text-charcoal-ink dark:text-night-ink/60 dark:hover:bg-night-ink/10 dark:hover:text-night-ink"
      >
        <NAV_ICON.chevronRight
          aria-hidden="true"
          className={cn("h-4 w-4 shrink-0 transition-transform duration-200", open && "rotate-90")}
          strokeWidth={2}
        />
        <span className="min-w-0 flex-1 truncate text-left">
          {tr("More in")} {name}
        </span>
      </button>
      <div id={panelId} hidden={!open} inert={!open}>
        <ul className="space-y-0.5 pl-3">{items.map((item) => renderItem(item))}</ul>
      </div>
    </li>
  );
}
