import { parseQuote } from "@tarragon/commerce";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { catalogueItemSchema } from "@/lib/commerce/model";
import { IncludedView } from "./included-view";

export const metadata = { title: "What is included" };
export const dynamic = "force-dynamic";

const CODE = /^[a-z][a-z0-9_]{2,63}$/;

export default async function IncludedPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { uiLanguage } = await getPatientDashboardContext();
  let item = null;
  let yours: number | null = null;
  if (CODE.test(code)) {
    const supabase = await createClient();
    // same visibility as the shop: an item that is not on sale shows nothing, so no price is shown before launch
    const { data } = await supabase.rpc("catalogue_item", { p_code: code });
    const parsed = catalogueItemSchema.safeParse(data);
    if (parsed.success) {
      item = parsed.data;
      const { data: q } = await supabase.rpc("price_quote", { p_code: code });
      yours = parseQuote(q)?.amountDueKobo ?? null;
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader title="What is included" icon={SEMANTIC_ICON.billing} backTo={{ href: "/patient/membership", label: "Membership" }} />
      <IncludedView item={item} yourPriceKobo={yours} locale={uiLanguage} />
    </div>
  );
}
