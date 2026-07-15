import type { Metadata } from "next";
import { MarketingNav } from "./_components/marketing-nav";
import { MarketingFooter } from "./_components/marketing-footer";

export const metadata: Metadata = {
  title: {
    default: "TarragonHealth — Care that stays with you",
    template: "%s — TarragonHealth",
  },
  description:
    "Doctor-led health monitoring for you, your parents, and your loved ones. Track blood pressure, blood sugar, medication, and preventive health in one secure platform.",
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-warm-ivory text-charcoal-ink">
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
