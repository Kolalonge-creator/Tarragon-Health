import type { Metadata } from "next";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { loadEmergencyDatasetForPatient } from "@/lib/emergency/dataset";
import { buildEmergencyQrText } from "@/lib/emergency/qr-text";
import { emergencyTextQrSvg } from "@/lib/emergency/qr-render";
import { EmergencyCardBody } from "@/components/emergency/emergency-card-body";
import { PrintButton } from "./print-button";

/**
 * "Be the record they carry into any hospital" — the DEFAULT way to get an
 * emergency card, as of the 2026-08-03 redesign.
 *
 * NO ANON ENDPOINT INVOLVED AT ALL. This page reads the patient's own data
 * through their own authenticated session — the exact same authorisation
 * level as Health Passport already needs, since nothing here differs from a
 * patient viewing their own record. There is no consent checkbox here because
 * there is nothing new to consent to: printing what you can already see about
 * yourself is not a third-party PHI exposure.
 *
 * The QR encodes PLAIN TEXT (see qr-text.ts), never a URL — any scanner app on
 * any phone shows it directly, no Tarragon app, no internet, no account
 * needed at the point of care. The live-link opt-in (`/emergency/[token]`) is
 * a separate, explicitly-consented extra reachable from the parent page.
 */

export const metadata: Metadata = {
  title: "Printable emergency card",
  robots: { index: false, follow: false, nocache: true },
};

export default async function EmergencyCardPrintPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const facts = await loadEmergencyDatasetForPatient(supabase, user.id);

  const printedOn = new Date().toLocaleDateString("en-GB", { timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const qrText = buildEmergencyQrText(facts, printedOn);
  const qrSvg = await emergencyTextQrSvg(qrText);

  return (
    <div>
      <div className="mx-auto max-w-2xl p-4 print:hidden">
        <PrintButton />
        <p className="mt-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Print this, fold it into your wallet, and keep it with you. There is nothing to consent
          to here. You are printing your own record, the same as your Health Passport.
        </p>
      </div>

      <EmergencyCardBody
        facts={facts}
        headerLabel="Emergency health card"
        headerSubline={`Printed ${printedOn}`}
        qrSlot={
          qrSvg ? (
            // Locally generated SVG from this server's own QR render — no user input reaches it.
            <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <p className="text-sm text-charcoal-ink/60">
              A QR code could not be generated. Every fact above is already printed in full. This
              only affects a machine-readable duplicate.
            </p>
          )
        }
        footer={
          <>
            <p>
              This is a summary you chose to keep with you, not your complete medical record, and
              it will not update itself once printed. Reprint after anything on it changes.
            </p>
            <p className="mt-1">
              Not a substitute for clinical assessment. Always confirm blood group by testing
              before transfusing.
            </p>
          </>
        }
      />
    </div>
  );
}
