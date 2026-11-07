"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import type { Course } from "@/lib/people/training";
import type { Department } from "@/lib/people/directory";
import { ROLE_LABEL } from "@/lib/people/directory";
import type { PeopleActionState } from "./actions";
import { addRequirement, recordCompletion, removeRequirement, saveCourse, setRequirementDue, verifyCompletion, voidCompletion } from "./training-actions";

const SELECT = "min-h-11 w-full rounded-md border px-3 py-2 text-sm";

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={htmlFor} className="font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-charcoal-ink/60">{hint}</p>}
    </div>
  );
}

function Outcome({ id, state }: { id: string; state: PeopleActionState }) {
  return (
    <>
      <FormError id={id} message={state?.error} />
      <FormSuccess message={state?.message} />
    </>
  );
}

export function CourseForm({ course }: { course?: Course }) {
  const [state, action, pending] = useActionState<PeopleActionState, FormData>(saveCourse, undefined);
  const k = course?.id ?? "new";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {course && <input type="hidden" name="id" value={course.id} />}
      <Field label="Course name" htmlFor={`cname-${k}`}>
        <Input id={`cname-${k}`} name="name" defaultValue={course?.name ?? ""} maxLength={120} required />
      </Field>
      <Field label="Kind" htmlFor={`ccat-${k}`}>
        <select id={`ccat-${k}`} name="category" defaultValue={course?.category ?? "mandatory"} className={SELECT}>
          <option value="mandatory">Mandatory</option>
          <option value="professional">Professional development</option>
        </select>
      </Field>
      <Field label="Provider" htmlFor={`cprov-${k}`}>
        <Input id={`cprov-${k}`} name="provider" defaultValue={course?.provider ?? ""} maxLength={120} />
      </Field>
      <Field label="Renew every (months)" htmlFor={`cren-${k}`} hint="Leave empty if it never needs renewing.">
        <Input id={`cren-${k}`} name="renewalMonths" type="number" min={1} max={120} defaultValue={course?.renewal_months ?? ""} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="What it covers" htmlFor={`cdesc-${k}`}>
          <Input id={`cdesc-${k}`} name="description" defaultValue={course?.description ?? ""} maxLength={500} />
        </Field>
      </div>
      {course && (
        <Field label="Status" htmlFor={`cact-${k}`} hint="A course no longer used stops applying; its records are kept.">
          <select id={`cact-${k}`} name="active" defaultValue={course.is_active ? "true" : "false"} className={SELECT}>
            <option value="true">In use</option>
            <option value="false">No longer used</option>
          </select>
        </Field>
      )}
      <div className="space-y-2 sm:col-span-2">
        <Button type="submit" variant={course ? "outline" : "default"} disabled={pending}>{pending ? "Saving..." : course ? "Save" : "Add course"}</Button>
        <Outcome id={`course-error-${k}`} state={state} />
      </div>
    </form>
  );
}

export function RequirementForm({ courses, departments }: { courses: Course[]; departments: Department[] }) {
  const [state, action, pending] = useActionState<PeopleActionState, FormData>(addRequirement, undefined);
  const [appliesTo, setAppliesTo] = useState<"everyone" | "role" | "department">("everyone");
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4">
      <Field label="Course" htmlFor="rcourse">
        <select id="rcourse" name="courseId" className={SELECT} required defaultValue="">
          <option value="" disabled>Choose</option>
          {courses.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Who must do it" htmlFor="rapplies">
        <select id="rapplies" name="appliesTo" className={SELECT} value={appliesTo}
          onChange={(e) => setAppliesTo(e.target.value === "role" ? "role" : e.target.value === "department" ? "department" : "everyone")}>
          <option value="everyone">Everyone</option>
          <option value="role">Everyone with a role</option>
          <option value="department">Everyone in a department</option>
        </select>
      </Field>
      {appliesTo === "role" && (
        <Field label="Role" htmlFor="rrole">
          <select id="rrole" name="role" className={SELECT} defaultValue="">
            <option value="" disabled>Choose</option>
            {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      )}
      {appliesTo === "department" && (
        <Field label="Department" htmlFor="rdept">
          <select id="rdept" name="departmentId" className={SELECT} defaultValue="">
            <option value="" disabled>Choose</option>
            {departments.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Due within (days)" htmlFor="rdue" hint="Counted from their start date, or from today for people already here.">
        <Input id="rdue" name="dueWithinDays" type="number" min={0} max={365} defaultValue={30} required />
      </Field>
      <div className="space-y-2 sm:col-span-4">
        <Button type="submit" disabled={pending}>{pending ? "Adding..." : "Add requirement"}</Button>
        <Outcome id="requirement-error" state={state} />
      </div>
    </form>
  );
}

export function DueDaysForm({ requirementId, days }: { requirementId: string; days: number }) {
  const [state, action, pending] = useActionState<PeopleActionState, FormData>(setRequirementDue, undefined);
  return (
    <form action={action} className="inline-flex flex-col">
      <input type="hidden" name="requirementId" value={requirementId} />
      <span className="flex items-center gap-2 text-sm">
        <label htmlFor={`due-${requirementId}`}>Due within</label>
        <Input id={`due-${requirementId}`} name="dueWithinDays" type="number" min={0} max={365} defaultValue={days} className="w-20" />
        <span>days</span>
        <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
      </span>
      <FormError id={`due-e-${requirementId}`} message={state?.error} />
      <FormSuccess message={state?.message} />
    </form>
  );
}

export function RemoveRequirementButton({ requirementId }: { requirementId: string }) {
  const [state, action, pending] = useActionState<PeopleActionState, FormData>(removeRequirement, undefined);
  return (
    <form action={action} className="inline-flex flex-col">
      <input type="hidden" name="requirementId" value={requirementId} />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Removing..." : "Remove"}</Button>
      <FormError id={`rm-${requirementId}`} message={state?.error} />
    </form>
  );
}

export function CompletionForm({ profileId, courses, isSelf, today }: { profileId: string; courses: Course[]; isSelf: boolean; today: string }) {
  const [state, action, pending] = useActionState<PeopleActionState, FormData>(recordCompletion, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="profileId" value={profileId} />
      <Field label="Course" htmlFor="ccourse">
        <select id="ccourse" name="courseId" className={SELECT} required defaultValue="">
          <option value="" disabled>Choose</option>
          {courses.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Completed on" htmlFor="ccompleted">
        <Input id="ccompleted" name="completedOn" type="date" max={today} defaultValue={today} required />
      </Field>
      <Field label="Certificate or reference" htmlFor="cevidence" hint="For example the certificate number. No file upload yet.">
        <Input id="cevidence" name="evidenceReference" maxLength={200} />
      </Field>
      <Field label="Note" htmlFor="cnote">
        <Input id="cnote" name="note" maxLength={500} />
      </Field>
      {isSelf ? (
        <p className="text-sm text-charcoal-ink/70 sm:col-span-2">This is your own record, so another admin must verify it.</p>
      ) : (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="verified" /> I have seen the certificate or evidence (verify now)
        </label>
      )}
      <div className="space-y-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Record completion"}</Button>
        <Outcome id="completion-error" state={state} />
      </div>
    </form>
  );
}

export function VerifyButton({ completionId }: { completionId: string }) {
  const [state, action, pending] = useActionState<PeopleActionState, FormData>(verifyCompletion, undefined);
  return (
    <form action={action} className="inline-flex flex-col">
      <input type="hidden" name="completionId" value={completionId} />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Verifying..." : "Verify"}</Button>
      <FormError id={`v-${completionId}`} message={state?.error} />
    </form>
  );
}

export function VoidForm({ completionId }: { completionId: string }) {
  const [state, action, pending] = useActionState<PeopleActionState, FormData>(voidCompletion, undefined);
  const [open, setOpen] = useState(false);
  if (!open) {
    return <Button type="button" variant="ghost" onClick={() => setOpen(true)}>Void</Button>;
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="completionId" value={completionId} />
      <label className="sr-only" htmlFor={`void-${completionId}`}>Why this record is wrong</label>
      <Input id={`void-${completionId}`} name="reason" minLength={10} maxLength={500} placeholder="Why this record is wrong" className="min-w-64" />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Voiding..." : "Void record"}</Button>
      <FormError id={`ve-${completionId}`} message={state?.error} />
    </form>
  );
}
