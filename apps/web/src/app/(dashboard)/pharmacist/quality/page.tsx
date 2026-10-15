import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PartnerQualityCard } from "@/components/partner-portal/quality-card";
import { ActionForm } from "@/components/partner-portal/action-form";
import { declareSourcingAction } from "@/lib/partner-network/actions";
import { partnerQualitySchema } from "@/lib/partner-network/model";

export const metadata = { title: "Your quality check" };
export const dynamic = "force-dynamic";

const sourcingSchema = z.array(z.object({ statement: z.string().nullable(), declared_at: z.string().nullable(), verified_at: z.string().nullable(), review_due_at: z.string().nullable(), is_verified: z.boolean().nullable() }));

export default async function PharmacistQualityPage() {
  const supabase = loose(await createClient());
  const [q, s] = await Promise.all([supabase.rpc("partner_my_quality"), supabase.rpc("pharmacist_my_sourcing")]);
  const quality = q.error ? null : partnerQualitySchema.safeParse(q.data);
  const sourcing = s.error ? null : sourcingSchema.safeParse(s.data);
  const row = sourcing?.success ? sourcing.data[0] : undefined;
  return (
    <div className="space-y-6">
      {quality?.success ? <PartnerQualityCard q={quality.data} /> : <p role="alert" className="text-sm text-red-600">Your quality check could not be loaded. This is not the same as there being nothing to show.</p>}
      <Card>
        <CardHeader><CardTitle>Where your medicines come from</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-charcoal-ink/70">
            Tell us which NAFDAC-registered distributors and manufacturers you buy from. A member of the Tarragon team checks it against your supplier invoices and the NAFDAC register. This is a check of your sources; it is not a guarantee about any single batch.
          </p>
          {sourcing && !sourcing.success && <p role="alert" className="text-red-600">This could not be loaded.</p>}
          {row && (
            <p>
              <Badge variant={row.is_verified ? "green" : row.declared_at ? "amber" : "grey"}>{row.is_verified ? "Checked by Tarragon" : row.declared_at ? "Declared, waiting for a check" : "Not declared yet"}</Badge>
              {row.statement && <span className="mt-2 block text-charcoal-ink/80">{row.statement}</span>}
            </p>
          )}
          <ActionForm
            action={declareSourcingAction}
            fields={[{ name: "statement", label: "Your registered suppliers", kind: "textarea", placeholder: "For example: we buy from ... (NAFDAC-registered distributor) and ...", hint: "20 to 500 characters. Saving a new version asks Tarragon to check again." }]}
            submitLabel="Save and ask for a check"
            successText="Saved. A member of the team will check it."
          />
        </CardContent>
      </Card>
    </div>
  );
}
