"use client";

import Link from "next/link";
import { t, type Locale } from "@tarragon/i18n";
import { useSupportedPeople as useCirclePeople } from "@/lib/queries/care-circle";
import { useSupportedPeople as useSponsoredPeople } from "@/lib/queries/sponsorship";
import { cn } from "@/lib/utils";

/**
 * A two-way switch between the person's own health and the people they support, for an account that is both. Two plain links in a
 * segmented control (each a full 44px target), the current one marked with aria-current, no animation beyond a colour change.
 */
export function CareModeSwitch({ active, locale }: { active: "mine" | "supporting"; locale: Locale }) {
  const item = (mode: "mine" | "supporting", href: string, key: "supporterjoin.mode.mine" | "supporterjoin.mode.supporting") => (
    <Link
      href={href}
      aria-current={active === mode ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
        active === mode
          ? "bg-white text-charcoal-ink shadow-sm dark:bg-night-card dark:text-night-ink"
          : "text-charcoal-ink/75 hover:text-charcoal-ink dark:text-night-ink/75 dark:hover:text-night-ink",
      )}
    >
      {t(key, locale)}
    </Link>
  );
  return (
    <nav aria-label={t("supporterjoin.mode.label", locale)} className="w-full sm:w-auto">
      <div className="flex w-full gap-1 rounded-full bg-charcoal-ink/[0.06] p-1 sm:inline-flex sm:w-auto dark:bg-night-ink/10">
        {item("mine", "/patient", "supporterjoin.mode.mine")}
        {item("supporting", "/patient/supporting", "supporterjoin.mode.supporting")}
      </div>
    </nav>
  );
}

/** The switch on the person's own home, shown only once they actually support somebody (a Care Circle or someone they pay for). */
export function CareModeSwitchIfSupporting({ locale }: { locale: Locale }) {
  const circle = useCirclePeople();
  const sponsored = useSponsoredPeople();
  const supportsSomeone = (circle.data?.length ?? 0) > 0 || (sponsored.data?.length ?? 0) > 0;
  if (!supportsSomeone) return null;
  return <CareModeSwitch active="mine" locale={locale} />;
}
