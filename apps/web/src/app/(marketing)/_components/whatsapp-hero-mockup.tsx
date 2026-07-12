/** Signature hero visual — WhatsApp is the primary patient channel (CLAUDE.md). Pure CSS animation, no client JS. */

const MESSAGES = [
  { from: "them" as const, delay: "0.3s", text: "Good morning! Time for your BP reading. Reply with your numbers, e.g. 128/82." },
  { from: "me" as const, delay: "1.3s", text: "124/79 🙂" },
  { from: "them" as const, delay: "2.3s", text: "That's within range and trending better than last week. Logged for Dad's file too." },
  { from: "me" as const, delay: "3.3s", text: "Thank you!" },
];

export function WhatsappHeroMockup({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="relative mx-auto w-[280px] rounded-[36px] bg-clinical-navy p-3.5 shadow-2xl shadow-charcoal-ink/25">
        <div
          className="absolute left-1/2 top-3.5 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-clinical-navy"
          aria-hidden
        />
        <div className="flex min-h-[420px] flex-col overflow-hidden rounded-[24px] bg-soft-sage">
          <div className="flex items-center gap-2.5 bg-brand-green px-4 pb-3 pt-5 text-white">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sprout-gold text-xs font-bold text-clinical-navy">
              TH
            </div>
            <div>
              <p className="text-xs font-semibold">Tarragon Care Team</p>
              <p className="text-[10px] text-white/75">online · clinician Amaka</p>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2.5 p-3">
            {MESSAGES.map((message, index) => (
              <div
                key={index}
                className={
                  message.from === "me"
                    ? "marketing-bubble max-w-[80%] self-end rounded-2xl rounded-br-[4px] bg-brand-green px-3.5 py-2 text-xs leading-snug text-white"
                    : "marketing-bubble max-w-[80%] self-start rounded-2xl rounded-bl-[4px] bg-white px-3.5 py-2 text-xs leading-snug text-charcoal-ink"
                }
                style={{ animationDelay: message.delay }}
              >
                {message.text}
              </div>
            ))}
            <div
              className="marketing-typing flex w-fit gap-1 rounded-2xl rounded-bl-[4px] bg-white px-3.5 py-2.5"
              style={{ animationDelay: "0s" }}
              aria-hidden
            >
              <span className="marketing-typing-dot h-1.5 w-1.5 rounded-full bg-charcoal-ink/50" />
              <span
                className="marketing-typing-dot h-1.5 w-1.5 rounded-full bg-charcoal-ink/50"
                style={{ animationDelay: "0.15s" }}
              />
              <span
                className="marketing-typing-dot h-1.5 w-1.5 rounded-full bg-charcoal-ink/50"
                style={{ animationDelay: "0.3s" }}
              />
            </div>
          </div>
        </div>
      </div>

      <div
        className="motion-safe:opacity-0 absolute -right-2 top-4 hidden rounded-2xl bg-white px-4 py-3 text-xs font-semibold text-charcoal-ink shadow-xl shadow-charcoal-ink/10 motion-safe:[animation:marketing-fade-in_0.9s_ease-out_0.5s_forwards] lg:flex lg:items-center lg:gap-2"
      >
        <span className="h-2 w-2 rounded-full bg-brand-green" aria-hidden />
        BP logged — 118/76
      </div>
      <div
        className="motion-safe:opacity-0 absolute -left-4 bottom-6 hidden rounded-2xl bg-white px-4 py-3 text-xs font-semibold text-charcoal-ink shadow-xl shadow-charcoal-ink/10 motion-safe:[animation:marketing-fade-in_0.9s_ease-out_0.7s_forwards] lg:flex lg:items-center lg:gap-2"
      >
        <span className="h-2 w-2 rounded-full bg-sprout-gold" aria-hidden />
        HbA1c due in 3 months
      </div>
    </div>
  );
}
