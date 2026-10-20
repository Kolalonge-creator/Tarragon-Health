import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getOpsDeskOverview } from "@/lib/ops-desk/queries";
import { opsDeskReadinessText } from "@/lib/ops-desk/readiness";

/** The ops desk line on the go-live readiness pages. Never throws: a failed read says so instead of looking like an all-clear. */
export async function OpsDeskReadinessLine({ href }: { href: "/admin/ops/desk" | "/clinician/ops-desk" }) {
  let line: { tone: "green" | "amber" | "red"; text: string } | null = null;
  try {
    line = opsDeskReadinessText(await getOpsDeskOverview(30));
  } catch {
    line = null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-charcoal-ink/10 bg-white px-4 py-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
      <span className="font-medium">Ops desk (expired pages)</span>
      {line ? <Badge variant={line.tone}>{line.text}</Badge> : <Badge variant="red">Could not be read</Badge>}
      <Link className="underline" href={href}>Open the ops desk</Link>
    </div>
  );
}
