import { redirect } from "next/navigation";
import Link from "next/link";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { PageHeader } from "@/components/ui/page-header";
import { loadBusEventTypes, loadEndpoints, loadMappings } from "@/lib/event-bus/partner-load";
import { currentMs, endpointState, INTEGRATION_EVENT_TYPES, parseResult, type EndpointState } from "@/lib/event-bus/partner-model";
import { reenableEndpointAction, removeMappingAction, setMappingAction } from "@/lib/event-bus/partner-actions";
import { RotateKeyForm } from "./rotate-key-form";

export const metadata = { title: "Partner webhooks" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";
const cell = "px-3 py-2 align-top text-left text-sm text-charcoal-ink";
const head = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink";
/** Colour is never the only signal: each state also has its own words. */
const TONE: Record<EndpointState, "green" | "red" | "grey"> = { active: "green", auto_disabled: "red", off: "grey" };

/**
 * Partner webhook operations (S10x follow-up): rotate a signing key, switch back on an endpoint the platform switched off, and manage which
 * bus events reach a partner. Admin only. Ids only: this page never shows a payload, a patient or a secret, and creates no mapping and
 * switches nothing on by itself.
 */
export default async function PartnerWebhooksPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const sp = await searchParams;
  const result = parseResult(sp.r);
  const [endpoints, mappings, busTypes] = await Promise.all([loadEndpoints(), loadMappings(), loadBusEventTypes()]);
  const now = currentMs();

  return (
    <div className="space-y-6">
      <PageHeader title={t("busp.title")} description={t("busp.intro")} backTo={{ href: "/admin/ops/event-bus", label: t("busp.back") }} />

      {result && (
        <p
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${result === "rotated" || result === "reenabled" || result === "mapped" || result === "unmapped" ? "border-brand-green/40 bg-brand-green/5" : "border-red-300 bg-red-50"}`}
        >
          {t(`busp.result.${result}` as const)}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("busp.endpoints.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 overflow-x-auto">
          {endpoints.failed ? (
            <LoadFailure>{t("busp.load_failed")}</LoadFailure>
          ) : endpoints.rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">{t("busp.endpoints.empty")}</p>
          ) : (
            endpoints.rows.map((e) => {
              const state = endpointState(e);
              const graceOpen = e.previous_secret_expires_at !== null && Date.parse(e.previous_secret_expires_at) > now;
              return (
                <section key={e.id} className="rounded-lg border border-charcoal-ink/10 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-charcoal-ink">{e.name}</h3>
                    <Badge variant={TONE[state]}>{t(`busp.state.${state}` as const)}</Badge>
                    <span className="text-xs text-charcoal-ink/60">{e.environment}</span>
                  </div>
                  <dl className="mt-2 grid gap-1 text-sm text-charcoal-ink sm:grid-cols-3">
                    <div>
                      <dt className={head}>{t("busp.endpoints.col.failures")}</dt>
                      <dd className={cell}>{e.consecutive_failures}</dd>
                    </div>
                    <div>
                      <dt className={head}>{t("busp.endpoints.col.key")}</dt>
                      <dd className={cell}>
                        {t("busp.key.version", "en", { version: e.signing_key_version })}
                        {graceOpen && e.previous_secret_expires_at ? <span className="block text-xs">{t("busp.key.grace_open", "en", { when: lagos(e.previous_secret_expires_at) })}</span> : null}
                      </dd>
                    </div>
                    <div>
                      <dt className={head}>{t("busp.endpoints.col.last")}</dt>
                      <dd className={cell}>
                        {lagos(e.last_success_at)} / {lagos(e.last_failure_at)}
                      </dd>
                    </div>
                  </dl>
                  {state === "auto_disabled" && (
                    <form action={reenableEndpointAction} className="mt-3 space-y-2">
                      <input type="hidden" name="endpoint_id" value={e.id} />
                      <p className="text-sm text-charcoal-ink/80">{t("busp.reenable.help", "en", { reason: e.disabled_reason ?? "-" })}</p>
                      <button type="submit" className="rounded-lg bg-brand-green px-3 py-1 text-xs font-semibold text-white">
                        {t("busp.reenable.button")}
                      </button>
                    </form>
                  )}
                  <div className="mt-3">
                    <RotateKeyForm endpointId={e.id} graceOpen={graceOpen} />
                  </div>
                </section>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("busp.mappings.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 overflow-x-auto">
          {mappings.failed ? (
            <LoadFailure>{t("busp.load_failed")}</LoadFailure>
          ) : mappings.rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">{t("busp.mappings.empty")}</p>
          ) : (
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  {(["bus", "partner", "ids"] as const).map((c) => (
                    <th key={c} className={head}>
                      {t(`busp.mappings.col.${c}` as const)}
                    </th>
                  ))}
                  <th className={head} />
                </tr>
              </thead>
              <tbody>
                {mappings.rows.map((m) => (
                  <tr key={m.bus_event_type} className="border-t border-charcoal-ink/10">
                    <td className={cell}>{m.bus_event_type}</td>
                    <td className={cell}>{m.integration_event_type}</td>
                    <td className={`${cell} break-all text-xs`}>{m.id_keys.length > 0 ? m.id_keys.join(", ") : t("busp.mappings.ids_none")}</td>
                    <td className={cell}>
                      <form action={removeMappingAction}>
                        <input type="hidden" name="bus_event_type" value={m.bus_event_type} />
                        <button type="submit" className="rounded-lg border border-charcoal-ink/20 px-3 py-1 text-xs font-semibold text-charcoal-ink">
                          {t("busp.mappings.remove")}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form action={setMappingAction} className="max-w-xl space-y-3 rounded-lg border border-charcoal-ink/10 p-4">
            <h3 className="text-sm font-semibold text-charcoal-ink">{t("busp.mappings.add_title")}</h3>
            {busTypes.failed && <LoadFailure>{t("busp.load_failed")}</LoadFailure>}
            <p className="text-sm text-charcoal-ink/70">{t("busp.mappings.add_help")}</p>
            <label className="block text-sm">
              {t("busp.mappings.bus")}
              <select name="bus_event_type" required defaultValue="" className={field}>
                <option value="" disabled />
                {busTypes.rows.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t("busp.mappings.partner")}
              <select name="integration_event_type" required defaultValue="" className={field}>
                <option value="" disabled />
                {INTEGRATION_EVENT_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t("busp.mappings.keys")}
              <input name="id_keys" className={field} maxLength={400} autoComplete="off" />
              <span className="mt-1 block text-xs text-charcoal-ink/60">{t("busp.mappings.keys_help")}</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirm" value="yes" required className="mt-1" />
              <span>{t("busp.mappings.confirm")}</span>
            </label>
            <p className="text-xs text-charcoal-ink/60">{t("busp.mappings.deploy_note")}</p>
            <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white">
              {t("busp.mappings.save")}
            </button>
          </form>
        </CardContent>
      </Card>

      <p className="text-sm">
        <Link className="underline" href="/admin/ops/event-bus">
          {t("busp.back")}
        </Link>
      </p>
    </div>
  );
}
