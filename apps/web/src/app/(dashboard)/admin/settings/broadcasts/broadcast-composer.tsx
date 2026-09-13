"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  useBroadcastHistory,
  useBroadcastAudienceCount,
  useBroadcastContentCheck,
  useSearchPatients,
  useSendBroadcast,
  type BroadcastAudience,
  type BroadcastAudienceFilter,
  type BroadcastEmailContent,
  type NotificationChannel,
  type PatientPickerResult,
} from "@/lib/queries/broadcasts";
import { renderBroadcastEmailHtml } from "@/lib/broadcasts/render-email-template";
import { useActiveServiceProducts } from "@/lib/queries/service-products";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";

const AUDIENCES: { value: BroadcastAudience; label: string }[] = [
  { value: "all_patients", label: "All patients" },
  { value: "patients_by_state", label: "Patients in a state" },
  { value: "subscribers_by_plan", label: "Patients with an active service" },
  { value: "specific_patients", label: "Specific patients" },
  { value: "all_partners", label: "All partners" },
  { value: "partners_by_type", label: "A partner group" },
];

const CHANNELS: { value: NotificationChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
];

const BAND_COLORS: { value: "green" | "navy" | "none"; label: string }[] = [
  { value: "none", label: "None (plain, today's default)" },
  { value: "green", label: "Brand green" },
  { value: "navy", label: "Clinical navy" },
];

export function BroadcastComposer() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<BroadcastAudience>("all_patients");
  const [state, setState] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [partnerType, setPartnerType] = useState<"pharmacy" | "specialist">("pharmacy");
  const [channels, setChannels] = useState<NotificationChannel[]>(["email"]);
  const [attested, setAttested] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);
  // A broadcast cannot be recalled once queued: WhatsApp/SMS/email leave the
  // platform. Submit now validates and opens a recap of exactly what goes to
  // exactly whom; only the dialog's own button sends.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Specific-patient picker: search-as-you-type (debounced), add to a chip
  // list. filter.patient_ids is derived from this list below.
  const [patientQuery, setPatientQuery] = useState("");
  const [debouncedPatientQuery, setDebouncedPatientQuery] = useState("");
  const [selectedPatients, setSelectedPatients] = useState<PatientPickerResult[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPatientQuery(patientQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [patientQuery]);

  const patientSearch = useSearchPatients(debouncedPatientQuery);

  function addPatient(p: PatientPickerResult) {
    setSelectedPatients((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    setPatientQuery("");
  }
  function removePatient(id: string) {
    setSelectedPatients((prev) => prev.filter((p) => p.id !== id));
  }

  // Email design: shown only when the email channel is checked. headline
  // defaults to the plain subject but is independently editable, so a
  // broadcast can read differently in an inbox than it does over SMS/WhatsApp.
  const [emailHeadline, setEmailHeadline] = useState("");
  const [emailImageUrl, setEmailImageUrl] = useState("");
  const [emailBandColor, setEmailBandColor] = useState<"green" | "navy" | "none">("none");
  const [emailButtonText, setEmailButtonText] = useState("");
  const [emailButtonUrl, setEmailButtonUrl] = useState("");
  const [emailFooterNote, setEmailFooterNote] = useState("");

  const serviceProducts = useActiveServiceProducts();
  const send = useSendBroadcast();
  const history = useBroadcastHistory();
  const contentCheck = useBroadcastContentCheck();

  const filter = useMemo<BroadcastAudienceFilter>(() => {
    const f: BroadcastAudienceFilter = {};
    if (
      (audience === "patients_by_state" || audience === "subscribers_by_plan") &&
      state.trim()
    ) {
      f.state = state.trim();
    }
    if (audience === "subscribers_by_plan" && planCode) f.plan_code = planCode;
    if (audience === "partners_by_type") f.partner_type = partnerType;
    if (audience === "specific_patients") f.patient_ids = selectedPatients.map((p) => p.id);
    return f;
  }, [audience, state, planCode, partnerType, selectedPatients]);

  const count = useBroadcastAudienceCount(audience, filter);
  const isPartnerAudience = audience === "all_partners" || audience === "partners_by_type";

  // Only attach a branded template when the admin actually customised
  // something beyond the plain default — an untouched "None" band with no
  // image/button/footer/headline override stores null (email_content), which
  // renders byte-for-byte identically to today's output. This is what proves
  // the additive/backward-compatible claim rather than just asserting it.
  const emailContentDraft = useMemo<BroadcastEmailContent | null>(() => {
    const customised =
      emailBandColor !== "none" ||
      !!emailImageUrl.trim() ||
      !!emailButtonText.trim() ||
      !!emailButtonUrl.trim() ||
      !!emailFooterNote.trim() ||
      !!emailHeadline.trim();
    if (!channels.includes("email") || !customised) return null;
    return {
      headline: emailHeadline.trim() || title.trim(),
      bodyText: body.trim(),
      imageUrl: emailImageUrl.trim() || undefined,
      bandColor: emailBandColor === "none" ? undefined : emailBandColor,
      buttonText: emailButtonText.trim() || undefined,
      buttonUrl: emailButtonUrl.trim() || undefined,
      footerNote: emailFooterNote.trim() || undefined,
    };
  }, [channels, emailHeadline, title, body, emailImageUrl, emailBandColor, emailButtonText, emailButtonUrl, emailFooterNote]);

  const emailPreviewHtml = useMemo(
    () => renderBroadcastEmailHtml(emailContentDraft, title.trim(), body.trim()),
    [emailContentDraft, title, body]
  );

  function toggleChannel(channel: NotificationChannel) {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSentCount(null);
    setConfirmOpen(false);
    if (!title.trim() || !body.trim()) {
      setValidationError("Add a subject and a message.");
      return;
    }
    if (channels.length === 0) {
      setValidationError("Choose at least one channel.");
      return;
    }
    if (audience === "specific_patients" && selectedPatients.length === 0) {
      setValidationError("Search for and pick at least one patient.");
      return;
    }
    if (!!emailButtonText.trim() !== !!emailButtonUrl.trim()) {
      setValidationError(
        "Add both a button label and a button link for the email design, or leave both blank."
      );
      return;
    }
    if (!attested) {
      setValidationError(
        "Confirm the message contains no clinical detail specific to a patient before sending."
      );
      return;
    }
    setValidationError(null);

    // Best-effort server-side check up front — admin_send_broadcast enforces
    // this itself too, but checking here avoids creating a blocked draft row
    // and gives specific, immediate feedback instead of a failed-send state.
    try {
      const flags = await contentCheck.mutateAsync(`${title.trim()} ${body.trim()}`);
      if (flags.length > 0) {
        setValidationError(
          "This reads like a personal clinical result or diagnosis. Broadcasts must stay general. Remove any result/diagnosis language specific to a person."
        );
        return;
      }
    } catch {
      // If the check itself fails, fall through — admin_send_broadcast still
      // enforces the same rule server-side as a backstop.
    }

    setConfirmOpen(true);
  }

  function sendNow() {
    setConfirmOpen(false);
    send.mutate(
      { title: title.trim(), body: body.trim(), audience, filter, channels, emailContent: emailContentDraft },
      {
        onSuccess: (recipients) => {
          setSentCount(recipients);
          setTitle("");
          setBody("");
          setAttested(false);
          setSelectedPatients([]);
          setEmailHeadline("");
          setEmailImageUrl("");
          setEmailBandColor("none");
          setEmailButtonText("");
          setEmailButtonUrl("");
          setEmailFooterNote("");
        },
      }
    );
  }

  // Distinct service product codes for the dropdown (products repeat per
  // currency/interval).
  const serviceProductCodes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of serviceProducts.data ?? []) if (!seen.has(p.code)) seen.set(p.code, p.name);
    return [...seen.entries()];
  }, [serviceProducts.data]);

  const sendError = (send.error as Error | null)?.message ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Compose broadcast</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Subject</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Free BP checks this weekend"
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">Message</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="The message recipients will receive."
                required
              />
              <p className="text-xs text-charcoal-ink/50">
                This goes out over WhatsApp/SMS/email. Do not include a diagnosis, test result, or
                other clinical detail specific to a person. General announcements only.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audience">Audience</Label>
              <Select
                id="audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value as BroadcastAudience)}
              >
                {AUDIENCES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>

            {(audience === "patients_by_state" || audience === "subscribers_by_plan") && (
              <div className="space-y-1.5">
                <Label htmlFor="state">
                  State {audience === "subscribers_by_plan" && "(optional)"}
                </Label>
                <Input
                  id="state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="e.g. Lagos"
                />
              </div>
            )}

            {audience === "subscribers_by_plan" && (
              <div className="space-y-1.5">
                <Label htmlFor="plan">Service (optional, any active service if blank)</Label>
                <Select id="plan" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                  <option value="">Any active service</option>
                  {serviceProductCodes.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name} ({code})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {audience === "partners_by_type" && (
              <div className="space-y-1.5">
                <Label htmlFor="partner_type">Partner group</Label>
                <Select
                  id="partner_type"
                  value={partnerType}
                  onChange={(e) => setPartnerType(e.target.value as "pharmacy" | "specialist")}
                >
                  <option value="pharmacy">Pharmacies</option>
                  <option value="specialist">Specialists</option>
                </Select>
              </div>
            )}

            {audience === "specific_patients" && (
              <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
                <Label htmlFor="patient-search">Find patients (name, email or phone)</Label>
                <Input
                  id="patient-search"
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  placeholder="Type at least 2 characters…"
                />
                {debouncedPatientQuery.length >= 2 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-charcoal-ink/10 dark:border-night-ink/15">
                    {patientSearch.isLoading && (
                      <p className="p-2 text-xs text-charcoal-ink/50">Searching…</p>
                    )}
                    {patientSearch.data && patientSearch.data.length === 0 && (
                      <p className="p-2 text-xs text-charcoal-ink/50">No patients match.</p>
                    )}
                    {patientSearch.data?.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addPatient(p)}
                        className="flex w-full flex-col items-start gap-0 border-b border-charcoal-ink/5 p-2 text-left text-sm last:border-0 hover:bg-soft-sage/40 dark:border-night-ink/10"
                      >
                        <span className="font-medium">{p.full_name ?? "(no name on file)"}</span>
                        <span className="text-xs text-charcoal-ink/60">
                          {[p.email, p.phone].filter(Boolean).join(" · ") || "no contact on file"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedPatients.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {selectedPatients.map((p) => (
                      <Badge key={p.id} variant="grey" className="gap-1.5">
                        {p.full_name ?? p.email ?? p.id}
                        <button
                          type="button"
                          onClick={() => removePatient(p.id)}
                          aria-label={`Remove ${p.full_name ?? p.email ?? "patient"}`}
                          className="ml-1 text-charcoal-ink/50 hover:text-charcoal-ink"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Channels</Label>
              <div className="flex flex-wrap gap-4">
                {CHANNELS.map((c) => {
                  const disabled = isPartnerAudience && c.value === "whatsapp";
                  return (
                    <label
                      key={c.value}
                      className={`flex items-center gap-2 text-sm ${
                        disabled ? "text-charcoal-ink/40" : "text-charcoal-ink"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={channels.includes(c.value) && !disabled}
                        disabled={disabled}
                        onChange={() => toggleChannel(c.value)}
                      />
                      {c.label}
                    </label>
                  );
                })}
              </div>
              {isPartnerAudience && (
                <p className="text-xs text-charcoal-ink/50">
                  Partners are reached by email/SMS only; WhatsApp is a patient channel.
                </p>
              )}
            </div>

            {channels.includes("email") && (
              <div className="space-y-3 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
                <p className="text-sm font-medium text-charcoal-ink">Email design</p>
                <p className="text-xs text-charcoal-ink/50">
                  Optional. Leave everything below blank for today&apos;s plain layout — the
                  subject as a green heading over the message text. Fill any of these in for a
                  branded layout instead; the message above is reused as the email body.
                </p>

                <div className="space-y-1.5">
                  <Label htmlFor="email-headline">Headline (defaults to the subject)</Label>
                  <Input
                    id="email-headline"
                    value={emailHeadline}
                    onChange={(e) => setEmailHeadline(e.target.value)}
                    placeholder={title.trim() || "e.g. Free BP checks this weekend"}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email-image">Hero image URL (optional)</Label>
                  <Input
                    id="email-image"
                    value={emailImageUrl}
                    onChange={(e) => setEmailImageUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email-band">Headline background</Label>
                  <Select
                    id="email-band"
                    value={emailBandColor}
                    onChange={(e) => setEmailBandColor(e.target.value as "green" | "navy" | "none")}
                  >
                    {BAND_COLORS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="email-button-text">Button label (optional)</Label>
                    <Input
                      id="email-button-text"
                      value={emailButtonText}
                      onChange={(e) => setEmailButtonText(e.target.value)}
                      placeholder="e.g. Book now"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email-button-url">Button link (optional)</Label>
                    <Input
                      id="email-button-url"
                      value={emailButtonUrl}
                      onChange={(e) => setEmailButtonUrl(e.target.value)}
                      placeholder="https://…"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email-footer">Extra footer note (optional)</Label>
                  <Input
                    id="email-footer"
                    value={emailFooterNote}
                    onChange={(e) => setEmailFooterNote(e.target.value)}
                    placeholder="e.g. Offer valid while slots last."
                  />
                </div>
              </div>
            )}

            <p className="text-sm text-charcoal-ink/70">
              {count.isLoading
                ? "Counting recipients…"
                : count.isError
                  ? "Could not estimate recipients."
                  : `This will reach ${count.data ?? 0} recipient${count.data === 1 ? "" : "s"}.`}
            </p>

            <label className="flex items-start gap-2 text-xs text-charcoal-ink/70">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                className="mt-0.5"
              />
              I confirm this message contains no diagnosis, test result, or other clinical
              detail specific to an individual patient.
            </label>

            {validationError && <p className="text-sm text-red-600">{validationError}</p>}
            {sendError && <p className="text-sm text-red-600">{sendError}</p>}
            {sentCount !== null && (
              <p className="text-sm text-brand-green">
                Queued to {sentCount} recipient{sentCount === 1 ? "" : "s"}.
              </p>
            )}

            <Button
              type="submit"
              disabled={
                send.isPending || contentCheck.isPending || !attested || (count.data ?? 0) === 0
              }
            >
              {send.isPending
                ? "Sending…"
                : contentCheck.isPending
                  ? "Checking…"
                  : "Review and send"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Send this broadcast?"
        description="This leaves the platform over WhatsApp, SMS and email. It cannot be recalled, edited or unsent once queued."
        confirmLabel={`Send to ${count.data ?? 0} recipient${count.data === 1 ? "" : "s"}`}
        cancelLabel="Keep editing"
        destructive
        onConfirm={sendNow}
        onCancel={() => setConfirmOpen(false)}
      >
        <ConfirmDialogFacts
          rows={[
            {
              label: "Going to",
              value: `${count.data ?? 0} ${isPartnerAudience ? "partner" : "patient"}${count.data === 1 ? "" : "s"}`,
            },
            {
              label: "Audience",
              value: AUDIENCES.find((a) => a.value === audience)?.label ?? audience,
            },
            {
              label: "Channels",
              value: channels.map((c) => CHANNELS.find((x) => x.value === c)?.label ?? c).join(", "),
            },
          ]}
        />
        {/* The preview is the point: an operator should read the exact words
            every recipient will read before they become unrecallable. */}
        <div className="space-y-1 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
          <p className="text-xs uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/50">
            What each recipient will see (WhatsApp / SMS / plain email)
          </p>
          <p className="text-sm font-medium">{title.trim()}</p>
          <p className="whitespace-pre-wrap text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            {body.trim()}
          </p>
        </div>
        {channels.includes("email") && (
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/50">
              Email preview{emailContentDraft ? " (branded design)" : " (plain — no design set)"}
            </p>
            <div className="mx-auto w-full max-w-[600px] overflow-x-auto rounded-lg border border-charcoal-ink/10 bg-white dark:border-night-ink/15">
              <iframe
                title="Broadcast email preview"
                srcDoc={emailPreviewHtml}
                sandbox=""
                className="h-[360px] w-full min-w-[320px]"
              />
            </div>
          </div>
        )}
      </ConfirmDialog>

      <Card>
        <CardHeader>
          <CardTitle>Recent broadcasts</CardTitle>
        </CardHeader>
        <CardContent>
          {history.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {history.data && history.data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No broadcasts sent yet.</p>
          )}
          {history.data && history.data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {history.data.map((b) => (
                <li key={b.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">{b.title}</p>
                    <Badge variant={b.status === "sent" ? "green" : "grey"}>
                      {b.status === "sent" ? `Sent · ${b.recipient_count}` : "Draft"}
                    </Badge>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    {b.audience.replace(/_/g, " ")} · {b.channels.join(", ")}
                    {b.sent_at ? ` · ${new Date(b.sent_at).toLocaleString()}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
