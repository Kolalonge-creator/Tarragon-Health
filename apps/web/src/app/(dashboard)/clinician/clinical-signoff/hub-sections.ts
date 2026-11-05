import type { ReactNode } from "react";
import type { BadgeProps } from "@/components/ui/badge";
import { SEVERITY_RANK, type SignoffQueueItem } from "@/lib/queries/signoff-queue";
import { signoffAnchorId } from "@/lib/signoff-anchor";

/** One compact line on the hub overview. The panel (the real signing form) opens under it. */
export type HubLine = {
  /** The page anchor, the same id every older link into the hub used, so deep links keep working. */
  id: string;
  key: string;
  title: string;
  detail: string;
  href: string;
  /** How many underlying things this one line stands for, when more than one. */
  count?: number;
  chip: { label: string; variant: NonNullable<BadgeProps["variant"]> };
  /** The inline signing panel, when this page can render one. Without it the line opens to a link to the item's own page. */
  panel?: ReactNode;
};

export type HubSection = {
  id: string;
  heading: string;
  hint: string;
  lines: HubLine[];
  /** Shown in place of the lines when the section is empty. */
  emptyText: string;
};

const SEVERITY_CHIP: Record<SignoffQueueItem["severity"], HubLine["chip"]> = {
  live_unsigned: { label: "Running, not signed", variant: "red" },
  draft_pending: { label: "Awaiting your signature", variant: "amber" },
  setup_needed: { label: "Needs setup first", variant: "grey" },
};

const OPERATIONAL_CHIP: HubLine["chip"] = { label: "Operational setting", variant: "grey" };
const LIVE_CHIP: HubLine["chip"] = { label: "Signed, running", variant: "green" };
const ATTENTION_CHIP: HubLine["chip"] = { label: "Needs a look", variant: "blue" };

function toLine(item: SignoffQueueItem, chip: HubLine["chip"], panels: Partial<Record<string, ReactNode>>): HubLine {
  return {
    id: signoffAnchorId(item.key),
    key: item.key,
    title: item.title,
    detail: item.detail,
    href: item.href,
    count: item.count,
    chip,
    panel: panels[item.key],
  };
}

/**
 * Turns the hub's lists into the overview sections, in the order the CMO reads them: what needs a signature (most urgent first),
 * operational settings, what is signed and running, then things that need attention but are not a signature. Pure, so it can be tested.
 */
export function buildHubSections(
  hub: { items: SignoffQueueItem[]; operational: SignoffQueueItem[]; live: SignoffQueueItem[]; attention: SignoffQueueItem[] },
  panels: Partial<Record<string, ReactNode>>,
): HubSection[] {
  // Stable sort: the reader already orders by urgency, this only guarantees "running without a signature" comes first.
  const awaiting = hub.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity] || a.index - b.index)
    .map(({ item }) => toLine(item, SEVERITY_CHIP[item.severity], panels));

  const sections: HubSection[] = [
    {
      id: "hub-awaiting",
      heading: "Awaiting your signature",
      hint: "Clinical protocols on the patient-harm list. Open a line to read it and sign.",
      lines: awaiting,
      emptyText: "Nothing is waiting on your signature.",
    },
    {
      id: "hub-operational",
      heading: "Operational settings",
      hint: "Versioned and audited, but not clinical protocols. No signature is owed and nothing live waits on them.",
      lines: hub.operational.map((item) => toLine(item, OPERATIONAL_CHIP, panels)),
      emptyText: "No operational settings are waiting.",
    },
    {
      id: "hub-live",
      heading: "Signed and running",
      hint: "Nothing to sign. Open one to see it or switch it off.",
      lines: hub.live.map((item) => toLine(item, LIVE_CHIP, panels)),
      emptyText: "Nothing signed is running a switch right now.",
    },
  ];

  if (hub.attention.length > 0) {
    sections.push({
      id: "hub-attention",
      heading: "Needs your attention",
      hint: "Not a signature. Each opens to the page where it is dealt with.",
      lines: hub.attention.map((item) => toLine(item, ATTENTION_CHIP, panels)),
      emptyText: "",
    });
  }

  return sections;
}
