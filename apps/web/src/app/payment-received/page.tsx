/**
 * Where Paystack sends someone back after paying a pay link made by a Care Coordinator (booking by phone). The payer may be the patient
 * or a relative, signed in or not, so this page asks for nothing and shows nothing about anyone: the payment is recorded by Paystack's
 * confirmation to the platform, and the appointment confirms itself from that, not from this page.
 */
export default function PaymentReceivedPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-3 px-4 py-12 text-center">
      <h1 className="text-xl font-semibold text-charcoal-ink">Thank you, your payment was received</h1>
      <p className="text-sm text-charcoal-ink/70">
        The care team will confirm the appointment time. Once it is confirmed it shows in the patient&apos;s Tarragon app under Appointments,
        and the care team will call if anything is needed. If the time is no longer free, the payment is kept as credit for the patient.
      </p>
    </main>
  );
}
