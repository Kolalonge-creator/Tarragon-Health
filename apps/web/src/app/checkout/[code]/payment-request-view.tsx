import Link from "next/link";
import { en, t } from "@tarragon/i18n";
import { formatNaira, itemiseCheckout, previewQuote, previewMessageKey, type FeeEstimateSchedule } from "@tarragon/commerce";
import { getProposedConfig, type ConfigValue } from "@tarragon/shared";
import { GuardLeafMark } from "@/components/brand/guard-leaf-mark";
import { itemLabel } from "@/lib/commerce/item-label";
import { formatPatientDate } from "@/lib/format-date";
import { loadPaymentRequestPreview } from "@/lib/payment-request/preview";
import { createClient } from "@/lib/supabase/server";
import { PayFromRequest } from "./pay-from-request";

const MUTED = "text-charcoal-ink/70";

/**
 * The page a supporter opens from a payment request link (S72, 19.13). It shows ONLY a generic item name and the price, itemised: never a condition, a reason,
 * a name or anything about the person who asked (INV-07). A link that is expired, cancelled, used or unknown says so in plain words and offers nothing else.
 */
export async function PaymentRequestView({ code }: { code: string }) {
  const preview = await loadPaymentRequestPreview(code);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const signedIn = Boolean(auth.user);
  const fee = getProposedConfig<ConfigValue>("commerce.processing_fee_estimate").value as unknown as FeeEstimateSchedule;
  const redirect = encodeURIComponent(`/checkout/${code}`);

  return (
    <div className="flex flex-1 items-center justify-center bg-white px-4 py-12 sm:py-16">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center">
          <GuardLeafMark className="h-11 w-11" />
          <p className="mt-3 font-heading text-2xl font-semibold text-charcoal-ink">
            Tarragon<span className="text-brand-green">Health</span>
          </p>
        </div>
        <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7 space-y-4">
          <h1 className="font-heading text-xl font-semibold text-charcoal-ink">{t("request.page.title", "en")}</h1>
          {preview.status === "open" ? (
            <OpenLink preview={preview} fee={fee} code={code} signedIn={signedIn} redirect={redirect} />
          ) : (
            <p role="status" className={MUTED}>{t(previewMessageKey(preview.status) as keyof typeof en, "en")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function OpenLink({ preview, fee, code, signedIn, redirect }: {
  preview: Extract<Awaited<ReturnType<typeof loadPaymentRequestPreview>>, { status: "open" }>;
  fee: FeeEstimateSchedule; code: string; signedIn: boolean; redirect: string;
}) {
  const name = itemLabel(preview.nameKey, "", "en");
  const itemised = itemiseCheckout({ quote: previewQuote("payment_request", preview.amountKobo), components: preview.components, fee });
  const naira = (kobo: number) => `₦${formatNaira(kobo)}`;
  return (
    <>
      <section aria-labelledby="pr-what" className="space-y-1">
        <h2 id="pr-what" className="font-medium text-charcoal-ink">{t("request.page.what", "en")}</h2>
        <p className="text-charcoal-ink">{name}</p>
      </section>
      <section aria-labelledby="pr-price" className="space-y-2">
        <h2 id="pr-price" className="font-medium text-charcoal-ink">{t("checkout.itemised.title", "en")}</h2>
        {itemised ? (
          <>
            <ul className="space-y-1">
              {itemised.lines.map((l, i) => (
                <li key={`${l.kind}-${i}`} className="flex justify-between gap-3 text-charcoal-ink">
                  <span>{Object.hasOwn(en, l.labelKey) ? t(l.labelKey as keyof typeof en, "en") : ""}</span>
                  <span>{l.estimate ? t("shop.fee.about", "en", { amount: naira(l.amountKobo) }) : naira(l.amountKobo)}</span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between font-semibold text-charcoal-ink">
              <span>{t("checkout.total", "en")}</span>
              <span>{t("shop.fee.about", "en", { amount: naira(itemised.totalKobo) })}</span>
            </p>
            <p className={`text-sm ${MUTED}`}>{t("checkout.itemised.note", "en")}</p>
          </>
        ) : (
          <p className="text-charcoal-ink">{naira(preview.amountKobo)}</p>
        )}
      </section>
      <p className={`text-sm ${MUTED}`}>{t("request.page.valid_until", "en", { date: formatPatientDate(preview.expiresAt) })}</p>
      <p className={`text-sm ${MUTED}`}>{t("request.page.pay_with_own", "en")}</p>
      {signedIn ? (
        <PayFromRequest code={code} />
      ) : (
        <div className="space-y-2">
          <Link href={`/login?redirect=${redirect}`} className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand-green px-4 py-2 font-medium text-white">
            {t("request.page.sign_in", "en")}
          </Link>
        </div>
      )}
    </>
  );
}
