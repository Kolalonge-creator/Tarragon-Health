"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { upsertCompanyProfileAction, type CompanyProfileInput } from "@/lib/finance/actions";
import type { CompanyProfile } from "@/lib/finance/schemas";

function toInput(p: CompanyProfile): CompanyProfileInput {
  return {
    legal_name: p.legal_name ?? "",
    trading_name: p.trading_name ?? "",
    rc_number: p.rc_number ?? "",
    tin: p.tin ?? "",
    vat_registration_number: p.vat_registration_number ?? "",
    nsitf_number: p.nsitf_number ?? "",
    itf_number: p.itf_number ?? "",
    pension_pfa_code: p.pension_pfa_code ?? "",
    registered_address: p.registered_address ?? "",
    principal_business_activity: p.principal_business_activity ?? "",
    incorporation_date: p.incorporation_date ?? "",
    financial_year_end: p.financial_year_end || "31 December",
    registered_email: p.registered_email ?? "",
    registered_phone: p.registered_phone ?? "",
    directors_text: p.directors_text ?? "",
    company_secretary_name: p.company_secretary_name ?? "",
    auditor_name: p.auditor_name ?? "",
    bank_name: p.bank_name ?? "",
    bank_account_name: p.bank_account_name ?? "",
    bank_account_number: p.bank_account_number ?? "",
  };
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-clinical-navy">{title}</CardTitle>
        {description && <p className="mt-1 text-xs text-charcoal-ink/60">{description}</p>}
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <Label>{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function CompanyProfileForm({ initial }: { initial: CompanyProfile }) {
  const router = useRouter();
  const [form, setForm] = useState<CompanyProfileInput>(toInput(initial));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function set<K extends keyof CompanyProfileInput>(key: K, value: CompanyProfileInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await upsertCompanyProfileAction(form);
    setSaving(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not save." });
    setMsg({ ok: true, text: "Saved. Every printed finance report now uses these details." });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Section
        title="Registration"
        description="As registered with the Corporate Affairs Commission (CAC)."
      >
        <Field label="Legal name" value={form.legal_name} onChange={(v) => set("legal_name", v)} placeholder="e.g. Tarragon Health Limited" />
        <Field label="Trading name" value={form.trading_name} onChange={(v) => set("trading_name", v)} placeholder="TarragonHealth" />
        <Field label="RC number" value={form.rc_number} onChange={(v) => set("rc_number", v)} placeholder="RC1234567" />
        <Field label="Date of incorporation" value={form.incorporation_date} onChange={(v) => set("incorporation_date", v)} type="date" />
        <Field
          label="Principal business activity"
          value={form.principal_business_activity}
          onChange={(v) => set("principal_business_activity", v)}
          placeholder="Digital health / chronic disease and preventive care coordination"
          full
        />
      </Section>

      <Section title="Tax & statutory registrations" description="Confirm current numbers before filing anywhere. This page only stores what you enter.">
        <Field label="FIRS TIN" value={form.tin} onChange={(v) => set("tin", v)} />
        <Field label="VAT registration number" value={form.vat_registration_number} onChange={(v) => set("vat_registration_number", v)} />
        <Field label="NSITF employer number" value={form.nsitf_number} onChange={(v) => set("nsitf_number", v)} />
        <Field label="ITF employer number" value={form.itf_number} onChange={(v) => set("itf_number", v)} />
        <Field label="PenCom / PFA code" value={form.pension_pfa_code} onChange={(v) => set("pension_pfa_code", v)} />
        <Field label="Financial year end" value={form.financial_year_end} onChange={(v) => set("financial_year_end", v)} placeholder="31 December" />
      </Section>

      <Section title="Registered office & contact">
        <div className="sm:col-span-2">
          <Label>Registered address</Label>
          <Textarea rows={2} value={form.registered_address} onChange={(e) => set("registered_address", e.target.value)} />
        </div>
        <Field label="Registered email" value={form.registered_email} onChange={(v) => set("registered_email", v)} type="email" />
        <Field label="Registered phone" value={form.registered_phone} onChange={(v) => set("registered_phone", v)} placeholder="+234…" />
      </Section>

      <Section title="Governance" description="Free text: this page doesn't model a directors table; keep it in sync with what's actually on file at CAC.">
        <div className="sm:col-span-2">
          <Label>Directors (as filed with CAC)</Label>
          <Textarea rows={3} value={form.directors_text} onChange={(e) => set("directors_text", e.target.value)} placeholder="One per line" />
        </div>
        <Field label="Company secretary" value={form.company_secretary_name} onChange={(v) => set("company_secretary_name", v)} />
        <Field label="External auditor" value={form.auditor_name} onChange={(v) => set("auditor_name", v)} />
      </Section>

      <Section title="Settlement bank details" description="Shown on the audit pack's reconciliation cover sheet only.">
        <Field label="Bank name" value={form.bank_name} onChange={(v) => set("bank_name", v)} />
        <Field label="Account name" value={form.bank_account_name} onChange={(v) => set("bank_account_name", v)} />
        <Field label="Account number" value={form.bank_account_number} onChange={(v) => set("bank_account_number", v)} />
      </Section>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save company profile"}
        </Button>
        {msg && <p className={`text-sm ${msg.ok ? "text-brand-green" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
