import Link from "next/link";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { completeSkinPhotoReviewAction } from "@/app/(dashboard)/clinician/skin-photo-reviews/actions";
import { NotADiagnosis } from "./not-a-diagnosis";

type QueueRow = { id: string; submitted_at: string; patient_ref: string | null };
type Detail = {
  status: "ok" | "denied" | "not_found" | "gone";
  photo?: { id: string; storage_path: string; body_area: string; note: string | null; submitted_at: string; sent_by_carer: boolean };
  patient?: { name: string | null; patient_number: string | null; sex: string | null; age_years: number | null };
  signed_url_seconds?: number;
};

const CATEGORIES = ["emergency", "urgent", "routine", "self_management"] as const;
const card = "space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card";
const field = "mt-1 block w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm";
const when = (iso: string) => new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });

/**
 * S59 (spec 12.7): the clinician's queue of patient photos and the review form. The queue shows a patient number and a time only.
 * Opening a photo calls the audited read (INV-10, INV-12), which refuses a clinician with no task for the patient and records that
 * refusal; only after it says "ok" is a short-lived signed link minted. Nothing on this page scores or classifies an image.
 */
export async function SkinPhotoReviewsPage({ photoId, outcome }: { photoId?: string; outcome?: string }) {
  const supabase = await createClient();
  const list = await supabase.rpc("list_my_skin_photo_reviews");
  const rows: QueueRow[] = Array.isArray(list.data) ? (list.data as unknown as QueueRow[]) : [];

  let detail: Detail | null = null;
  let url: string | null = null;
  if (photoId && /^[0-9a-f-]{36}$/i.test(photoId)) {
    const read = await supabase.rpc("read_skin_photo_audited", { p_photo: photoId, p_reason: `${t("symptom.skin.clinician.reason")} (${photoId.slice(0, 8)})` });
    detail = read.error ? { status: "denied" } : (read.data as unknown as Detail);
    if (detail.status === "ok" && detail.photo) {
      const { data } = await createServiceRoleClient().storage.from("skin-photos").createSignedUrl(detail.photo.storage_path, detail.signed_url_seconds ?? 60);
      url = data?.signedUrl ?? null;
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold text-charcoal-ink">{t("symptom.skin.clinician.title")}</h1>
        <p className="text-sm text-charcoal-ink/70">{t("symptom.skin.clinician.intro")}</p>
      </header>
      {outcome === "done" && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t("symptom.skin.clinician.done")}</p>}
      {outcome && outcome !== "done" && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t("symptom.summary.error")}</p>}

      <section className={card}>
        {rows.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("symptom.skin.clinician.empty")}</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-mono text-xs">{r.patient_ref ?? "-"}</span>
                <span className="text-charcoal-ink/70">{when(r.submitted_at)}</span>
                <Link className="font-medium text-brand-green underline" href={`/clinician/skin-photo-reviews?photo=${r.id}`}>
                  {t("symptom.clinician.open")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail?.status === "denied" && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("symptom.skin.clinician.denied")}</p>}
      {detail?.status === "gone" && <p className="text-sm">{t("symptom.skin.clinician.gone")}</p>}
      {detail?.status === "ok" && detail.photo && (
        <section className={card}>
          <p className="text-sm font-medium">
            {detail.patient?.patient_number ?? "-"}
            {detail.patient?.age_years !== null && detail.patient?.age_years !== undefined ? `, ${detail.patient.age_years}` : ""}
          </p>
          {detail.photo.sent_by_carer && <p className="text-xs">{t("symptom.skin.clinician.carer")}</p>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt="" className="max-h-96 rounded-lg" /> : <p className="text-sm">{t("symptom.skin.clinician.gone")}</p>}
          <p className="text-sm">{t(`symptom.skin.area.${detail.photo.body_area}` as never)}</p>
          {detail.photo.note && <p className="text-sm">{detail.photo.note}</p>}
          <NotADiagnosis />
          <form action={completeSkinPhotoReviewAction} className="space-y-2">
            <input type="hidden" name="photo" value={detail.photo.id} />
            <label className="block text-sm">
              {t("symptom.skin.clinician.next_step")}
              <select name="next" className={field} defaultValue="routine">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t("symptom.skin.clinician.message")}
              <textarea name="message" required minLength={10} maxLength={600} rows={3} className={field} />
            </label>
            <label className="block text-sm">
              {t("symptom.skin.clinician.internal")}
              <textarea name="note" maxLength={2000} rows={2} className={field} />
            </label>
            <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-medium text-white">
              {t("symptom.skin.clinician.complete")}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
