import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Patient-facing diabetes safety guidance (§12.6 hypo rule, §17.4 sick-day
 * rules, §13.4 insulin storage). Plain, warm, non-alarmist copy per the brand
 * voice — reference the patient can open any time. It is education, never a
 * clinical instruction that replaces their doctor.
 *
 * `diabetesType` is the effective type (confirmed_type if a clinician has
 * set one, else the patient's own self-report, else null/unknown) — see
 * diabetes-daily-log.tsx. Type 1 gets its own unconditional banner up top:
 * "never stop insulin" already appears in the general sick-day section
 * below, but a type-1 patient's insulin is never optional, sick or well, so
 * it earns a standalone callout rather than living inside the sick-day text.
 */
export function DiabetesGuidance({ diabetesType }: { diabetesType?: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Diabetes safety guide</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
        {diabetesType === "type_1" && (
          <div className="rounded-md border border-amber-300 dark:border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/10 p-3">
            <p className="font-medium text-amber-800 dark:text-amber-300">Type 1: never stop your insulin</p>
            <p className="mt-1">
              Not eating, feeling unwell, fasting, or running low on supplies is never a reason to
              skip a dose: your body cannot make its own insulin, so stopping it can quickly
              become dangerous (diabetic ketoacidosis). If you&apos;re struggling to get insulin or
              keep it down, contact your care team the same day rather than skipping a dose.
            </p>
          </div>
        )}
        <section className="space-y-1.5">
          <h3 className="font-medium text-deep-forest dark:text-brand-green-bright">If your sugar goes low (a &quot;hypo&quot;)</h3>
          <p>
            A low is below 3.9 mmol/L, or feeling shaky, sweaty, confused or very hungry. Use the{" "}
            <strong>15/15 rule</strong>:
          </p>
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>Take about 15g of fast sugar now: 3–4 teaspoons of sugar in water, half a glass of a regular (not diet) soft drink, or glucose tablets.</li>
            <li>Wait 15 minutes and check again.</li>
            <li>Still low? Repeat. Once recovered, eat your next meal or a snack.</li>
          </ol>
          <p className="text-charcoal-ink/60 dark:text-night-ink/60">
            Don&apos;t use chocolate or fatty foods; they work too slowly. If someone is confused or
            can&apos;t safely swallow, do <strong>not</strong> force food or drink; get emergency help now.
          </p>
        </section>

        <section className="space-y-1.5">
          <h3 className="font-medium text-deep-forest dark:text-brand-green-bright">When you&apos;re unwell (sick-day rules)</h3>
          <ul className="list-disc space-y-0.5 pl-5">
            <li><strong>Never stop your insulin</strong>, even if you&apos;re not eating. You often need it more when ill.</li>
            <li>Check your sugar more often than usual.</li>
            <li>Keep sipping fluids so you don&apos;t get dehydrated.</li>
            <li>If you can&apos;t eat, take sugary drinks to avoid a low.</li>
            <li>Vomiting, very high sugars that won&apos;t come down, or feeling drowsy? Log it and get help early.</li>
          </ul>
        </section>

        <section className="space-y-1.5">
          <h3 className="font-medium text-deep-forest dark:text-brand-green-bright">Fasting (for example, Ramadan)</h3>
          <p>
            Fasting with diabetes can be done more safely with a little planning, but it isn&apos;t
            right for everyone. Talk to your care team <strong>before</strong> you fast so they can
            check your risk and adjust your medicines and timings. Test your sugar more often while
            fasting, and <strong>break the fast</strong> if you have a low, a very high reading, or
            feel unwell.
          </p>
        </section>

        <section className="space-y-1.5">
          <h3 className="font-medium text-deep-forest dark:text-brand-green-bright">Other medicines can raise your sugar</h3>
          <p>
            Some medicines, especially steroids and a few HIV medicines, can push your sugar up.
            If you&apos;re started on any new medicine, tell your care team and keep logging, so they
            can adjust your diabetes plan if needed.
          </p>
        </section>

        <section className="space-y-1.5">
          <h3 className="font-medium text-deep-forest dark:text-brand-green-bright">Looking after your insulin</h3>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>Unopened insulin: keep in a fridge (2–8°C). Never freeze it, and keep it out of direct sun and hot cars.</li>
            <li>No steady power? Insulin you&apos;re using can stay at room temperature (below ~25–30°C) for about a month. Keep it cool with a clay pot or a wet cloth, away from sunlight.</li>
            <li>Throw away insulin that looks clumped, frosted or discoloured.</li>
            <li>Rotate injection sites (tummy, thigh, upper arms) to avoid lumps, and carry fast sugar in case of a low.</li>
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
