import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  BLOOD_SOURCE_LABEL,
  GENOTYPE_NOTE,
  type EmergencyCardPayload,
} from "@/lib/emergency/card";

/**
 * The card a stranger doctor reads at 2am.
 *
 * NO LOGIN, BY DESIGN — the person this protects may be unconscious, so
 * requiring them to authenticate would defeat the entire purpose. The token in
 * the URL is the credential, it is 32 random bytes, the patient created it
 * deliberately, and they can revoke it instantly.
 *
 * Reached through `emergency_card_by_token`, the one anon-executable function
 * on this platform. The dataset is fixed inside that function, so this page
 * cannot widen it however it is called.
 *
 * Rendered with a bare anon supabase-js client and no platform/auth imports —
 * the same boundary discipline `lib/marketing/*` holds, for the same reason:
 * this page must not be able to reach anything the token does not entitle.
 */

export const metadata: Metadata = {
  title: "Emergency health card",
  // Never indexed. A search engine should not hold these, and a token in a
  // crawler's index would outlive any revocation.
  robots: { index: false, follow: false, nocache: true },
};

// Always fresh: a revoked card must stop resolving on the very next request,
// and a cached page would keep serving a card the patient has just withdrawn.
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadCard(token: string): Promise<EmergencyCardPayload | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("emergency_card_by_token", { p_token: token });
  if (error || !data) return null;
  return data as unknown as EmergencyCardPayload;
}

function formatDob(dob: string | null): string {
  if (!dob) return "Not recorded";
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  const age = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} (age ${age})`;
}

export default async function EmergencyCardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const card = await loadCard(token);

  if (!card) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-charcoal-ink">This card is not available</h1>
        <p className="mt-2 text-sm text-charcoal-ink/70">
          This emergency card link is not valid, or the person it belongs to has withdrawn it. If
          you are treating someone right now, rely on your own assessment.
        </p>
      </main>
    );
  }

  const severeAllergies = card.allergies.filter((a) => a.severity === "severe");
  const genotypeNote = card.blood?.genotype ? GENOTYPE_NOTE[card.blood.genotype] : undefined;

  return (
    <main className="mx-auto max-w-2xl p-4 print:max-w-none print:p-0">
      <header className="rounded-t-lg bg-deep-forest p-4 text-white print:rounded-none">
        <p className="text-xs uppercase tracking-widest opacity-80">Emergency health card</p>
        <h1 className="mt-1 text-2xl font-semibold">{card.full_name ?? "Name not recorded"}</h1>
        <p className="mt-1 text-sm opacity-90">
          {formatDob(card.date_of_birth)}
          {card.sex ? ` · ${card.sex}` : ""}
          {card.patient_number ? ` · ${card.patient_number}` : ""}
        </p>
      </header>

      {/* Blood facts first. In Nigeria genotype is often the single most
          decision-changing line on this card. */}
      <section className="border-x border-charcoal-ink/15 bg-amber-50 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
          Blood
        </h2>
        {card.blood && (card.blood.blood_group || card.blood.genotype) ? (
          <>
            <p className="mt-1 text-xl font-semibold text-charcoal-ink">
              {card.blood.blood_group ?? "Group not recorded"}
              {card.blood.genotype ? ` · Genotype ${card.blood.genotype}` : ""}
            </p>
            {genotypeNote ? (
              <p className="text-sm font-medium text-charcoal-ink/80">{genotypeNote}</p>
            ) : null}
            {card.blood.note ? (
              <p className="text-sm text-charcoal-ink/70">{card.blood.note}</p>
            ) : null}
            <p className="mt-1 text-xs text-charcoal-ink/55">
              {BLOOD_SOURCE_LABEL[card.blood.source ?? ""] ?? "source not recorded"} — confirm by
              testing before transfusing.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-charcoal-ink/70">Not recorded.</p>
        )}
      </section>

      <Section title="Allergies" tone={severeAllergies.length > 0 ? "danger" : "normal"}>
        {card.allergies.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">
            None recorded. That is not the same as none — ask if you can.
          </p>
        ) : (
          <ul className="space-y-1">
            {card.allergies.map((a) => (
              <li key={a.allergen} className="text-sm text-charcoal-ink">
                <span className="font-medium">{a.allergen}</span>
                {a.severity ? <span className="text-charcoal-ink/70"> · {a.severity}</span> : null}
                {a.reaction ? <span className="text-charcoal-ink/70"> · {a.reaction}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Current medicines">
        {card.medications.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">None recorded.</p>
        ) : (
          <ul className="space-y-1">
            {card.medications.map((m) => (
              <li key={m.drug_name} className="text-sm text-charcoal-ink">
                <span className="font-medium">{m.drug_name}</span>
                {m.dose ? <span className="text-charcoal-ink/70"> · {m.dose}</span> : null}
                {m.frequency ? <span className="text-charcoal-ink/70"> · {m.frequency}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Ongoing conditions">
        {card.conditions.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">None recorded.</p>
        ) : (
          <p className="text-sm text-charcoal-ink">
            {card.conditions.map((c) => c.replace(/_/g, " ")).join(" · ")}
          </p>
        )}
      </Section>

      <Section title="Emergency contact">
        {card.emergency_contact?.name ? (
          <p className="text-sm text-charcoal-ink">
            <span className="font-medium">{card.emergency_contact.name}</span>
            {card.emergency_contact.relationship
              ? ` (${card.emergency_contact.relationship})`
              : ""}
            {card.emergency_contact.phone ? (
              <>
                {" · "}
                <a
                  href={`tel:${card.emergency_contact.phone}`}
                  className="font-medium text-brand-green underline"
                >
                  {card.emergency_contact.phone}
                </a>
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-charcoal-ink/70">None recorded.</p>
        )}
      </Section>

      <footer className="rounded-b-lg border-x border-b border-charcoal-ink/15 bg-charcoal-ink/[0.03] p-4 text-xs text-charcoal-ink/60 print:rounded-none">
        <p>
          Shared by the patient through TarragonHealth. This is a summary the patient chose to
          carry, not a complete medical record, and it may be out of date. It does not replace your
          own assessment. The patient can withdraw it at any time.
        </p>
        <p className="mt-1">
          Issued{" "}
          {new Date(card.issued_at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
          . Viewing this card is recorded and shown to the patient.
        </p>
      </footer>
    </main>
  );
}

function Section({
  title,
  children,
  tone = "normal",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "normal" | "danger";
}) {
  return (
    <section
      className={`border-x border-t border-charcoal-ink/15 p-4 ${
        tone === "danger" ? "bg-red-50" : "bg-white"
      }`}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
        {title}
      </h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}
