import Link from "next/link";
import { link } from "./ui";

const ITEMS = [
  { href: "/admin/community", label: "Overview" },
  { href: "/admin/community/groups", label: "Groups" },
  { href: "/admin/community/topics", label: "Topics" },
  { href: "/admin/community/prompts", label: "Group prompts" },
  { href: "/admin/community/staff", label: "Moderators and reviewers" },
  { href: "/admin/community/rules", label: "Filter rules" },
  { href: "/admin/community/pinned", label: "Pinned notes" },
  { href: "/admin/community/unmask", label: "Look up a member" },
] as const;

export function CommunityNav() {
  return (
    <nav aria-label="Community administration" className="mb-6">
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {ITEMS.map((i) => <li key={i.href}><Link href={i.href} className={link}>{i.label}</Link></li>)}
      </ul>
    </nav>
  );
}

export function LoadFailed({ what }: { what: string }) {
  return <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{what} could not be loaded. Please reload the page. If it keeps happening, you may not have access.</p>;
}
