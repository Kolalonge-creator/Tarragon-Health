import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { Card, CardContent } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { CONTRACEPTION_METHOD_KEYS } from "./methods";

export const metadata: Metadata = { title: "Contraception options" };

/**
 * Neutral contraception education (S66, 16.3, decision A13).
 *
 * A plain alphabetical list of methods with one factual line each: no ranking, no "best", no dosing, no advice about which to choose, and
 * fertility awareness is never presented as contraception. Emergency contraception is described factually. The only call to action is
 * to ask the care team. Every word comes from packages/i18n (cycle-copy.ts) and is PROPOSED copy awaiting CMO review.
 *
 * Behind the go-live guard `reproductive_content_enabled` (INV-14), which is OFF, so today a test account sees the page and a real
 * patient sees only the closed notice. The guard is a courtesy check here; nothing sensitive is returned by this page either way.
 */
export default async function ContraceptionPage() {
  await getPatientDashboardContext();
  const supabase = await createClient();
  const { data: open, error } = await supabase.rpc("go_live_guard_is_open", { p_key: "reproductive_content_enabled" });
  // Fails closed: a failed check is "not open", never "open".
  const isOpen = !error && open === true;

  return (
    <DashboardSection id="contraception" title={t("contraception.edu.title")} description={isOpen ? t("contraception.edu.intro") : undefined} icon={SEMANTIC_ICON.family}>
      {!isOpen ? (
        <Card variant="soft">
          <CardContent className="py-4 text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("contraception.edu.closed")}</CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card variant="soft">
            <CardContent className="py-4 text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("contraception.edu.not_tracking")}</CardContent>
          </Card>
          <ul className="space-y-3">
            {CONTRACEPTION_METHOD_KEYS.map((key) => (
              <li key={key} className="rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3 text-sm text-charcoal-ink dark:text-night-ink">
                {t(key)}
              </li>
            ))}
          </ul>
          <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("contraception.edu.cautions")}</p>
          <Card>
            <CardContent className="space-y-2 py-4">
              <h2 className="text-base font-semibold text-charcoal-ink dark:text-night-ink">{t("contraception.edu.emergency_title")}</h2>
              <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("contraception.edu.emergency_body")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 py-4">
              <h2 className="text-base font-semibold text-charcoal-ink dark:text-night-ink">{t("contraception.edu.refer_title")}</h2>
              <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("contraception.edu.refer_body")}</p>
              <Link href="/patient/messages" className="inline-block rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-brand-green/90">
                {t("contraception.edu.refer_button")}
              </Link>
            </CardContent>
          </Card>
        </div>
      )}
    </DashboardSection>
  );
}
