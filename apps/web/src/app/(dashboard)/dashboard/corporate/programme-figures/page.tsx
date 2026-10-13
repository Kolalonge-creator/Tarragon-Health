import { SponsorFiguresPanel } from "@/components/sponsor-figures-panel";

export const metadata = { title: "Programme figures" };
export const dynamic = "force-dynamic";

/** Group figures for the programmes Tarragon runs for this organisation (S38f). Aggregate only; see SponsorFiguresPanel. */
export default function ProgrammeFiguresPage() {
  return <SponsorFiguresPanel basePath="/dashboard/corporate/programme-figures" />;
}
