"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import {
  CHANGE_KIND_LABEL,
  CHANGE_KINDS,
  LEAVING_KINDS,
  NOTE_REQUIRED_KINDS,
  PATTERN_LABEL,
  STATUS_LABEL,
  type ChangeKind,
  type CurrentPosition,
  type Department,
  type PersonalDetails,
} from "@/lib/people/directory";
import { recordEmploymentChange, saveDepartment, savePersonalDetails, type PeopleActionState } from "./actions";

const SELECT = "min-h-11 w-full rounded-md border px-3 py-2 text-sm";
const FIELD = "space-y-1 text-sm";

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className={FIELD}>
      <label htmlFor={htmlFor} className="font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-charcoal-ink/60">{hint}</p>}
    </div>
  );
}

/** The status a change kind implies, so the form starts on the value the database will accept. */
type Status = NonNullable<CurrentPosition["employment_status"]>;

function statusFor(kind: ChangeKind, current: Status | null): Status {
  if (LEAVING_KINDS.includes(kind)) return "left";
  if (kind === "suspension") return "suspended";
  if (kind === "return_to_work") return "active";
  if (kind === "appointment") return "onboarding";
  return current && current !== "left" ? current : "active";
}

export function EmploymentChangeForm({
  profileId,
  current,
  isClinician,
  departments,
  managers,
  today,
}: {
  profileId: string;
  current: CurrentPosition | null;
  isClinician: boolean;
  departments: Department[];
  managers: Array<{ id: string; name: string }>;
  today: string;
}) {
  const [state, action, pending] = useActionState<PeopleActionState, FormData>(recordEmploymentChange, undefined);
  const firstKind: ChangeKind = !current || current.employment_status === "left" ? "appointment" : "transfer";
  const [kind, setKind] = useState<ChangeKind>(firstKind);
  const [status, setStatus] = useState(statusFor(firstKind, current?.employment_status ?? null));
  // Mirrors the database rules: appointment first; after leaving only a new appointment or a correction; return to work only
  // from a suspension.
  const allowedKinds = CHANGE_KINDS.filter((k) => {
    if (!current) return k === "appointment";
    if (current.employment_status === "left") return k === "appointment" || k === "correction";
    if (k === "return_to_work") return current.employment_status === "suspended";
    return k !== "appointment";
  });
  const keep = current && current.employment_status !== "left" ? current : null;

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="profileId" value={profileId} />
      <Field label="What is changing" htmlFor="changeKind">
        <select
          id="changeKind"
          name="changeKind"
          className={SELECT}
          value={kind}
          onChange={(e) => {
            const k = CHANGE_KINDS.find((c) => c === e.target.value) ?? firstKind;
            setKind(k);
            setStatus(statusFor(k, current?.employment_status ?? null));
          }}
        >
          {allowedKinds.map((k) => <option key={k} value={k}>{CHANGE_KIND_LABEL[k]}</option>)}
        </select>
      </Field>
      <Field label="Takes effect on" htmlFor="effectiveFrom">
        <Input id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={today} required />
      </Field>
      <Field label="Job title" htmlFor="jobTitle">
        <Input id="jobTitle" name="jobTitle" defaultValue={keep?.job_title ?? ""} maxLength={120} required />
      </Field>
      <Field label="Employment status" htmlFor="employmentStatus">
        <select id="employmentStatus" name="employmentStatus" className={SELECT} value={status}
          onChange={(e) => setStatus(e.target.value === "left" ? "left" : e.target.value === "suspended" ? "suspended" : e.target.value === "onboarding" ? "onboarding" : "active")}>
          {(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </Field>
      <Field label="Department" htmlFor="departmentId">
        <select id="departmentId" name="departmentId" className={SELECT} defaultValue={keep?.department_id ?? ""}>
          <option value="">Not set</option>
          {departments.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <Field label="Line manager" htmlFor="lineManagerId" hint="Approves their leave once leave requests are live; an admin approves when none is set.">
        <select id="lineManagerId" name="lineManagerId" className={SELECT} defaultValue={keep?.line_manager_id ?? ""}>
          <option value="">None</option>
          {managers.filter((m) => m.id !== profileId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      {isClinician ? (
        <p className="text-sm text-charcoal-ink/70 sm:col-span-2">
          Employed or contracted is set on their clinical staff record, because it decides whether individual indemnity cover is required.
        </p>
      ) : (
        <Field label="Employed or contracted" htmlFor="engagement">
          <select id="engagement" name="engagement" className={SELECT} defaultValue={keep?.engagement ?? "employed"}>
            <option value="employed">Employed</option>
            <option value="contracted">Contracted</option>
          </select>
        </Field>
      )}
      <Field label="Working pattern" htmlFor="workPattern">
        <select id="workPattern" name="workPattern" className={SELECT} defaultValue={keep?.work_pattern ?? "full_time"}>
          {(Object.keys(PATTERN_LABEL) as Array<keyof typeof PATTERN_LABEL>).map((p) => <option key={p} value={p}>{PATTERN_LABEL[p]}</option>)}
        </select>
      </Field>
      <Field label="Employment start date" htmlFor="startDate">
        <Input id="startDate" name="startDate" type="date" defaultValue={keep?.start_date ?? today} required />
      </Field>
      <Field label="Contract end date" htmlFor="contractEndDate" hint="Leave empty for a permanent contract.">
        <Input id="contractEndDate" name="contractEndDate" type="date" defaultValue={keep?.contract_end_date ?? ""} />
      </Field>
      <Field label="Contracted hours a week" htmlFor="hours">
        <Input id="hours" name="hours" type="number" min={0} max={80} step={0.5} defaultValue={keep?.contracted_hours_per_week ?? ""} />
      </Field>
      <Field label="Main work location" htmlFor="workLocation">
        <Input id="workLocation" name="workLocation" defaultValue={keep?.work_location ?? ""} maxLength={120} placeholder="For example Lagos, or remote" />
      </Field>
      <div className="sm:col-span-2">
        <Field label={NOTE_REQUIRED_KINDS.includes(kind) ? "Note (required)" : "Note"} htmlFor="note"
          hint="Kept with the record. Do not include health information.">
          <textarea id="note" name="note" maxLength={1000} rows={3} className="w-full rounded-md border px-3 py-2 text-sm" />
        </Field>
      </div>
      {LEAVING_KINDS.includes(kind) && (
        <p className="text-sm text-charcoal-ink/70 sm:col-span-2">
          Recording a leaving date does not switch off their sign-in. Do that on their member page; this person will show on the HR overview until it is done.
        </p>
      )}
      <div className="space-y-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save to employment history"}</Button>
        <FormError id="employment-error" message={state?.error} />
        <FormSuccess message={state?.message} />
      </div>
    </form>
  );
}

export function DepartmentForm({ department, staff }: { department?: Department; staff: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState<PeopleActionState, FormData>(saveDepartment, undefined);
  const key = department?.id ?? "new";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {department && <input type="hidden" name="id" value={department.id} />}
      <Field label="Name" htmlFor={`name-${key}`}>
        <Input id={`name-${key}`} name="name" defaultValue={department?.name ?? ""} maxLength={80} required />
      </Field>
      <Field label="Head of department" htmlFor={`head-${key}`}>
        <select id={`head-${key}`} name="headId" className={SELECT} defaultValue={department?.head_profile_id ?? ""}>
          <option value="">Not set</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="What it does" htmlFor={`desc-${key}`}>
          <Input id={`desc-${key}`} name="description" defaultValue={department?.description ?? ""} maxLength={500} />
        </Field>
      </div>
      {department && (
        <Field label="Status" htmlFor={`active-${key}`}>
          <select id={`active-${key}`} name="active" className={SELECT} defaultValue={department.is_active ? "true" : "false"}>
            <option value="true">In use</option>
            <option value="false">No longer used</option>
          </select>
        </Field>
      )}
      <div className="space-y-2 sm:col-span-2">
        <Button type="submit" variant={department ? "outline" : "default"} disabled={pending}>
          {pending ? "Saving..." : department ? "Save" : "Add department"}
        </Button>
        <FormError id={`dept-error-${key}`} message={state?.error} />
        <FormSuccess message={state?.message} />
      </div>
    </form>
  );
}

export function PersonalDetailsForm({ profileId, details }: { profileId: string; details: PersonalDetails }) {
  const [state, action, pending] = useActionState<PeopleActionState, FormData>(savePersonalDetails, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="profileId" value={profileId} />
      <Field label="Emergency contact name" htmlFor="emergencyName">
        <Input id="emergencyName" name="emergencyName" defaultValue={details?.emergency_contact_name ?? ""} maxLength={120} />
      </Field>
      <Field label="Relationship" htmlFor="emergencyRelationship">
        <Input id="emergencyRelationship" name="emergencyRelationship" defaultValue={details?.emergency_contact_relationship ?? ""} maxLength={60} />
      </Field>
      <Field label="Emergency contact phone" htmlFor="emergencyPhone" hint="International form, for example +2348031234567.">
        <Input id="emergencyPhone" name="emergencyPhone" type="tel" defaultValue={details?.emergency_contact_phone ?? ""} />
      </Field>
      <Field label="National ID number (NIN)" htmlFor="nationalId" hint="11 digits. Only admins can set or change it.">
        <Input id="nationalId" name="nationalId" inputMode="numeric" autoComplete="off" defaultValue={details?.national_id_number ?? ""} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Home address" htmlFor="homeAddress">
          <textarea id="homeAddress" name="homeAddress" maxLength={400} rows={2} defaultValue={details?.home_address ?? ""}
            className="w-full rounded-md border px-3 py-2 text-sm" />
        </Field>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save personal details"}</Button>
        <FormError id="personal-error" message={state?.error} />
        <FormSuccess message={state?.message} />
      </div>
    </form>
  );
}
