"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import {
  useBroadcastHistory,
  useBroadcastAudienceCount,
  useBroadcastContentCheck,
  useBroadcastEmailTemplates,
  useBroadcastStats,
  useCancelScheduledBroadcast,
  useDeleteBroadcastEmailTemplate,
  useSaveBroadcastEmailTemplate,
  useSearchPatients,
  useSendBroadcast,
  type BroadcastAudience,
  type BroadcastAudienceFilter,
  type BroadcastEmailContent,
  type NotificationChannel,
  type PatientPickerResult,
} from "@/lib/queries/broadcasts";
import {
  renderBroadcastEmailHtml,
  UNSUBSCRIBE_FOOTER_PREVIEW_HTML,
} from "@/lib/broadcasts/render-email-template";
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

// ---- Validation for the new inputs this pass adds --------------------------
const scheduledForSchema = z
  .string()
  .min(1, "Pick a date and time.")
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "Not a valid date and time." })
  .refine((v) => new Date(v).getTime() > Date.now(), { message: "Must be in the future." });

const templateNameSchema = z
  .string()
  .trim()
  .min(1, "Name it something.")
  .max(80, "Keep the name under 80 characters.");

const variantSplitPctSchema = z.coerce
  .number()
  .int("Whole numbers only.")
  .min(1, "At least 1%.")
  .max(99, "At most 99%.");

const optionalUrlSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || /^https?:\/\//.test(v), {
    message: "Must be a full https:// (or http://) URL.",
  });

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
  const [scheduledMessage, setScheduledMessage] = useState<string | null>(null);
  // A broadcast cannot be recalled once queued: WhatsApp/SMS/email leave the
  // platform. Submit now validates and opens a recap of exactly what goes to
  // exactly whom; only the dialog's own button sends.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Item 1 — marketing-consent gating. Off by default (today's behaviour:
  // reaches every patient in the audience regardless of opt-in).
  const [isMarketing, setIsMarketing] = useState(false);

  // Item 4 (scheduling) — "Send now" (default, unchanged) vs "Schedule for
  // later" + a future-only datetime-local input.
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [scheduledForInput, setScheduledForInput] = useState("");

  // Item 4 (A/B testing) — a second content variant + split percentage.
  // Toggling this on reveals variant B's own copy of the email-design
  // section below.
  const [abEnabled, setAbEnabled] = useState(false);
  const [variantSplitPctInput, setVariantSplitPctInput] = useState("50");

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

  // Email design (variant A when A/B testing is on, the only design
  // otherwise): shown only when the email channel is checked. headline
  // defaults to the plain subject but is independently editable, so a
  // broadcast can read differently in an inbox than it does over
  // SMS/WhatsApp.
  const [emailHeadline, setEmailHeadline] = useState("");
  const [emailImageUrl, setEmailImageUrl] = useState("");
  const [emailBandColor, setEmailBandColor] = useState<"green" | "navy" | "none">("none");
  const [emailButtonText, setEmailButtonText] = useState("");
  const [emailButtonUrl, setEmailButtonUrl] = useState("");
  const [emailFooterNote, setEmailFooterNote] = useState("");

  // Variant B — only used/rendered when abEnabled.
  const [emailHeadlineB, setEmailHeadlineB] = useState("");
  const [emailImageUrlB, setEmailImageUrlB] = useState("");
  const [emailBandColorB, setEmailBandColorB] = useState<"green" | "navy" | "none">("none");
  const [emailButtonTextB, setEmailButtonTextB] = useState("");
  const [emailButtonUrlB, setEmailButtonUrlB] = useState("");
  const [emailFooterNoteB, setEmailFooterNoteB] = useState("");

  // Item 3 — saved template library.
  const savedTemplates = useBroadcastEmailTemplates();
  const saveTemplate = useSaveBroadcastEmailTemplate();
  const deleteTemplate = useDeleteBroadcastEmailTemplate();
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  // Per-broadcast stats, shown on demand from the history list below.
  const [statsBroadcastId, setStatsBroadcastId] = useState<string | null>(null);
  const stats = useBroadcastStats(statsBroadcastId);
  const cancelScheduled = useCancelScheduledBroadcast();

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

  const count = useBroadcastAudienceCount(audience, filter, isMarketing);
  const isPartnerAudience = audience === "all_partners" || audience === "partners_by_type";

  // Only attach a branded template when the admin actually customised
  // something beyond the plain default — an untouched "None" band with no
  // image/button/footer/headline override stores null (email_content), which
  // renders byte-for-byte identically to today's output. This is what proves
  // the additive/backward-compatible claim rather than just asserting it.
  // Deliberately unused once A/B is on (see variantAContent below) — A/B
  // mode always sends a fully-specified variant A rather than falling back
  // to the plain default, since "compare two designs" only makes sense when
  // both sides are actually designs.
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

  const variantAContent = useMemo<BroadcastEmailContent>(
    () => ({
      headline: emailHeadline.trim() || title.trim(),
      bodyText: body.trim(),
      imageUrl: emailImageUrl.trim() || undefined,
      bandColor: emailBandColor === "none" ? undefined : emailBandColor,
      buttonText: emailButtonText.trim() || undefined,
      buttonUrl: emailButtonUrl.trim() || undefined,
      footerNote: emailFooterNote.trim() || undefined,
    }),
    [emailHeadline, title, body, emailImageUrl, emailBandColor, emailButtonText, emailButtonUrl, emailFooterNote]
  );

  const variantBContent = useMemo<BroadcastEmailContent>(
    () => ({
      headline: emailHeadlineB.trim() || title.trim(),
      bodyText: body.trim(),
      imageUrl: emailImageUrlB.trim() || undefined,
      bandColor: emailBandColorB === "none" ? undefined : emailBandColorB,
      buttonText: emailButtonTextB.trim() || undefined,
      buttonUrl: emailButtonUrlB.trim() || undefined,
      footerNote: emailFooterNoteB.trim() || undefined,
    }),
    [emailHeadlineB, title, body, emailImageUrlB, emailBandColorB, emailButtonTextB, emailButtonUrlB, emailFooterNoteB]
  );

  const effectiveEmailContent = abEnabled ? variantAContent : emailContentDraft;

  const emailPreviewHtml = useMemo(() => {
    const html = renderBroadcastEmailHtml(effectiveEmailContent, title.trim(), body.trim());
    return isPartnerAudience ? html : html + UNSUBSCRIBE_FOOTER_PREVIEW_HTML;
  }, [effectiveEmailContent, title, body, isPartnerAudience]);

  const emailPreviewHtmlB = useMemo(() => {
    if (!abEnabled) return "";
    const html = renderBroadcastEmailHtml(variantBContent, title.trim(), body.trim());
    return isPartnerAudience ? html : html + UNSUBSCRIBE_FOOTER_PREVIEW_HTML;
  }, [abEnabled, variantBContent, title, body, isPartnerAudience]);

  function toggleChannel(channel: NotificationChannel) {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    );
  }

  function loadTemplate(id: string) {
    setSelectedTemplateId(id);
    if (!id) return;
    const tpl = savedTemplates.data?.find((t) => t.id === id);
    if (!tpl) return;
    const content = tpl.content as unknown as BroadcastEmailContent;
    setEmailHeadline(content.headline ?? "");
    setBody(content.bodyText ?? body);
    setEmailImageUrl(content.imageUrl ?? "");
    setEmailBandColor(content.bandColor ?? "none");
    setEmailButtonText(content.buttonText ?? "");
    setEmailButtonUrl(content.buttonUrl ?? "");
    setEmailFooterNote(content.footerNote ?? "");
  }

  function saveCurrentAsTemplate() {
    if (!variantAContent.bodyText.trim() && !variantAContent.headline.trim()) {
      setValidationError("Add a message or headline before saving a template.");
      return;
    }
    const name = window.prompt("Name this template:");
    if (name === null) return;
    const parsed = templateNameSchema.safeParse(name);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid template name.");
      return;
    }
    setValidationError(null);
    saveTemplate.mutate({ name: parsed.data, content: variantAContent });
  }

  function deleteSavedTemplate(id: string) {
    if (!window.confirm("Delete this saved template? This cannot be undone.")) return;
    deleteTemplate.mutate(id);
    if (selectedTemplateId === id) setSelectedTemplateId("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSentCount(null);
    setScheduledMessage(null);
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
    if (emailImageUrl.trim()) {
      const parsed = optionalUrlSchema.safeParse(emailImageUrl);
      if (!parsed.success) {
        setValidationError(`Hero image: ${parsed.error.issues[0]?.message}`);
        return;
      }
    }
    if (emailButtonUrl.trim()) {
      const parsed = optionalUrlSchema.safeParse(emailButtonUrl);
      if (!parsed.success) {
        setValidationError(`Button link: ${parsed.error.issues[0]?.message}`);
        return;
      }
    }
    if (abEnabled) {
      if (!!emailButtonTextB.trim() !== !!emailButtonUrlB.trim()) {
        setValidationError(
          "Add both a button label and a button link for variant B, or leave both blank."
        );
        return;
      }
      if (emailImageUrlB.trim()) {
        const parsed = optionalUrlSchema.safeParse(emailImageUrlB);
        if (!parsed.success) {
          setValidationError(`Variant B hero image: ${parsed.error.issues[0]?.message}`);
          return;
        }
      }
      if (emailButtonUrlB.trim()) {
        const parsed = optionalUrlSchema.safeParse(emailButtonUrlB);
        if (!parsed.success) {
          setValidationError(`Variant B button link: ${parsed.error.issues[0]?.message}`);
          return;
        }
      }
      const splitParsed = variantSplitPctSchema.safeParse(variantSplitPctInput);
      if (!splitParsed.success) {
        setValidationError(`Split percentage: ${splitParsed.error.issues[0]?.message}`);
        return;
      }
    }
    if (sendMode === "later") {
      const parsed = scheduledForSchema.safeParse(scheduledForInput);
      if (!parsed.success) {
        setValidationError(parsed.error.issues[0]?.message ?? "Invalid schedule time.");
        return;
      }
    }
    if (!attested) {
      setValidationError(
        "Confirm the message contains no clinical detail specific to a patient before sending."
      );
      return;
    }
    setValidationError(null);

    // Best-effort server-side check up front — admin_send_broadcast enforces
    // this itself too, but checking here avoids creating a blocked draft
    // row and gives specific, immediate feedback instead of a failed-send state.
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

  function resetForm() {
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
    setEmailHeadlineB("");
    setEmailImageUrlB("");
    setEmailBandColorB("none");
    setEmailButtonTextB("");
    setEmailButtonUrlB("");
    setEmailFooterNoteB("");
    setAbEnabled(false);
    setVariantSplitPctInput("50");
    setIsMarketing(false);
    setSendMode("now");
    setScheduledForInput("");
    setSelectedTemplateId("");
  }

  function sendNow() {
    setConfirmOpen(false);
    const scheduledForIso =
      sendMode === "later" ? new Date(scheduledForInput).toISOString() : undefined;
    send.mutate(
      {
        title: title.trim(),
        body: body.trim(),
        audience,
        filter,
        channels,
        emailContent: effectiveEmailContent,
        isMarketing,
        scheduledFor: scheduledForIso,
        emailContentB: abEnabled ? variantBContent : null,
        variantSplitPct: abEnabled ? variantSplitPctSchema.parse(variantSplitPctInput) : undefined,
      },
      {
        onSuccess: (recipients) => {
          if (scheduledForIso) {
            setScheduledMessage(
              `Scheduled for ${new Date(scheduledForIso).toLocaleString()}. It will go out automatically once due.`
            );
          } else {
            setSentCount(recipients);
          }
          resetForm();
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

            {!isPartnerAudience && (
              <label className="flex items-start gap-2 text-sm text-charcoal-ink">
                <input
                  type="checkbox"
                  checked={isMarketing}
                  onChange={(e) => setIsMarketing(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  This is a marketing message
                  <span className="mt-0.5 block text-xs font-normal text-charcoal-ink/50">
                    Only reaches patients who&apos;ve opted in to marketing emails, via their
                    notification settings. Leave unchecked for an operational announcement (e.g.
                    a service change) that should reach everyone in the audience regardless.
                  </span>
                </span>
              </label>
            )}

            <div className="space-y-1.5 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
              <Label>When to send</Label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="send-mode"
                    checked={sendMode === "now"}
                    onChange={() => setSendMode("now")}
                  />
                  Send now
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="send-mode"
                    checked={sendMode === "later"}
                    onChange={() => setSendMode("later")}
                  />
                  Schedule for later
                </label>
              </div>
              {sendMode === "later" && (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="scheduled-for">Date and time</Label>
                  <Input
                    id="scheduled-for"
                    type="datetime-local"
                    value={scheduledForInput}
                    onChange={(e) => setScheduledForInput(e.target.value)}
                  />
                  <p className="text-xs text-charcoal-ink/50">
                    A background job checks every few minutes and sends automatically once this
                    time passes. You can cancel it beforehand from the list below.
                  </p>
                </div>
              )}
            </div>

            {channels.includes("email") && (
              <div className="space-y-3 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-charcoal-ink">
                    Email design{abEnabled ? " — variant A" : ""}
                  </p>
                  <div className="flex items-center gap-2">
                    {savedTemplates.data && savedTemplates.data.length > 0 && (
                      <Select
                        value={selectedTemplateId}
                        onChange={(e) => loadTemplate(e.target.value)}
                        className="h-8 w-auto text-xs"
                      >
                        <option value="">Load a saved template…</option>
                        {savedTemplates.data.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={saveCurrentAsTemplate}
                      disabled={saveTemplate.isPending}
                    >
                      Save current design as template…
                    </Button>
                  </div>
                </div>
                {savedTemplates.data && savedTemplates.data.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {savedTemplates.data.map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex items-center gap-1 rounded-full bg-soft-sage/40 px-2 py-0.5 text-xs text-charcoal-ink"
                      >
                        {t.name}
                        <button
                          type="button"
                          onClick={() => deleteSavedTemplate(t.id)}
                          aria-label={`Delete template ${t.name}`}
                          className="text-charcoal-ink/50 hover:text-red-600"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
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

                <label className="flex items-center gap-2 border-t border-charcoal-ink/10 pt-3 text-sm text-charcoal-ink dark:border-night-ink/15">
                  <input
                    type="checkbox"
                    checked={abEnabled}
                    onChange={(e) => setAbEnabled(e.target.checked)}
                  />
                  A/B test this email
                </label>

                {abEnabled && (
                  <div className="space-y-3 rounded-lg border border-dashed border-charcoal-ink/20 p-3 dark:border-night-ink/25">
                    <div className="space-y-1.5">
                      <Label htmlFor="variant-split">Percent of recipients who get variant A</Label>
                      <Input
                        id="variant-split"
                        type="number"
                        min={1}
                        max={99}
                        value={variantSplitPctInput}
                        onChange={(e) => setVariantSplitPctInput(e.target.value)}
                      />
                      <p className="text-xs text-charcoal-ink/50">
                        The rest get variant B. Each patient is assigned once, consistently, for
                        this broadcast.
                      </p>
                    </div>

                    <p className="text-sm font-medium text-charcoal-ink">Email design — variant B</p>

                    <div className="space-y-1.5">
                      <Label htmlFor="email-headline-b">Headline (defaults to the subject)</Label>
                      <Input
                        id="email-headline-b"
                        value={emailHeadlineB}
                        onChange={(e) => setEmailHeadlineB(e.target.value)}
                        placeholder={title.trim() || "e.g. Free BP checks this weekend"}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email-image-b">Hero image URL (optional)</Label>
                      <Input
                        id="email-image-b"
                        value={emailImageUrlB}
                        onChange={(e) => setEmailImageUrlB(e.target.value)}
                        placeholder="https://…"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email-band-b">Headline background</Label>
                      <Select
                        id="email-band-b"
                        value={emailBandColorB}
                        onChange={(e) =>
                          setEmailBandColorB(e.target.value as "green" | "navy" | "none")
                        }
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
                        <Label htmlFor="email-button-text-b">Button label (optional)</Label>
                        <Input
                          id="email-button-text-b"
                          value={emailButtonTextB}
                          onChange={(e) => setEmailButtonTextB(e.target.value)}
                          placeholder="e.g. Book now"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="email-button-url-b">Button link (optional)</Label>
                        <Input
                          id="email-button-url-b"
                          value={emailButtonUrlB}
                          onChange={(e) => setEmailButtonUrlB(e.target.value)}
                          placeholder="https://…"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email-footer-b">Extra footer note (optional)</Label>
                      <Input
                        id="email-footer-b"
                        value={emailFooterNoteB}
                        onChange={(e) => setEmailFooterNoteB(e.target.value)}
                        placeholder="e.g. Offer valid while slots last."
                      />
                    </div>
                  </div>
                )}
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
            {scheduledMessage && <p className="text-sm text-brand-green">{scheduledMessage}</p>}

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
                  : sendMode === "later"
                    ? "Review and schedule"
                    : "Review and send"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={sendMode === "later" ? "Schedule this broadcast?" : "Send this broadcast?"}
        description={
          sendMode === "later"
            ? "It will be queued now and go out automatically once the scheduled time passes. You can cancel it any time before then."
            : "This leaves the platform over WhatsApp, SMS and email. It cannot be recalled, edited or unsent once queued."
        }
        confirmLabel={
          sendMode === "later"
            ? "Schedule"
            : `Send to ${count.data ?? 0} recipient${count.data === 1 ? "" : "s"}`
        }
        cancelLabel="Keep editing"
        destructive={sendMode === "now"}
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
            ...(isMarketing ? [{ label: "Marketing gate", value: "Opted-in patients only" }] : []),
            ...(sendMode === "later" && scheduledForInput
              ? [{ label: "Scheduled for", value: new Date(scheduledForInput).toLocaleString() }]
              : []),
            ...(abEnabled
              ? [{ label: "A/B split", value: `${variantSplitPctInput}% A / rest B` }]
              : []),
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
              Email preview{abEnabled ? " — variant A" : effectiveEmailContent ? " (branded design)" : " (plain — no design set)"}
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
        {channels.includes("email") && abEnabled && (
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/50">
              Email preview — variant B
            </p>
            <div className="mx-auto w-full max-w-[600px] overflow-x-auto rounded-lg border border-charcoal-ink/10 bg-white dark:border-night-ink/15">
              <iframe
                title="Broadcast email preview (variant B)"
                srcDoc={emailPreviewHtmlB}
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
              {history.data.map((b) => {
                // No "is it still in the future" check needed here: the only
                // ways a scheduled row stops being pending are
                // private.process_due_broadcasts firing it (status flips to
                // 'sent') or admin_cancel_scheduled_broadcast clearing
                // scheduled_for — so status='draft' with scheduled_for set
                // always means "still pending" from here. (Also avoids
                // calling the impure Date.now() during render.)
                const isPendingScheduled = b.status === "draft" && !!b.scheduled_for;
                const hasEmail = b.channels.includes("email");
                return (
                  <li key={b.id} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-charcoal-ink">{b.title}</p>
                      <Badge variant={b.status === "sent" ? "green" : "grey"}>
                        {b.status === "sent"
                          ? `Sent · ${b.recipient_count}`
                          : isPendingScheduled
                            ? `Scheduled for ${new Date(b.scheduled_for as string).toLocaleString()}`
                            : "Draft"}
                      </Badge>
                      {b.is_marketing && <Badge variant="grey">Marketing</Badge>}
                      {b.email_content_b && <Badge variant="grey">A/B</Badge>}
                      {isPendingScheduled && (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          onClick={() => cancelScheduled.mutate(b.id)}
                          disabled={cancelScheduled.isPending}
                        >
                          Cancel
                        </Button>
                      )}
                      {b.status === "sent" && hasEmail && (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          onClick={() =>
                            setStatsBroadcastId((prev) => (prev === b.id ? null : b.id))
                          }
                        >
                          {statsBroadcastId === b.id ? "Hide stats" : "Show stats"}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-charcoal-ink/60">
                      {b.audience.replace(/_/g, " ")} · {b.channels.join(", ")}
                      {b.sent_at ? ` · ${new Date(b.sent_at).toLocaleString()}` : ""}
                    </p>
                    {statsBroadcastId === b.id && (
                      <div className="rounded-lg border border-charcoal-ink/10 p-2 text-xs dark:border-night-ink/15">
                        {stats.isLoading && <p className="text-charcoal-ink/50">Loading stats…</p>}
                        {stats.data && stats.data.length === 0 && (
                          <p className="text-charcoal-ink/50">No email stats yet.</p>
                        )}
                        {stats.data && stats.data.length > 0 && (
                          <table className="w-full text-left">
                            <thead>
                              <tr className="text-charcoal-ink/50">
                                {stats.data.length > 1 && <th className="pr-3">Variant</th>}
                                <th className="pr-3">Sent</th>
                                <th className="pr-3">Opened</th>
                                <th className="pr-3">Open rate</th>
                                <th className="pr-3">Clicked</th>
                                <th>Click rate</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stats.data.map((row) => (
                                <tr key={row.variant}>
                                  {stats.data && stats.data.length > 1 && (
                                    <td className="pr-3 uppercase">{row.variant}</td>
                                  )}
                                  <td className="pr-3">{row.sent}</td>
                                  <td className="pr-3">{row.opened}</td>
                                  <td className="pr-3">{row.open_rate}%</td>
                                  <td className="pr-3">{row.clicked}</td>
                                  <td>{row.click_rate}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
