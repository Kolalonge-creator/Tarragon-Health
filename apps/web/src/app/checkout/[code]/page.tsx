import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPaymentRequestCode } from "@tarragon/commerce";
import { PaymentRequestView } from "./payment-request-view";

export const metadata: Metadata = {
  title: "Pay a request — Tarragon Health",
  robots: { index: false, follow: false },
};

/**
 * main-dev retired guest checkout (the two-tier platform change, #1067), so this route no longer sells a product by code. It stays only for S72 (19.13): a supporter's
 * payment request link. The code is unguessable and is not a product code. Anything that is not a payment request code is a 404.
 */
export default async function PaymentRequestPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  if (!isPaymentRequestCode(code)) {
    notFound();
  }
  return <PaymentRequestView code={code} />;
}
