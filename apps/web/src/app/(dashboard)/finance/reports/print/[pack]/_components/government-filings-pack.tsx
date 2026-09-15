"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useCompanyProfile, useIncomeStatement, useTaxSummary, useComplianceCalendarForYear } from "@/lib/finance/queries";
import { ReportLetterhead } from "./letterhead";
import { PrintToolbar } from "./print-toolbar";
import {
  PrintSection,
  PrintTable,
  PrintTh,
  PrintTd,
  PrintEmpty,
  PrintKeyValue,
  Disclaimer,
  formatMinor,
} from "./print-primitives";

const STATUS_VARIANT: Record<string, "green" | "amber" | "red" | "grey"> = {
  filed: "green",
  due_soon: "amber",
  overdue: "red",
  upcoming: "grey",
};

function particular(label: string, value: string | null | undefined) {
  return { label, value: value || "not on file" };
}

export function GovernmentFilingsPack({ year }: { year: number }) {
  const profile = useCompanyProfile();
  const pnl = useIncomeStatement(`${year}-01-01`, `${year}-12-31`, "NGN");
  const tax = useTaxSummary(`${year}-01-01`, `${year}-12-31`, "NGN");
  const calendar = useComplianceCalendarForYear(year);

  const rows = useMemo(
    () => [...(calendar.data ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [calendar.data],
  );
  const netVat = (tax.data?.output_vat_minor ?? 0) - (tax.data?.input_vat_minor ?? 0);

  const particulars = [
    particular("Legal name", profile.data?.legal_name),
    particular("Trading name", profile.data?.trading_name),
    particular("RC number (CAC)", profile.data?.rc_number),
    particular("FIRS TIN", profile.data?.tin),
    particular("VAT registration number", profile.data?.vat_registration_number),
    particular("NSITF employer number", profile.data?.nsitf_number),
    particular("ITF employer number", profile.data?.itf_number),
    particular("PenCom / PFA code", profile.data?.pension_pfa_code),
    particular("Date of incorporation", profile.data?.incorporation_date),
    particular("Financial year end", profile.data?.financial_year_end),
    particular("Principal business activity", profile.data?.principal_business_activity),
    particular("Registered address", profile.data?.registered_address),
    particular("Directors (as filed)", profile.data?.directors_text),
    particular("Company secretary", profile.data?.company_secretary_name),
    particular("External auditor", profile.data?.auditor_name),
  ];

  return (
    <div>
      <PrintToolbar />
      <ReportLetterhead
        title="Government filings pack"
        subtitle={`Financial year ${year} · Nigeria: CAC, FIRS, PAYE, pension, NHF, NSITF and ITF`}
      />

      <Disclaimer>
        This pack assembles what the ledger and the compliance calendar already know for {year}. It
        does not file, submit or lodge anything with CAC, FIRS, PENCOM, NSITF, ITF or any other agency,
        and it is not tax or legal advice. Confirm every figure and every due date with a licensed
        accountant/tax adviser before relying on it for an actual submission.
      </Disclaimer>

      <PrintSection title="Company particulars" description="Printed on every filing that asks for them.">
        <div className="grid grid-cols-2 gap-x-8">
          {particulars.map((p) => (
            <PrintKeyValue key={p.label} label={p.label} value={p.value} />
          ))}
        </div>
      </PrintSection>

      <PrintSection
        title="Companies Income Tax (CIT): indicative position"
        description="Profit before tax for the year, from the ledger's income statement. Nigeria's CIT rate depends on turnover band (0%/20%/30% under the current Finance Act). This pack does not compute a liability figure; take the figures below to your tax adviser for the actual CIT/TET computation."
      >
        {pnl.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (
          <div className="max-w-sm">
            <PrintKeyValue label="Revenue" value={formatMinor(pnl.data?.net_revenue_minor ?? 0, "NGN")} />
            <PrintKeyValue label="Expenses" value={formatMinor(pnl.data?.expense_minor ?? 0, "NGN")} />
            <PrintKeyValue label="Net income (profit before tax)" value={formatMinor(pnl.data?.net_income_minor ?? 0, "NGN")} strong />
          </div>
        )}
      </PrintSection>

      <PrintSection title="VAT & WHT summary (FIRS)" description={`${year}, aggregated from the tax accounts.`}>
        {tax.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-8 sm:max-w-2xl">
              <PrintKeyValue label="Output VAT" value={formatMinor(tax.data?.output_vat_minor ?? 0, "NGN")} />
              <PrintKeyValue label="Input VAT recoverable" value={formatMinor(tax.data?.input_vat_minor ?? 0, "NGN")} />
              <PrintKeyValue label="Net VAT payable" value={formatMinor(netVat, "NGN")} strong />
              <PrintKeyValue label="WHT payable" value={formatMinor(tax.data?.wht_payable_minor ?? 0, "NGN")} strong />
            </div>
            {(tax.data?.revenue_by_vat_treatment ?? []).length > 0 && (
              <div className="mt-3">
                <PrintTable>
                  <thead>
                    <tr><PrintTh>Revenue by VAT treatment</PrintTh><PrintTh right>Amount</PrintTh></tr>
                  </thead>
                  <tbody>
                    {(tax.data?.revenue_by_vat_treatment ?? []).map((r) => (
                      <tr key={r.treatment}>
                        <PrintTd>{r.treatment.replace(/_/g, " ")}</PrintTd>
                        <PrintTd right>{formatMinor(r.revenue_minor, "NGN")}</PrintTd>
                      </tr>
                    ))}
                  </tbody>
                </PrintTable>
              </div>
            )}
          </>
        )}
      </PrintSection>

      <PrintSection
        title={`Filing calendar for ${year}`}
        description="Every recurring and annual statutory obligation the platform tracks, with due dates and filed status."
        breakBefore
      >
        {calendar.isLoading ? (
          <PrintEmpty>Loading…</PrintEmpty>
        ) : rows.length === 0 ? (
          <PrintEmpty>Nothing configured.</PrintEmpty>
        ) : (
          <PrintTable>
            <thead>
              <tr>
                <PrintTh>Obligation</PrintTh>
                <PrintTh>Agency</PrintTh>
                <PrintTh>Period</PrintTh>
                <PrintTh>Due</PrintTh>
                <PrintTh>Status</PrintTh>
                <PrintTh right>Amount / reference</PrintTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.obligation_code}-${r.period_label}`}>
                  <PrintTd>{r.obligation_name}</PrintTd>
                  <PrintTd muted>{r.agency}</PrintTd>
                  <PrintTd muted>{r.period_label}</PrintTd>
                  <PrintTd muted>{r.due_date}</PrintTd>
                  <PrintTd>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "grey"}>{r.status.replace(/_/g, " ")}</Badge>
                  </PrintTd>
                  <PrintTd right muted>
                    {r.amount_minor != null ? formatMinor(r.amount_minor, "NGN") : ""}
                    {r.remittance_reference ? ` · ${r.remittance_reference}` : ""}
                  </PrintTd>
                </tr>
              ))}
            </tbody>
          </PrintTable>
        )}
      </PrintSection>

      <p className="mt-6 text-[10px] text-charcoal-ink/40 print-avoid-break">
        Also worth reviewing before {year}&apos;s filings close out: NDPC data-protection registration
        status and the platform&apos;s pension/NSITF/ITF exposure once payroll is processed on-platform.
        None of that is tracked here yet. Day-to-day filing tracking (mark as filed, remittance
        references) lives on Finance → Compliance calendar.
      </p>
    </div>
  );
}
