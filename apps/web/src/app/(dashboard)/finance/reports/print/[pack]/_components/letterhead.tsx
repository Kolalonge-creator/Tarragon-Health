"use client";

import Image from "next/image";
import { useCompanyProfile } from "@/lib/finance/queries";

export function ReportLetterhead({ title, subtitle }: { title: string; subtitle: string }) {
  const { data: profile } = useCompanyProfile();

  const generatedAt = new Date().toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const idLine = [
    profile?.rc_number && `RC ${profile.rc_number}`,
    profile?.tin && `TIN ${profile.tin}`,
    profile?.vat_registration_number && `VAT ${profile.vat_registration_number}`,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <header className="mb-6 border-b-2 border-clinical-navy pb-4 print-avoid-break">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image src="/brand/guard-leaf-mark.png" alt="" width={36} height={36} className="h-9 w-9 shrink-0" />
          <div>
            <p className="font-heading text-lg font-semibold text-deep-forest">
              {profile?.legal_name || profile?.trading_name || "TarragonHealth"}
            </p>
            {idLine && <p className="text-xs text-charcoal-ink/60">{idLine}</p>}
            {profile?.registered_address && (
              <p className="max-w-md text-xs text-charcoal-ink/50">{profile.registered_address}</p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-charcoal-ink/50">
          <p>Generated {generatedAt}</p>
          <p>Not a lodged filing, for internal use</p>
        </div>
      </div>
      <div className="mt-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{title}</h1>
        <p className="text-sm text-charcoal-ink/60">{subtitle}</p>
      </div>
    </header>
  );
}
