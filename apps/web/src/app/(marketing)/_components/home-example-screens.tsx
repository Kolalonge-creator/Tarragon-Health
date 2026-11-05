import { cn } from "@/lib/utils";

/**
 * Example app screens for the homepage, drawn in HTML with made-up data and
 * labelled "Example screen" on every one (founder decision W-02: real app
 * screens with synthetic data, never presented as a real patient).
 *
 * Drawn rather than screenshotted on purpose: the existing captures show a
 * composite "87/100" health score, which the Tarragon 2.0 brief retired (no
 * composite score until one is validated), and a test account with empty
 * values. Drawn screens stay sharp at every size, weigh nothing, and can be
 * kept in step with the product. Each one shows only things the app does
 * today: a preventive plan, a result trend under doctor review, a written
 * doctor review, and request forms for any laboratory.
 *
 * No badge here claims a doctor reviewed anything: CLAUDE.md allows that
 * claim only from a real reviewed_by record (and a 2026-11-03 pass already
 * removed a "Doctor reviewed" badge from an illustrative preview), so the
 * example tags say "New note" or "Doctor to review", never "Reviewed".
 *
 * Not interactive and hidden from assistive technology except for a single
 * description, so a screen reader hears one sentence, not a fake app.
 */
export type ExampleScreen = "today" | "plan" | "trend" | "review";

const DESCRIPTIONS: Record<ExampleScreen, string> = {
  today: "Example screen: a member's home page showing an HbA1c result with a new note and a kidney function test that is due.",
  plan: "Example screen: a preventive plan listing this year's tests.",
  trend: "Example screen: an HbA1c trend over four tests, rising from 5.8 to 6.7 percent, marked for doctor review.",
  review: "Example screen: a plain-English explanation of a kidney function result, with a next step.",
};

function Tag({ tone = "green", children }: { tone?: "green" | "amber"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold",
        tone === "green" ? "bg-[#e8f1ec] text-[#165b3f]" : "bg-[#fdf0da] text-[#7a4a00]"
      )}
    >
      {children}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mx-2.5 mt-2.5 rounded-xl border border-[#e6e8e6] p-2.5">{children}</div>;
}

function Screen({ screen }: { screen: ExampleScreen }) {
  switch (screen) {
    case "today":
      return (
        <>
          <Top title="Good morning, Ada" subtitle="Your plan for November" />
          <Card>
            <Tag>New note</Tag>
            <p className="mt-1.5 font-semibold">HbA1c result</p>
            <p>Your care team added a note</p>
          </Card>
          <Card>
            <Tag tone="amber">Due this month</Tag>
            <p className="mt-1.5 font-semibold">Kidney function test</p>
            <p>Request form ready to download</p>
          </Card>
          <Card>
            <p className="font-semibold">Monthly doctor meeting</p>
            <p>Thursday, 10:30</p>
          </Card>
        </>
      );
    case "plan":
      return (
        <>
          <Top title="Your preventive plan" subtitle="Your checks for this year" />
          <Card>
            <p className="font-semibold">This year</p>
            <p>Full blood count, HbA1c, lipids, kidney function</p>
          </Card>
          <Card>
            <p className="font-semibold">Because of your family history</p>
            <p>Urine albumin check</p>
          </Card>
          <Card>
            <Tag>Done</Tag> <span>Blood pressure, weight, waist</span>
          </Card>
        </>
      );
    case "trend":
      return (
        <>
          <Top title="HbA1c" subtitle="Last 12 months" />
          <Card>
            <svg viewBox="0 0 220 112" className="block h-auto w-full">
              <rect x="24" y="14" width="190" height="36" fill="#fdf0da" />
              <line x1="24" y1="50" x2="214" y2="50" stroke="#e3e6e4" />
              <line x1="24" y1="86" x2="214" y2="86" stroke="#e3e6e4" />
              <text x="0" y="53" fontSize="9" fill="#5e6b66">6.5</text>
              <text x="0" y="89" fontSize="9" fill="#5e6b66">5.7</text>
              <polyline points="34,80 94,70 154,56 204,42" fill="none" stroke="#0b5d45" strokeWidth="2.5" />
              <circle cx="34" cy="80" r="3.5" fill="#0b5d45" />
              <circle cx="94" cy="70" r="3.5" fill="#0b5d45" />
              <circle cx="154" cy="56" r="3.5" fill="#0b5d45" />
              <circle cx="204" cy="42" r="4.5" fill="#e0a23b" />
              <text x="26" y="104" fontSize="9" fill="#5e6b66">Jan</text>
              <text x="86" y="104" fontSize="9" fill="#5e6b66">Apr</text>
              <text x="146" y="104" fontSize="9" fill="#5e6b66">Jul</text>
              <text x="194" y="104" fontSize="9" fill="#5e6b66">Oct</text>
            </svg>
          </Card>
          <Card>
            <Tag tone="amber">Doctor to review</Tag>
            <p className="mt-1.5">Rising over four tests</p>
          </Card>
        </>
      );
    case "review":
      return (
        <>
          <Top title="Your result explained" subtitle="Kidney function, 3 October" />
          <Card>
            <Tag>New</Tag>
            <p className="mt-1.5">
              Your results are in the expected range. Keep taking your blood pressure medicine and repeat this test in a year.
            </p>
          </Card>
          <Card>
            <p className="font-semibold">Next step</p>
            <p>Book your monthly meeting</p>
          </Card>
        </>
      );
  }
}

function Top({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="bg-[#0b5d45] px-3 pb-3 pt-4 text-white">
      <p className="text-[13px] font-semibold">{title}</p>
      <p>{subtitle}</p>
    </div>
  );
}

export function ExamplePhone({ screen, className }: { screen: ExampleScreen; className?: string }) {
  return (
    <div role="img" aria-label={DESCRIPTIONS[screen]} className={cn("rounded-[30px] bg-[#111] p-2 shadow-2xl shadow-black/25", className)}>
      <div aria-hidden className="overflow-hidden rounded-[22px] bg-white pb-1 font-sans text-[11px] leading-snug text-[#1d2522]">
        <Screen screen={screen} />
        <p className="py-2 text-center text-[10px] text-[#5e6b66]">Example screen</p>
      </div>
    </div>
  );
}
