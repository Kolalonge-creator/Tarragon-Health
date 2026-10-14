import { t, type Locale } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { ActionForm } from "@/components/partner-portal/action-form";
import { patientMessagePharmacyAction } from "@/lib/partner-network/actions";
import { conversationSchema } from "@/lib/partner-network/model";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * S74 (21.2): the patient's side of the in-app pharmacist conversation. Shown only once a prescription has been sent to a pharmacy. The database
 * checks that the prescription is the signed-in patient's; reading it is audited there. A failed read says so; it is never shown as "no messages".
 */
export async function PharmacyChatCard({ prescriptionId, locale }: { prescriptionId: string; locale: Locale }) {
  const { data, error } = await loose(await createClient()).rpc("patient_pharmacy_conversation", { p_prescription: prescriptionId });
  const parsed = error ? null : conversationSchema.safeParse(data);
  const messages = parsed?.success ? parsed.data : null;
  const isOpen = messages === null ? true : messages.length === 0 ? true : messages[0]?.is_open === true;
  return (
    <section className="space-y-3 rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25" aria-labelledby="pharmchat-title">
      <h3 id="pharmchat-title" className="font-semibold text-charcoal-ink">{t("pharmchat.title", locale)}</h3>
      <p className="text-xs text-charcoal-ink/70">{t("pharmchat.intro", locale)}</p>
      {messages === null ? (
        <p role="alert" className="text-sm text-red-900">{t("pharmchat.load_failed", locale)}</p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-charcoal-ink/60">{t("pharmchat.empty", locale)}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {messages.map((m) => (
            <li key={m.message_id} className={m.sender_kind === "patient" ? "ml-8 rounded-md bg-brand-green/10 p-2" : "mr-8 rounded-md bg-charcoal-ink/5 p-2"}>
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 text-xs text-charcoal-ink/60">{m.sender_kind === "patient" ? t("pharmchat.you", locale) : t("pharmchat.pharmacy", locale)}, {when(m.sent_at)}</p>
            </li>
          ))}
        </ul>
      )}
      {isOpen ? (
        <ActionForm
          action={patientMessagePharmacyAction}
          hidden={{ prescription: prescriptionId }}
          fields={[{ name: "body", label: t("pharmchat.label", locale), kind: "textarea", placeholder: t("pharmchat.placeholder", locale) }]}
          submitLabel={t("pharmchat.send", locale)}
          successText={t("pharmchat.sent", locale)}
        />
      ) : (
        <p className="text-sm text-charcoal-ink/60">{t("pharmchat.closed", locale)}</p>
      )}
    </section>
  );
}
