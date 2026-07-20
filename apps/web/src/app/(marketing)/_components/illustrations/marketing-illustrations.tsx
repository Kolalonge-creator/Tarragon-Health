import type { MarketingIllustrationId } from "../../_content/media";
import { cn } from "@/lib/utils";

type IllustrationProps = {
  className?: string;
};

/** Brand-aligned line illustrations: green/navy, calm Nigerian family care (docs/BRAND_GUIDE.md §8). */
export function MarketingIllustration({
  id,
  className,
}: {
  id: MarketingIllustrationId;
  className?: string;
}) {
  const shared = cn("h-full w-full", className);

  switch (id) {
    case "family-care":
      return <FamilyCareIllustration className={shared} />;
    case "fragmented-care":
      return <FragmentedCareIllustration className={shared} />;
    case "connected-care":
      return <ConnectedCareIllustration className={shared} />;
    case "clinician-follow-up":
      return <ClinicianFollowUpIllustration className={shared} />;
    case "hypertension":
      return <HypertensionIllustration className={shared} />;
    case "diabetes":
      return <DiabetesIllustration className={shared} />;
    case "parentcare":
      return <ParentCareIllustration className={shared} />;
    case "prevention":
      return <PreventionIllustration className={shared} />;
    default:
      return null;
  }
}

function FamilyCareIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 480 360" className={className} fill="none" aria-hidden>
      <rect width="480" height="360" rx="24" className="fill-soft-sage" />
      <circle cx="240" cy="180" r="120" className="fill-brand-green/10" />
      <path
        d="M80 280 C 120 220, 180 240, 240 200 S 360 160, 400 120"
        className="stroke-brand-green/30"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Parent figure */}
      <circle cx="160" cy="130" r="28" className="fill-clinical-navy/15" />
      <path
        d="M120 220 Q160 170 200 220"
        className="stroke-clinical-navy"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Adult child */}
      <circle cx="300" cy="110" r="26" className="fill-brand-green/20" />
      <path
        d="M265 210 Q300 165 335 210"
        className="stroke-brand-green"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Phone with vitals */}
      <rect x="318" y="168" width="72" height="120" rx="12" className="fill-white stroke-clinical-navy/20" strokeWidth="2" />
      <rect x="330" y="188" width="48" height="8" rx="4" className="fill-brand-green/30" />
      <path
        d="M332 220 L344 208 L356 216 L372 196"
        className="stroke-brand-green"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="330" y="240" width="36" height="6" rx="3" className="fill-charcoal-ink/10" />
      <rect x="330" y="254" width="48" height="6" rx="3" className="fill-charcoal-ink/10" />
      {/* WhatsApp bubble */}
      <rect x="290" y="248" width="88" height="36" rx="10" className="fill-brand-green/15" />
      <text x="304" y="270" className="fill-deep-forest text-[11px] font-medium">
        BP logged ✓
      </text>
    </svg>
  );
}

function FragmentedCareIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 480 360" className={className} fill="none" aria-hidden>
      <rect width="480" height="360" rx="24" className="fill-warm-ivory" />
      {[
        { x: 60, y: 70, label: "Missed dose", rotate: -6 },
        { x: 280, y: 55, label: "Overdue lab", rotate: 4 },
        { x: 140, y: 200, label: "Old reading", rotate: -3 },
        { x: 320, y: 190, label: "No follow-up", rotate: 5 },
      ].map(({ x, y, label, rotate }) => (
        <g key={label} transform={`translate(${x} ${y}) rotate(${rotate})`}>
          <rect width="120" height="72" rx="10" className="fill-white stroke-charcoal-ink/15" strokeWidth="2" strokeDasharray="6 4" />
          <text x="14" y="42" className="fill-charcoal-ink/50 text-[12px]">
            {label}
          </text>
        </g>
      ))}
      <path
        d="M240 300 L240 260 M220 280 L260 280"
        className="stroke-charcoal-ink/25"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <text x="188" y="322" className="fill-charcoal-ink/45 text-[13px]">
        Nothing connected
      </text>
    </svg>
  );
}

function ConnectedCareIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 480 360" className={className} fill="none" aria-hidden>
      <rect width="480" height="360" rx="24" className="fill-soft-sage" />
      <rect x="72" y="64" width="336" height="232" rx="16" className="fill-white stroke-brand-green/20" strokeWidth="2" />
      <rect x="96" y="88" width="120" height="64" rx="10" className="fill-brand-green/10" />
      <text x="108" y="112" className="fill-deep-forest text-[11px] font-semibold">
        Blood pressure
      </text>
      <text x="108" y="136" className="fill-clinical-navy text-[18px] font-bold">
        128/82
      </text>
      <rect x="232" y="88" width="120" height="64" rx="10" className="fill-clinical-navy/8" />
      <text x="244" y="112" className="fill-clinical-navy text-[11px] font-semibold">
        Medication
      </text>
      <text x="244" y="136" className="fill-clinical-navy text-[14px] font-semibold">
        On track
      </text>
      <rect x="96" y="168" width="256" height="48" rx="10" className="fill-sprout-gold/12" />
      <text x="112" y="198" className="fill-charcoal-ink text-[12px]">
        Preventive check due: book & review
      </text>
      <path
        d="M96 248 H352"
        className="stroke-brand-green/40"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {["Reading", "Review", "Reminder", "Family"].map((step, i) => (
        <g key={step} transform={`translate(${108 + i * 72} 260)`}>
          <circle r="14" className="fill-brand-green" />
          <text x="-10" y="36" className="fill-charcoal-ink/60 text-[10px]">
            {step}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ClinicianFollowUpIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 480 360" className={className} fill="none" aria-hidden>
      <rect width="480" height="360" rx="24" className="fill-clinical-navy/8" />
      <circle cx="240" cy="180" r="100" className="fill-brand-green/10" />
      {/* Clinician */}
      <circle cx="170" cy="140" r="30" className="fill-brand-green/25" />
      <path d="M130 230 Q170 185 210 230" className="stroke-brand-green" strokeWidth="3" strokeLinecap="round" />
      <rect x="148" y="168" width="44" height="20" rx="6" className="fill-white stroke-brand-green/30" strokeWidth="1.5" />
      {/* Patient on phone */}
      <circle cx="320" cy="150" r="28" className="fill-clinical-navy/15" />
      <path d="M285 235 Q320 195 355 235" className="stroke-clinical-navy" strokeWidth="3" strokeLinecap="round" />
      <rect x="300" y="175" width="40" height="64" rx="8" className="fill-white stroke-clinical-navy/20" strokeWidth="2" />
      <path
        d="M308 200 Q320 188 332 200"
        className="stroke-brand-green"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <text x="168" y="280" className="fill-charcoal-ink/55 text-[13px]">
        Calm follow-up call
      </text>
    </svg>
  );
}

function HypertensionIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 480 360" className={className} fill="none" aria-hidden>
      <rect width="480" height="360" rx="24" className="fill-soft-sage" />
      <ellipse cx="240" cy="200" rx="100" ry="48" className="fill-white stroke-clinical-navy/20" strokeWidth="2" />
      <rect x="200" y="168" width="80" height="64" rx="8" className="fill-clinical-navy/10" />
      <path
        d="M120 200 H360"
        className="stroke-brand-green"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="120" cy="200" r="10" className="fill-brand-green" />
      <path
        d="M200 120 L220 160 L200 200 L240 200 L260 160 L280 200"
        className="stroke-brand-green"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="168" y="280" className="fill-clinical-navy text-[14px] font-semibold">
        Track BP trends between visits
      </text>
    </svg>
  );
}

function DiabetesIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 480 360" className={className} fill="none" aria-hidden>
      <rect width="480" height="360" rx="24" className="fill-warm-ivory" />
      <path
        d="M240 80 C260 80 270 110 240 150 C210 110 220 80 240 80 Z"
        className="fill-brand-green/20 stroke-brand-green"
        strokeWidth="2"
      />
      <rect x="160" y="170" width="160" height="100" rx="12" className="fill-white stroke-brand-green/25" strokeWidth="2" />
      <text x="180" y="200" className="fill-deep-forest text-[12px] font-semibold">
        HbA1c trend
      </text>
      <path
        d="M180 250 L210 230 L240 238 L270 215 L300 220"
        className="stroke-brand-green"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="300" cy="220" r="5" className="fill-brand-green" />
    </svg>
  );
}

function ParentCareIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 480 360" className={className} fill="none" aria-hidden>
      <rect width="480" height="360" rx="24" className="fill-soft-sage" />
      <circle cx="180" cy="130" r="32" className="fill-clinical-navy/12" />
      <circle cx="300" cy="110" r="28" className="fill-brand-green/20" />
      <path d="M145 220 Q180 175 215 220" className="stroke-clinical-navy" strokeWidth="3" strokeLinecap="round" />
      <path d="M265 210 Q300 170 335 210" className="stroke-brand-green" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M215 220 Q240 200 265 210"
        className="stroke-brand-green/50"
        strokeWidth="2"
        strokeDasharray="4 4"
      />
      <rect x="156" y="248" width="168" height="56" rx="12" className="fill-white stroke-brand-green/20" strokeWidth="2" />
      <text x="172" y="282" className="fill-charcoal-ink text-[12px]">
        Follow-up: this week&apos;s readings looked steady
      </text>
    </svg>
  );
}

function PreventionIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 480 360" className={className} fill="none" aria-hidden>
      <rect width="480" height="360" rx="24" className="fill-warm-ivory" />
      <path
        d="M240 70 L290 95 V145 C290 195 240 230 240 230 C240 230 190 195 190 145 V95 Z"
        className="fill-brand-green/15 stroke-brand-green"
        strokeWidth="2.5"
      />
      <path
        d="M220 150 L235 168 L265 128"
        className="stroke-brand-green"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="120" y="250" width="240" height="48" rx="10" className="fill-sprout-gold/15" />
      <text x="136" y="280" className="fill-charcoal-ink text-[12px]">
        Screen early · follow up when needed
      </text>
    </svg>
  );
}
