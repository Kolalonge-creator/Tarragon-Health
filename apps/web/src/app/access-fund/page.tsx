import type { Metadata } from "next";
import Link from "next/link";
import { en, t, type MessageKey } from "@tarragon/i18n";
import { formatNaira, parseFundReport } from "@tarragon/commerce";
import { GuardLeafMark } from "@/components/brand/guard-leaf-mark";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { DonateForm } from "./donate-form";

export const metadata: Metadata = {
  title: "Community Access Fund | Tarragon Health",
  description: "Gifts that help pay for care for people who cannot afford it, with the figures published openly.",
};
export const dynamic = "force-dynamic";

const MUTED = "text-charcoal-ink/70";
const naira = (kobo: number) => `₦${formatNaira(kobo)}`;
const say = (key: string, params?: Record<string, string | number>) => (Object.hasOwn(en, key) ? t(key as MessageKey, "en", params) : "");

async function loadReport() {
  const ip = await getClientIp();
  const limited = await rateLimit(`fund:report:${ip}`, { limit: 60, windowSeconds: 600 });
  if (!limited.success) return parseFundReport(null);
  try {
    const { data, error } = await createServiceRoleClient().rpc("access_fund_public_report");
    return error ? parseFundReport(null) : parseFundReport(data);
  } catch {
    return parseFundReport(null);
  }
}

/**
 * The Community Access Fund (S72, 19.11): public, transparent, aggregate only. The figures come from one database function that leaves out test data,
 * withholds any group smaller than the platform minimum (and the totals with it if a subtraction could recover it), and never carries a person, an order or a
 * reason. A gift is a pledge confirmed by our team when a bank transfer arrives; nothing is charged here. A gift is never a balance anyone can spend.
 */
export default async function AccessFundPage() {
  const report = await loadReport();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const signedIn = Boolean(auth.user);

  return (
    <div className="flex flex-1 justify-center bg-white px-4 py-12 sm:py-16">
      <main className="w-full max-w-2xl space-y-8">
        <div className="flex flex-col items-center text-center">
          <GuardLeafMark className="h-11 w-11" />
          <h1 className="mt-3 font-heading text-2xl font-semibold text-charcoal-ink">{say("fund.title")}</h1>
          <p className={`mt-2 ${MUTED}`}>{say("fund.intro")}</p>
        </div>

        <section aria-labelledby="criteria" className="space-y-2">
          <h2 id="criteria" className="font-heading text-lg font-semibold text-charcoal-ink">{say("fund.criteria.title")}</h2>
          <p className={MUTED}>{say("fund.criteria.intro")}</p>
          <ul className="list-disc space-y-1 pl-5 text-charcoal-ink">
            {report.criteria.map((c) => (<li key={c}>{say(`fund.criteria.${c}`)}</li>))}
          </ul>
        </section>

        {!report.open ? (
          <p role="status" className={MUTED}>{say("fund.not_open")}</p>
        ) : (
          <>
            <section aria-labelledby="report" className="space-y-2">
              <h2 id="report" className="font-heading text-lg font-semibold text-charcoal-ink">{say("fund.report.title")}</h2>
              {report.donations.withheld ? (
                <p className={MUTED}>{say("fund.report.withheld", { min: report.minCell })}</p>
              ) : (
                <p className="text-charcoal-ink">{say("fund.report.donations", { count: report.donations.count, amount: naira(report.donations.totalKobo) })}</p>
              )}
              {report.grants.withheld ? (
                <p className={MUTED}>{say("fund.report.withheld", { min: report.minCell })}</p>
              ) : (
                <>
                  {report.grants.count !== null && report.grants.totalKobo !== null ? (
                    <p className="text-charcoal-ink">{say("fund.report.grants", { count: report.grants.count, amount: naira(report.grants.totalKobo) })}</p>
                  ) : (
                    <p className={MUTED}>{say("fund.report.totals_withheld")}</p>
                  )}
                  <ul className="space-y-1 text-charcoal-ink">
                    {report.grants.cells.map((c) => (
                      <li key={c.kind}>{say("fund.report.by_kind", { count: c.count, kind: say(`fund.kind.${c.kind}`) || say("fund.kind.other"), amount: naira(c.totalKobo) })}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section aria-labelledby="give" className="space-y-3">
              <h2 id="give" className="font-heading text-lg font-semibold text-charcoal-ink">{say("fund.give.title")}</h2>
              {signedIn ? (
                <DonateForm />
              ) : (
                <Link href="/login?redirect=%2Faccess-fund" className="inline-flex min-h-11 items-center rounded-md bg-brand-green px-4 py-2 font-medium text-white">
                  {say("fund.give.sign_in")}
                </Link>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
