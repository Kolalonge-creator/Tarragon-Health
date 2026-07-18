import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type PartnerLink = { href: string; title: string; description: string; permission: string };

const PARTNER_LINKS: PartnerLink[] = [
  { href: "/admin/settings/partners/labs", title: "Labs", description: "Lab providers patients can book with.", permission: "partners.labs.manage" },
  { href: "/admin/settings/partners/pharmacies", title: "Pharmacies", description: "Partner pharmacies and their contact details.", permission: "partners.pharmacies.manage" },
  { href: "/admin/facilities", title: "Facilities & hospitals", description: "Facilities, hospitals and clinics.", permission: "partners.facilities.manage" },
  { href: "/admin/settings/partners/specialists", title: "Specialists", description: "Specialist referral providers.", permission: "partners.specialists.manage" },
  { href: "/admin/settings/logistics-partners", title: "Home visit & delivery", description: "Home sample-collection and courier partners.", permission: "partners.home_visit.manage" },
];

export default async function PartnersIndexPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const { isSuperAdmin, keys } = await getCallerPermissions();
  const visible = PARTNER_LINKS.filter(
    (l) => isSuperAdmin || keys.has(l.permission) || (l.permission === "partners.home_visit.manage" && keys.has("partners.logistics.manage"))
  );
  if (visible.length === 0) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Partners</h1>
        <p className="text-charcoal-ink/60">
          Manage the partner network — labs, pharmacies, hospitals, specialists, and logistics.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((l) => (
          <Card key={l.href}>
            <CardHeader>
              <CardTitle>
                <Link href={l.href} className="hover:underline">
                  {l.title}
                </Link>
              </CardTitle>
              <CardDescription>{l.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={l.href} className="text-sm font-medium text-brand-green hover:underline">
                Manage →
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
