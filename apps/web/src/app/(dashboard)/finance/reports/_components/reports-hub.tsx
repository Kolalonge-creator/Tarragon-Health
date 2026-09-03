"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useCompanyProfile } from "@/lib/finance/queries";

const CURRENCIES = ["NGN", "GBP", "USD"];
const today = () => new Date().toISOString().slice(0, 10);
const yearStart = (y: number) => `${y}-01-01`;
const thisYear = new Date().getFullYear();
const YEARS = [thisYear, thisYear - 1, thisYear - 2];

function PackCard({
  title,
  description,
  children,
  href,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-clinical-navy">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        <Button asChild className="w-full">
          <a href={href} target="_blank" rel="noopener noreferrer">
            Open printable report
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ReportsHub() {
  const profile = useCompanyProfile();
  const [govYear, setGovYear] = useState(thisYear);
  const [currency, setCurrency] = useState("NGN");
  const [invFrom, setInvFrom] = useState(yearStart(thisYear));
  const [invTo, setInvTo] = useState(today());
  const [audFrom, setAudFrom] = useState(yearStart(thisYear));
  const [audTo, setAudTo] = useState(today());

  const profileIncomplete = useMemo(() => {
    if (!profile.data) return false;
    return !profile.data.legal_name || !profile.data.rc_number || !profile.data.tin;
  }, [profile.data]);

  const govHref = `/finance/reports/print/government-filings?year=${govYear}`;
  const invHref = `/finance/reports/print/investor-pack?from=${invFrom}&to=${invTo}&currency=${currency}`;
  const audHref = `/finance/reports/print/audit-pack?from=${audFrom}&to=${audTo}&currency=${currency}`;

  return (
    <div className="space-y-6">
      {!profile.isLoading && profileIncomplete && (
        <p className="rounded-md bg-sprout-gold/10 px-3 py-2 text-xs text-charcoal-ink/70">
          The company&apos;s legal name, RC number or TIN isn&apos;t on file yet, so every report below
          will print with blanks on its letterhead. A super admin can fill it in at{" "}
          <Link href="/admin/settings/company-profile" className="font-medium text-brand-green underline">
            Company &amp; legal profile
          </Link>
          .
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <PackCard
          title="Government filings pack"
          description="Everything due to a Nigerian government agency for the year: CAC, FIRS (CIT/VAT/WHT), PAYE, pension, NHF, NSITF, ITF, with amounts read from the ledger where possible."
          href={govHref}
        >
          <div>
            <Label>Financial year</Label>
            <Select value={String(govYear)} onChange={(e) => setGovYear(Number(e.target.value))}>
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </div>
        </PackCard>

        <PackCard
          title="Fundraising / investor pack"
          description="A due-diligence-ready cover sheet: KPI summary, income statement, balance sheet and cash flow statement for the period, with trial balance as an appendix."
          href={invHref}
        >
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <Label>Currency</Label>
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div className="col-span-1">
              <Label>From</Label>
              <Input type="date" value={invFrom} onChange={(e) => setInvFrom(e.target.value)} />
            </div>
            <div className="col-span-1">
              <Label>To</Label>
              <Input type="date" value={invTo} onChange={(e) => setInvTo(e.target.value)} />
            </div>
          </div>
        </PackCard>

        <PackCard
          title="Audit & management pack"
          description="The folder for an internal review or an external auditor: trial balance, full general ledger, reconciliation, AP aging, budget variance, approvals and the finance system audit trail."
          href={audHref}
        >
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <Label>Currency</Label>
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div className="col-span-1">
              <Label>From</Label>
              <Input type="date" value={audFrom} onChange={(e) => setAudFrom(e.target.value)} />
            </div>
            <div className="col-span-1">
              <Label>To</Label>
              <Input type="date" value={audTo} onChange={(e) => setAudTo(e.target.value)} />
            </div>
          </div>
        </PackCard>
      </div>

      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        These packs assemble what the ledger and the compliance calendar already know. They are not
        filing engines and don&apos;t submit anything to any agency, and none of this is tax or legal
        advice. Confirm figures with a licensed adviser before relying on them for an actual submission.
        Day-to-day tracking of individual filings (mark as filed, remittance references) still lives on
        the Compliance calendar tab.
      </p>
    </div>
  );
}
