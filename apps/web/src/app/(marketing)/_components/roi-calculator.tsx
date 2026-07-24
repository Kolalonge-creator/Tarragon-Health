"use client";

import { useState } from "react";

/**
 * Interactive, honest ROI sketch for the B2B pages (the Sword pattern).
 * Every number is an editable assumption and the output carries a persistent
 * "modeled estimate" disclaimer; no footnoted magic. The default cost-per-
 * catch mirrors the platform's own modeled constant (₦150,000/abnormal
 * catch, the same admin-tunable figure behind the B2B dashboards) and the
 * catch rate reflects a conservative screening yield assumption; both are
 * inputs the visitor can change, not claims.
 */
export function RoiCalculator() {
  const [employees, setEmployees] = useState(200);
  const [screenRate, setScreenRate] = useState(70);
  const [catchPer100, setCatchPer100] = useState(6);
  const [costPerCatch, setCostPerCatch] = useState(150_000);

  const screened = Math.round((employees * screenRate) / 100);
  const catches = Math.round((screened * catchPer100) / 100);
  const avoided = catches * costPerCatch;

  const fmt = (n: number) => `₦${n.toLocaleString()}`;

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-charcoal-ink/10 bg-white p-8 shadow-sm">
      <h3 className="font-heading text-2xl font-semibold text-charcoal-ink">
        Sketch the numbers for your workforce
      </h3>
      <p className="mt-2 text-charcoal-ink/70">
        Move the sliders: every figure is an assumption you control, not a promise.
      </p>
      <div className="mt-6 space-y-5">
        <div>
          <label htmlFor="roi-employees" className="flex justify-between text-sm font-medium text-charcoal-ink">
            <span>People covered</span>
            <span>{employees.toLocaleString()}</span>
          </label>
          <input
            id="roi-employees"
            type="range"
            min={20}
            max={5000}
            step={20}
            value={employees}
            onChange={(e) => setEmployees(Number(e.target.value))}
            className="mt-1 w-full accent-[#0E7C52]"
          />
        </div>
        <div>
          <label htmlFor="roi-screenrate" className="flex justify-between text-sm font-medium text-charcoal-ink">
            <span>Complete their screenings</span>
            <span>{screenRate}%</span>
          </label>
          <input
            id="roi-screenrate"
            type="range"
            min={20}
            max={100}
            step={5}
            value={screenRate}
            onChange={(e) => setScreenRate(Number(e.target.value))}
            className="mt-1 w-full accent-[#0E7C52]"
          />
        </div>
        <div>
          <label htmlFor="roi-catch" className="flex justify-between text-sm font-medium text-charcoal-ink">
            <span>Abnormal findings per 100 screened</span>
            <span>{catchPer100}</span>
          </label>
          <input
            id="roi-catch"
            type="range"
            min={1}
            max={20}
            step={1}
            value={catchPer100}
            onChange={(e) => setCatchPer100(Number(e.target.value))}
            className="mt-1 w-full accent-[#0E7C52]"
          />
        </div>
        <div>
          <label htmlFor="roi-cost" className="flex justify-between text-sm font-medium text-charcoal-ink">
            <span>Cost avoided per early catch</span>
            <span>{fmt(costPerCatch)}</span>
          </label>
          <input
            id="roi-cost"
            type="range"
            min={50_000}
            max={500_000}
            step={25_000}
            value={costPerCatch}
            onChange={(e) => setCostPerCatch(Number(e.target.value))}
            className="mt-1 w-full accent-[#0E7C52]"
          />
        </div>
      </div>
      <div className="mt-6 rounded-xl bg-soft-sage p-5">
        <p className="text-sm text-deep-forest">
          ~{screened.toLocaleString()} people screened → ~{catches.toLocaleString()} early{" "}
          {catches === 1 ? "catch" : "catches"} a year
        </p>
        <p className="mt-1 font-heading text-3xl font-bold text-deep-forest">
          {fmt(avoided)} <span className="text-base font-medium">modeled cost avoided / year</span>
        </p>
      </div>
      <p className="mt-3 text-xs text-charcoal-ink/50">
        A modeled estimate from your own assumptions, not a claims analysis, a guarantee,
        or a quote. We&apos;ll build the real business case with your data.
      </p>
    </div>
  );
}
