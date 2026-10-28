"use client";
import { vitalSavedMessage } from "@/lib/vitals/bp-ack-message";
import { useGlucoseUnit } from "@/components/glucose-unit-provider";
import { t } from "@tarragon/i18n";
import { useMeasurementUnits } from "@/components/measurement-units-provider";
import { UnitConvertedInput } from "./unit-converted-input";
import {
  LENGTH_UNIT_LABEL,
  PLACE_LABEL_MAX,
  formatLength,
  TEMPERATURE_UNIT_LABEL,
  WEIGHT_UNIT_LABEL,
  lengthToCm,
  temperatureToC,
  weightToKg,
} from "@tarragon/shared";

import { useActionState, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logVital } from "./actions";
import { useOnlineStatus } from "@/lib/network/use-online-status";
import type { GlucoseUnit } from "@/lib/validation/vitals";
import { vitalsReadingSchema } from "@/lib/validation/vitals";
import { crosscheckVital, type VitalCrosscheck } from "@/lib/vitals/plausibility";
import {
  gradeOfflineEmergency,
  isEmergencyAloneSymptom,
  offlineSymptomLabelKey,
  OFFLINE_SYMPTOMS,
  type OfflineGuidanceCode,
  type OfflineSymptom,
} from "@/lib/vitals/offline-emergency";
import { forgetEmergency, rememberEmergency } from "@/lib/vitals/emergency-marker";
import { OfflineEmergencyGuidance } from "./offline-emergency-guidance";
import { VITAL_TYPES, type VitalType } from "@/lib/vitals/vital-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

type KetoneKind = "blood" | "urine";

/**
 * Shown when the submit handler blocks a doomed submission because the
 * browser already knows it's offline — see the offline guard in
 * `handleSubmit` below for why this exists instead of wrapping the action
 * itself (that approach was tried and reverted: it broke this form's
 * no-JS/pre-hydration submission fallback — see
 * docs/OFFLINE_RESILIENCE_AUDIT.md §3/§6 for the full account).
 */
const OFFLINE_BLOCKED_MESSAGE =
  "You're offline. Reconnect, then press Save reading again.";

/**
 * How long a submitted reading may go unanswered before the bundled emergency guidance is shown anyway (a connection that still reads as online
 * but never answers, "lie-fi"). An engineering limit, not a clinical one. The request itself is left alone: a Server Action cannot be cancelled
 * from here, and wrapping it to catch a failure would break this form's no-JS submission (docs/OFFLINE_RESILIENCE_AUDIT.md section 6).
 */
export const SUBMIT_UNANSWERED_MS = 8000;

type GuidanceState = { code: OfflineGuidanceCode; variant: "offline" | "unconfirmed" } | null;

export function VitalsForm({
  patientId,
  lockedType,
  title,
  pharmacyOpen = false,
}: {
  patientId: string;
  /** S07y: whether the "taken at a pharmacy or clinic machine" box is offered (the pharmacy_bp_readings guard is open for this person). Closed: no box. */
  pharmacyOpen?: boolean;
  /** When set, hides the reading-type selector and locks the form to this
   * type — powers the /patient/quick-log/[type] deep-link pages so a
   * reminder can link straight to "log glucose" with no extra
   * taps, instead of landing on the full dashboard and hunting for it. */
  lockedType?: VitalType;
  title?: string;
}) {
  const [vitalType, setVitalType] = useState<VitalType>(lockedType ?? "blood_pressure");
  // Defaults to the unit this patient actually reads, instead of mmol_l for
  // everyone. Before this, a patient on a mg/dL meter had to re-pick the unit
  // on every single entry, and forgetting once stored a reading 18x wrong.
  const preferredUnit = useGlucoseUnit();
  const units = useMeasurementUnits();
  const [glucoseUnit, setGlucoseUnit] = useState<GlucoseUnit>(preferredUnit);
  const [ketoneKind, setKetoneKind] = useState<KetoneKind>("blood");
  const [atPharmacy, setAtPharmacy] = useState(false);
  const [state, formAction, pending] = useActionState(logVital, undefined);
  const [offlineGuidance, setOfflineGuidance] = useState<GuidanceState>(null);
  // S07y: the tick belongs to ONE reading. React clears the form's own inputs after a saved reading, but this tick is controlled state, so it is cleared here
  // (the supported "adjust state when a value changes" pattern, not an effect): otherwise the next home reading could go out labelled as a pharmacy one.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.success) setAtPharmacy(false);
    // The server answered: its own acknowledgement now says what happened, so an "unconfirmed" dialog has nothing left to say.
    if (offlineGuidance?.variant === "unconfirmed") setOfflineGuidance(null);
  }
  const queryClient = useQueryClient();

  // Blocks a submission the browser already knows is doomed instead of
  // letting it reach the server and fail there. Deliberately a pre-submit
  // guard, not a wrapper around `formAction` itself: `logVital` is passed to
  // useActionState directly, unwrapped, so this form keeps React's real
  // no-JS/pre-hydration submission fallback (a plain client function passed
  // as the action loses that — confirmed live, see
  // docs/OFFLINE_RESILIENCE_AUDIT.md §3/§6). `navigator.onLine` is a
  // device-level signal, not proof of real reachability, so a connection
  // that drops in the narrow window between this check and the request
  // actually going out is still possible — that residual case is what
  // logVital's own server-side try/catch (actions.ts) exists for.
  //
  // This IS a deliberate exception to useOnlineStatus's own general rule
  // ("don't skip a real request based on this value" — see its doc comment)
  // — accepted specifically here because a Server-Action-backed
  // useActionState form has no other graceful way to surface a client-
  // transport failure. The accepted trade-off: a false navigator.onLine ===
  // false reading blocks a submission that would have succeeded; that's
  // judged rarer and less harmful than the alternative (attempting and
  // crashing the route segment on a genuine drop, the bug this whole pass
  // exists to fix).
  const isOnline = useOnlineStatus();
  const [offlineBlocked, setOfflineBlocked] = useState(false);
  // INV-06 on the web (S85b): with the network off the emergency guidance comes from bundled code. The ticks are not posted (no `name`): they
  // exist only so the on-device check can see them, and are offered only while offline.
  const [offlineSymptoms, setOfflineSymptoms] = useState<readonly OfflineSymptom[]>([]);
  // Lie-fi: a reading that asked for emergency guidance was sent and nothing has answered yet. `pendingRef` lets the timer see the live value.
  const pendingRef = useRef(false);
  const unansweredTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Crosscheck nudge: when a reading lands outside the normal band we ask the
  // patient to confirm it before saving, and show how to take a cleaner
  // reading — but never block it (a real abnormal value must still reach the
  // record). confirmedRef is a one-shot bypass so the confirm button can
  // re-submit the same form past the guard without waiting on a state update.
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const [crosscheck, setCrosscheck] = useState<VitalCrosscheck | null>(null);

  // The action returns one message for the reading as a whole rather than a
  // per-field one, so every reading input for the selected type points at the
  // same alert and is marked invalid together. Announcing it at all is the
  // change that matters: before this, a rejected reading was inserted silently
  // below the button and a screen-reader user got no feedback whatsoever.
  const errorId = fieldErrorId("vitals-form");
  const displayedError = offlineBlocked ? OFFLINE_BLOCKED_MESSAGE : state?.error;
  const readingErrorProps = fieldErrorProps(errorId, Boolean(displayedError));

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["vitals-readings", patientId] });
    }
  }, [state?.success, queryClient, patientId]);

  // The request finished (or this form went away): stop waiting. Any answer from the server, good or bad, ends the "not confirmed saved" note.
  useEffect(() => {
    pendingRef.current = pending;
    if (!pending && unansweredTimer.current) {
      clearTimeout(unansweredTimer.current);
      unansweredTimer.current = null;
    }
  }, [pending]);
  useEffect(() => {
    if (state !== undefined) forgetEmergency();
  }, [state]);
  useEffect(
    () => () => {
      if (unansweredTimer.current) clearTimeout(unansweredTimer.current);
    },
    [],
  );

  // A reading that asks for emergency guidance is about to be sent: if nothing answers within the limit, show the bundled guidance. Also leaves
  // the marker so a request that fails outright (the error screen) or a reload with no network still shows it.
  function watchForNoAnswer(code: OfflineGuidanceCode) {
    rememberEmergency(code);
    if (unansweredTimer.current) clearTimeout(unansweredTimer.current);
    unansweredTimer.current = setTimeout(() => {
      unansweredTimer.current = null;
      if (pendingRef.current) setOfflineGuidance({ code, variant: "unconfirmed" });
    }, SUBMIT_UNANSWERED_MS);
  }

  function bpFromForm(form: HTMLFormElement): { sys: number | null; dia: number | null } {
    const raw = Object.fromEntries(new FormData(form).entries());
    const onBp = raw.vital_type === "blood_pressure";
    return { sys: onBp && raw.systolic !== "" ? Number(raw.systolic) : null, dia: onBp && raw.diastolic !== "" ? Number(raw.diastolic) : null };
  }

  // What the last save said stops being true the moment the person edits the form, is blocked offline, or is asked to confirm a different value:
  // an old "Received" must never sit beside a reading that was not sent. A new result from the server shows again.
  // Held as "stale for THIS server result" so a new result is fresh without a reset effect (setState in an effect is a lint error).
  const [staleMark, setStaleMark] = useState<{ for: typeof state } | null>(null);
  const ackStale = staleMark !== null && staleMark.for === state;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Checked ahead of the crosscheck-bypass branch below too — a confirmed
    // resubmission from the crosscheck dialog is just as doomed offline as a
    // first attempt. Clears a previously-shown offline message on any
    // attempt made while back online, success or not — cleared here rather
    // than in an effect keyed on `isOnline`, so it disappears exactly when
    // the patient acts on it (presses Save again) instead of silently
    // vanishing out from under them the instant connectivity returns.
    if (!isOnline) {
      event.preventDefault();
      // The bypass below wasn't consumed by a real submission attempt — a
      // blocked attempt isn't a submission, so don't let it survive to a
      // later, possibly-different retry (see the one-shot comment below);
      // without this, confirming a crosscheck-flagged reading, getting
      // blocked here, then pressing Save again unedited would silently
      // resubmit the same reading a second time, since vitals_readings has
      // no dedup constraint.
      confirmedRef.current = false;
      const { sys, dia } = bpFromForm(event.currentTarget);
      const offlineGrade = gradeOfflineEmergency({ systolic: sys, diastolic: dia, symptoms: offlineSymptoms });
      if (offlineGrade.emergency && offlineGrade.code) {
        setOfflineGuidance({ code: offlineGrade.code, variant: "offline" });
        rememberEmergency(offlineGrade.code);
      }
      setOfflineBlocked(true);
      setStaleMark({ for: state });
      return;
    }
    if (offlineBlocked) setOfflineBlocked(false);
    const sendsNow = (): void => {
      // The reading is going out. If it asks for emergency guidance and nothing answers, the guidance still appears.
      const { sys, dia } = bpFromForm(event.currentTarget);
      const g = gradeOfflineEmergency({ systolic: sys, diastolic: dia, symptoms: offlineSymptoms });
      if (g.emergency && g.code) watchForNoAnswer(g.code);
    };
    if (confirmedRef.current) {
      confirmedRef.current = false; // consume the one-shot bypass, let the action run
      sendsNow();
      return;
    }
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const parsed = vitalsReadingSchema.safeParse(raw);
    // If it doesn't even parse, let the Server Action surface the field error.
    if (!parsed.success) {
      sendsNow();
      return;
    }
    const result = crosscheckVital(parsed.data);
    if (result) {
      event.preventDefault();
      setCrosscheck(result);
      return;
    }
    sendsNow();
  }

  function toggleOfflineSymptom(symptom: OfflineSymptom, on: boolean) {
    const next = on ? [...offlineSymptoms.filter((x) => x !== symptom), symptom] : offlineSymptoms.filter((x) => x !== symptom);
    setOfflineSymptoms(next);
    // A ticked symptom that is an emergency on its own: the guidance shows at once, before anything is submitted.
    if (on && isEmergencyAloneSymptom(symptom)) {
      const g = gradeOfflineEmergency({ symptoms: next });
      if (g.emergency && g.code) {
        setOfflineGuidance({ code: g.code, variant: "offline" });
        rememberEmergency(g.code);
      }
    }
  }

  function confirmAndSave() {
    confirmedRef.current = true;
    setCrosscheck(null);
    formRef.current?.requestSubmit();
  }

  // Any edit (including changing the reading type) invalidates a pending
  // crosscheck so the patient re-confirms the corrected value.
  function resetGuard() {
    setStaleMark({ for: state });
    confirmedRef.current = false;
    setCrosscheck((current) => (current ? null : current));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title ?? "Log a reading"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={formAction}
          onSubmit={handleSubmit}
          onChange={resetGuard}
          className="space-y-4"
        >
          <input type="hidden" name="vital_type" value={vitalType} />
          {!lockedType && (
            <div className="space-y-1.5">
              <Label htmlFor="vital_type_select">Reading type</Label>
              <Select
                id="vital_type_select"
                value={vitalType}
                onChange={(event) => setVitalType(event.target.value as VitalType)}
              >
                {VITAL_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {vitalType === "blood_pressure" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="systolic">Systolic (mmHg)</Label>
                <Input id="systolic" name="systolic" type="number" required {...readingErrorProps} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="diastolic">Diastolic (mmHg)</Label>
                <Input id="diastolic" name="diastolic" type="number" required {...readingErrorProps} />
              </div>
              {pharmacyOpen && (
                <div className="col-span-2 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      id="entry_origin"
                      name="entry_origin"
                      type="checkbox"
                      value="pharmacy_machine"
                      checked={atPharmacy}
                      onChange={(event) => setAtPharmacy(event.target.checked)}
                      aria-describedby="pharmacy-tick-hint"
                      className="mt-1 h-4 w-4"
                    />
                    <div>
                      <Label htmlFor="entry_origin">{t("pharm.tick")}</Label>
                      <p id="pharmacy-tick-hint" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                        {t("pharm.tick_hint")}
                      </p>
                    </div>
                  </div>
                  {atPharmacy && (
                    <div className="space-y-1.5">
                      <Label htmlFor="place_label">{t("pharm.place")}</Label>
                      <Input id="place_label" name="place_label" type="text" maxLength={PLACE_LABEL_MAX} aria-describedby="place-label-hint" />
                      <p id="place-label-hint" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                        {t("pharm.place_hint")}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {vitalType === "glucose" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="glucose_value">Glucose</Label>
                <div className="flex gap-2">
                  <Input
                    id="glucose_value"
                    name="glucose_value"
                    type="number"
                    step={glucoseUnit === "mmol_l" ? "0.1" : "1"}
                    required
                    className="flex-1"
                    {...fieldErrorProps(
                      errorId,
                      Boolean(displayedError),
                      "glucose-unit-hint"
                    )}
                  />
                  <input type="hidden" name="glucose_unit" value={glucoseUnit} />
                  <Select
                    aria-label="Glucose unit"
                    value={glucoseUnit}
                    onChange={(event) => setGlucoseUnit(event.target.value as GlucoseUnit)}
                    className="w-28"
                  >
                    <option value="mmol_l">mmol/L</option>
                    <option value="mg_dl">mg/dL</option>
                  </Select>
                </div>
                <p
                  id="glucose-unit-hint"
                  className="text-xs text-charcoal-ink/60 dark:text-night-ink/60"
                >
                  {glucoseUnit === "mmol_l" ? "e.g. 5.6 mmol/L" : "e.g. 100 mg/dL"}; check
                  your glucometer&apos;s display unit before entering.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="glucose_context">Context</Label>
                <Select
                  id="glucose_context"
                  name="glucose_context"
                  required
                  defaultValue=""
                  {...readingErrorProps}
                >
                  <option value="" disabled>
                    Select context
                  </option>
                  <option value="fasting">Fasting</option>
                  <option value="pre_meal">Before a meal</option>
                  <option value="post_meal">2 hours after a meal</option>
                  <option value="bedtime">Bedtime</option>
                  <option value="night">During the night</option>
                  <option value="random">Random</option>
                </Select>
              </div>
            </div>
          )}

          {vitalType === "ketones" && (
            <div className="space-y-4">
              <p className="rounded-md bg-brand-green/5 dark:bg-brand-green/15 p-3 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                Ketone testing is <strong>optional</strong>: only if you have a blood ketone
                meter or urine strips. Most people don&apos;t, and that&apos;s fine. If your
                sugar is high and you can&apos;t test ketones, just log your glucose reading and
                your care team will contact you to check how you&apos;re feeling and guide you.
              </p>
              <input type="hidden" name="ketone_kind" value={ketoneKind} />
              <div className="space-y-1.5">
                <Label htmlFor="ketone_kind_select">Ketone test</Label>
                <Select
                  id="ketone_kind_select"
                  value={ketoneKind}
                  onChange={(event) => setKetoneKind(event.target.value as KetoneKind)}
                >
                  <option value="blood">Blood ketone meter (mmol/L)</option>
                  <option value="urine">Urine dipstick</option>
                </Select>
              </div>
              {ketoneKind === "blood" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ketones_mmol_l">Blood ketones (mmol/L)</Label>
                  <Input
                    id="ketones_mmol_l"
                    name="ketones_mmol_l"
                    type="number"
                    step="0.1"
                    required
                    {...readingErrorProps}
                  />
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    Test your ketones if your glucose stays high or you feel unwell,
                    especially if you have type 1 diabetes.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="ketone_urine">Urine ketone level</Label>
                  <Select
                    id="ketone_urine"
                    name="ketone_urine"
                    required
                    defaultValue=""
                    {...readingErrorProps}
                  >
                    <option value="" disabled>
                      Match the strip colour
                    </option>
                    <option value="negative">Negative</option>
                    <option value="trace">Trace</option>
                    <option value="small">Small</option>
                    <option value="moderate">Moderate</option>
                    <option value="large">Large</option>
                  </Select>
                </div>
              )}
            </div>
          )}

          {vitalType === "weight" && (
            <div className="space-y-1.5">
              <Label htmlFor="weight_kg">Weight ({WEIGHT_UNIT_LABEL[units.weight]})</Label>
              <UnitConvertedInput
                key={units.weight}
                id="weight_kg"
                name="weight_kg"
                typedIsStored={units.weight === "kg"}
                toStored={(v) => weightToKg(v, units.weight)}
                decimals={1}
                type="number"
                step="0.1"
                required
                {...readingErrorProps}
              />
            </div>
          )}

          {vitalType === "pulse" && (
            <div className="space-y-1.5">
              <Label htmlFor="pulse_bpm">Pulse (bpm)</Label>
              <Input id="pulse_bpm" name="pulse_bpm" type="number" required {...readingErrorProps} />
            </div>
          )}

          {vitalType === "temperature" && (
            <div className="space-y-1.5">
              <Label htmlFor="temperature_c">Temperature ({TEMPERATURE_UNIT_LABEL[units.temperature]})</Label>
              <UnitConvertedInput
                key={units.temperature}
                id="temperature_c"
                name="temperature_c"
                typedIsStored={units.temperature === "c"}
                toStored={(v) => temperatureToC(v, units.temperature)}
                decimals={1}
                type="number"
                step="0.1"
                required
                {...readingErrorProps}
              />
            </div>
          )}

          {vitalType === "spo2" && (
            <div className="space-y-1.5">
              <Label htmlFor="spo2_pct">SpO2 (%)</Label>
              <Input id="spo2_pct" name="spo2_pct" type="number" required {...readingErrorProps} />
            </div>
          )}

          {vitalType === "waist_circumference" && (
            <div className="space-y-1.5">
              <Label htmlFor="waist_cm">Waist circumference ({LENGTH_UNIT_LABEL[units.length]})</Label>
              <UnitConvertedInput
                key={units.length}
                id="waist_cm"
                name="waist_cm"
                typedIsStored={units.length === "cm"}
                toStored={(v) => lengthToCm(v, units.length)}
                decimals={1}
                type="number"
                step="0.5"
                required
                {...fieldErrorProps(errorId, Boolean(displayedError), "waist-measure-hint")}
              />
              <p
                id="waist-measure-hint"
                className="text-xs text-charcoal-ink/60 dark:text-night-ink/60"
              >
                Measure around your middle, just above the hip bones, after breathing out.
                A raised measurement is {formatLength(94, units.length)} or more for men, {formatLength(80, units.length)} or more for women.
              </p>
            </div>
          )}

          {!isOnline && (
            <fieldset className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15" data-testid="offline-symptoms">
              <legend className="px-1 text-sm font-medium">{t("vitals.symptoms.title")}</legend>
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">You are offline. Tick anything you have right now and this screen will tell you what to do.</p>
              {OFFLINE_SYMPTOMS.map((code) => (
                <div key={code} className="flex items-center gap-2">
                  <input
                    id={`offline_symptom_${code}`}
                    type="checkbox"
                    checked={offlineSymptoms.includes(code)}
                    onChange={(event) => toggleOfflineSymptom(code, event.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor={`offline_symptom_${code}`}>{t(offlineSymptomLabelKey(code))}</Label>
                </div>
              ))}
            </fieldset>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Input
              id="note"
              name="note"
              type="text"
              maxLength={500}
              {...fieldErrorProps(errorId, false, "vitals-note-hint")}
            />
            <p id="vitals-note-hint" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Anything worth remembering about this reading. Up to 500 characters.
            </p>
          </div>

          {crosscheck && (
            <div
              role="alert"
              className="rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15 p-3 text-sm"
            >
              <p className="font-medium text-amber-900 dark:text-amber-300">{crosscheck.message}</p>
              <p className="mt-1 text-amber-900/80 dark:text-amber-300/90">Tips for an accurate reading:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-900/80 dark:text-amber-300/90">
                {crosscheck.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={pending} onClick={confirmAndSave}>
                  {pending ? "Saving…" : "Yes, this reading is correct: save it"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCrosscheck(null)}
                >
                  I&apos;ll re-check it
                </Button>
              </div>
            </div>
          )}

          <FormError id={errorId} message={displayedError} />
          <FormSuccess message={state?.success && !ackStale && !offlineBlocked && !crosscheck && vitalSavedMessage(state.bpAckLevel)} />
          {state?.success && state.notice && !ackStale && !offlineBlocked && !crosscheck ? (
            <p data-testid="label-dropped-notice" className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              {state.notice}
            </p>
          ) : null}

          {!crosscheck && (
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save reading"}
            </Button>
          )}
        </form>
      </CardContent>
      {offlineGuidance && <OfflineEmergencyGuidance code={offlineGuidance.code} variant={offlineGuidance.variant} onClose={() => setOfflineGuidance(null)} />}
    </Card>
  );
}
