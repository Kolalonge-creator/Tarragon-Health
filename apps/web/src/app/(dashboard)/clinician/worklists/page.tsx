import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WORKLIST_TITLES, loadWorklist } from "@/lib/security/worklists";

export const metadata = { title: "Shared work queues" };
export const dynamic = "force-dynamic";

/** The shared queues across the organisation: who, what and when only. The detail opens in the patient's chart, which is logged. */
export default async function ClinicianWorklists() {
  const staff = await getCurrentClinicalStaff();
  if (!staff) redirect("/clinician");
  const supabase = await createClient();
  const result = await loadWorklist(supabase);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Shared work queues</h1>
        <p className="text-sm text-charcoal-ink/60">
          Open items for every patient in your organisation, so nothing waits because nobody is tied to the patient. Open the patient to see the detail; each opening is logged.
        </p>
      </div>
      {!result.ok ? (
        <p className="text-sm text-red-700">The queues could not be loaded: {result.message}</p>
      ) : (
        result.groups.map((g) => (
          <Card key={g.kind}>
            <CardHeader><CardTitle>{WORKLIST_TITLES[g.kind]} ({g.items.length})</CardTitle></CardHeader>
            <CardContent>
              {g.items.length === 0 ? (
                <p className="text-sm text-charcoal-ink/60">Nothing waiting.</p>
              ) : (
                <ul className="divide-y">
                  {g.items.map((i) => (
                    <li key={i.item_id} className="flex items-center justify-between py-2 text-sm">
                      <Link href={`/clinician/patients/${i.patient_id}`} className="font-medium underline">{i.patient_name ?? "Unnamed patient"}</Link>
                      <span className="text-xs text-charcoal-ink/60">{[i.patient_number, i.item_date ? new Date(i.item_date).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" }) : null].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
