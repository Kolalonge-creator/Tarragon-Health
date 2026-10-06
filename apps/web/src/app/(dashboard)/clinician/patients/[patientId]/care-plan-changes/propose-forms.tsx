"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/ui/form-error";
import type { MedicationWithCarePlan } from "@/lib/queries/medications";
import type { CarePlanRow } from "@/lib/queries/care-plan-management";
import { proposeMedicineChange, proposeScheduleChange, proposeTargetChange, type CareChangeActionResult } from "./actions";

const BOX = "space-y-3 rounded-md border border-charcoal-ink/10 bg-charcoal-ink/5 p-3 dark:border-night-ink/15 dark:bg-night-ink/5";

function RationaleField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        Why you are proposing this (required)
      </Label>
      <Textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} maxLength={1000} />
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        This stays on the clinical record. It is a draft: the patient does not see it until you sign it, and nothing changes for them until they confirm.
      </p>
    </div>
  );
}

function Footer({ error, pending, label, onCancel, disabled }: { error: string | null; pending: boolean; label: string; onCancel: () => void; disabled?: boolean }) {
  return (
    <>
      <FormError id="propose-error" message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || disabled}>
          {pending ? "Saving..." : label}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </>
  );
}

type Run = (fn: () => Promise<CareChangeActionResult>) => Promise<void>;

function useRunner(onDone: () => void): { error: string | null; pending: boolean; run: Run } {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run: Run = async (fn) => {
    setPending(true);
    setError(null);
    const result = await fn();
    setPending(false);
    if (result.ok) onDone();
    else setError(result.error);
  };
  return { error, pending, run };
}

/** Start a medicine, change a current clinician-issued one, or stop it. The drug, dose and every other value is typed here by a person. */
export function MedicineProposalForm({
  patientId,
  medications,
  onCancel,
  onDone,
}: {
  patientId: string;
  medications: MedicationWithCarePlan[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const current = medications.filter((m) => m.source === "clinician" && m.is_active && m.superseded_at === null);
  const [action, setAction] = useState<"start" | "change" | "stop">("start");
  const [medicationId, setMedicationId] = useState("");
  const [fields, setFields] = useState({
    drug_name: "",
    dose: "",
    frequency: "",
    route: "",
    duration_days: "",
    quantity: "",
    repeats_allowed: "",
    indication: "",
    instructions: "",
  });
  const [rationale, setRationale] = useState("");
  const { error, pending, run } = useRunner(onDone);

  function set<K extends keyof typeof fields>(key: K, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function pickMedication(id: string) {
    setMedicationId(id);
    const m = current.find((x) => x.id === id);
    if (m && action === "change") {
      setFields({
        drug_name: m.drug_name,
        dose: m.dose ?? "",
        frequency: m.frequency ?? "",
        route: m.route ?? "",
        duration_days: m.duration_days != null ? String(m.duration_days) : "",
        quantity: m.quantity ?? "",
        repeats_allowed: String(m.repeats_allowed),
        indication: m.indication ?? "",
        instructions: m.instructions ?? "",
      });
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const item = {
      drug_name: fields.drug_name,
      dose: fields.dose,
      frequency: fields.frequency,
      route: fields.route,
      duration_days: fields.duration_days,
      quantity: fields.quantity,
      repeats_allowed: fields.repeats_allowed === "" ? undefined : fields.repeats_allowed,
      indication: fields.indication,
      instructions: fields.instructions,
    };
    // The form holds every value as text; the action validates and converts with Zod.
    void run(() =>
      action === "stop"
        ? proposeMedicineChange({ action: "stop", patientId, medicationId, rationale })
        : action === "change"
          ? proposeMedicineChange({ action: "change", patientId, medicationId, item, rationale })
          : proposeMedicineChange({ action: "start", patientId, item, rationale })
    );
  }

  const needsMedication = action !== "start";
  const showItem = action !== "stop";

  return (
    <form onSubmit={submit} className={BOX}>
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">Propose a medicine change</p>
      <div className="space-y-1.5">
        <Label htmlFor="change-action" className="text-xs">
          What do you want to do
        </Label>
        <Select
          id="change-action"
          value={action}
          onChange={(event) => {
            setAction(event.target.value as "start" | "change" | "stop");
            setMedicationId("");
          }}
        >
          <option value="start">Start a medicine</option>
          <option value="change">Change a current medicine</option>
          <option value="stop">Stop a current medicine</option>
        </Select>
      </div>
      {needsMedication && (
        <div className="space-y-1.5">
          <Label htmlFor="change-medication" className="text-xs">
            Which medicine
          </Label>
          <Select id="change-medication" value={medicationId} onChange={(event) => pickMedication(event.target.value)}>
            <option value="">Choose one</option>
            {current.map((m) => (
              <option key={m.id} value={m.id}>
                {[m.drug_name, m.dose, m.frequency].filter(Boolean).join(", ")}
              </option>
            ))}
          </Select>
          {current.length === 0 && (
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">This patient has no current medicine issued by the care team to change or stop.</p>
          )}
        </div>
      )}
      {showItem && (
        <div className="grid grid-cols-2 gap-3">
          <Field id="pm-drug" label="Medicine" value={fields.drug_name} onChange={(v) => set("drug_name", v)} required />
          <Field id="pm-dose" label="Dose" value={fields.dose} onChange={(v) => set("dose", v)} />
          <Field id="pm-frequency" label="Frequency" value={fields.frequency} onChange={(v) => set("frequency", v)} />
          <Field id="pm-route" label="Route" value={fields.route} onChange={(v) => set("route", v)} />
          <Field id="pm-duration" label="Duration (days) *" type="number" value={fields.duration_days} onChange={(v) => set("duration_days", v)} required />
          <Field id="pm-quantity" label="Quantity *" value={fields.quantity} onChange={(v) => set("quantity", v)} required />
          <Field id="pm-repeats" label="Repeats allowed" type="number" value={fields.repeats_allowed} onChange={(v) => set("repeats_allowed", v)} />
          <Field id="pm-indication" label="Indication" value={fields.indication} onChange={(v) => set("indication", v)} />
          <div className="col-span-2">
            <Field id="pm-instructions" label="Instructions for the patient" value={fields.instructions} onChange={(v) => set("instructions", v)} />
          </div>
        </div>
      )}
      <RationaleField id="pm-rationale" value={rationale} onChange={setRationale} />
      <Footer error={error} pending={pending} label="Save as a draft" onCancel={onCancel} disabled={needsMedication && medicationId === ""} />
    </form>
  );
}

function Field({ id, label, value, onChange, type, required }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input id={id} type={type} min={type === "number" ? 0 : undefined} value={value} required={required} onChange={(event) => onChange(event.target.value)} className="h-8 text-xs" />
    </div>
  );
}

function PlanPicker({ plans, value, onChange }: { plans: CarePlanRow[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="change-plan" className="text-xs">
        Which care plan
      </Label>
      <Select id="change-plan" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose one</option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.condition.split("_").join(" ")} ({p.status})
          </option>
        ))}
      </Select>
    </div>
  );
}

/** A target or reading schedule change needs a care plan. With none, it says so and offers nothing to submit. */
export function PlanSettingsProposalForm({
  kind,
  patientId,
  plans,
  onCancel,
  onDone,
}: {
  kind: "target" | "schedule";
  patientId: string;
  plans: CarePlanRow[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const [carePlanId, setCarePlanId] = useState("");
  const [rows, setRows] = useState([{ key: "", a: "", b: "" }]);
  const [rationale, setRationale] = useState("");
  const { error, pending, run } = useRunner(onDone);

  if (plans.length === 0) {
    return (
      <div className={BOX}>
        <p className="text-sm text-charcoal-ink dark:text-night-ink">
          This patient has no care plan yet. Create one on the Care plan tab first: a {kind === "target" ? "target" : "reading schedule"} change is made to a plan.
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }

  function setRow(index: number, patch: Partial<{ key: string; a: string; b: string }>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void run(() =>
      kind === "target"
        ? proposeTargetChange({ patientId, carePlanId, rationale, entries: rows.map((r) => ({ key: r.key, min: r.a, max: r.b })) })
        : proposeScheduleChange({ patientId, carePlanId, rationale, entries: rows.map((r) => ({ key: r.key, value: r.a })) })
    );
  }

  return (
    <form onSubmit={submit} className={BOX}>
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
        {kind === "target" ? "Propose a target change" : "Propose a reading schedule change"}
      </p>
      <PlanPicker plans={plans} value={carePlanId} onChange={setCarePlanId} />
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-3 gap-2">
          <Field
            id={`ps-key-${index}`}
            label={kind === "target" ? "Target (for example blood pressure systolic)" : "Reading (for example blood pressure)"}
            value={row.key}
            onChange={(v) => setRow(index, { key: v })}
          />
          {kind === "target" ? (
            <>
              <Field id={`ps-min-${index}`} label="Lowest" type="number" value={row.a} onChange={(v) => setRow(index, { a: v })} />
              <Field id={`ps-max-${index}`} label="Highest" type="number" value={row.b} onChange={(v) => setRow(index, { b: v })} />
            </>
          ) : (
            <div className="col-span-2">
              <Field id={`ps-value-${index}`} label="How often or when (for example twice a day)" value={row.a} onChange={(v) => setRow(index, { a: v })} />
            </div>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setRows((prev) => [...prev, { key: "", a: "", b: "" }])} disabled={rows.length >= 12}>
          Add another
        </Button>
        {rows.length > 1 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setRows((prev) => prev.slice(0, -1))}>
            Remove last
          </Button>
        )}
      </div>
      <RationaleField id="ps-rationale" value={rationale} onChange={setRationale} />
      <Footer error={error} pending={pending} label="Save as a draft" onCancel={onCancel} disabled={carePlanId === ""} />
    </form>
  );
}
