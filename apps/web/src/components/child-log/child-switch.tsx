"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { createChildSwitcher, type ChildSwitcher } from "@tarragon/shared";
import { controllerFor } from "@/components/private-section/use-private-lock";

/**
 * The web side of "switching child relocks the mother's section" (S68b review fix). One switcher per account for the page session, using the
 * same per-account lock controller the PrivateSection uses. `ChildSwitchLink` relocks on the click that starts a switch; the panel also tells the
 * switcher which child is on screen, so a change that did not come through a link (the back button) relocks as well.
 */
const switchers = new Map<string, ChildSwitcher>();

export function getChildSwitcher(accountId: string): ChildSwitcher {
  let s = switchers.get(accountId);
  if (!s) {
    s = createChildSwitcher(() => void controllerFor(accountId).lock());
    switchers.set(accountId, s);
  }
  return s;
}

export function ChildSwitchLink({ accountId, href, className, children }: { accountId: string; href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={className} onClick={() => getChildSwitcher(accountId).leave()}>
      {children}
    </Link>
  );
}
