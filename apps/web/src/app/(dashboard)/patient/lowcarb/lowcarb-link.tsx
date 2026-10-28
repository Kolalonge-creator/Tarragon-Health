import Link from "next/link";
import { t } from "@tarragon/i18n";
import { parseLowCarbGate } from "@tarragon/clinical/lowcarb-programme";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";

/**
 * S50b: one quiet link to the supported eating programme, shown ONLY to someone a clinician has offered it. Everyone else sees nothing at all: the
 * programme is never advertised. If the door cannot be asked, nothing is shown (the screen itself asks again).
 */
export async function LowCarbLink() {
  const { data, error } = await (await createClient()).rpc("my_lowcarb_gate");
  if (error || parseLowCarbGate(data).state !== "ok") return null;
  return (
    <Card>
      <CardContent className="pt-6">
        <Link href="/patient/lowcarb" className="text-sm font-medium text-brand-green underline hover:no-underline dark:text-brand-green-bright">
          {t("lowcarb.title")}
        </Link>
      </CardContent>
    </Card>
  );
}
