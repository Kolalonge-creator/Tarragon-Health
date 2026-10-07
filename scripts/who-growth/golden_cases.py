#!/usr/bin/env python3
"""Golden z-score cases for the S68 proof, computed OUTSIDE the database.

0 to 5 years: expected values come from the `anthro` PyPI package (a port of the WHO igrowup method that ships the WHO tables).
   Two known differences from the WHO macros are handled here, not hidden:
   - anthro applies the restricted-tail (SD23) adjustment to every indicator; WHO applies it to weight-for-age, BMI-for-age and weight-for-length/height
     only. So height-for-age and MUAC-for-age cases are chosen with |z| < 3, where the two agree.
   - anthro does not apply the 0.7 cm length/height correction to weight-for-height. For a mismatched-position case we pass anthro the CORRECTED height
     and the matching position, which is what WHO igrowup does.
5 to 19 years: anthro does not cover the 2007 reference, so those expected values are computed here, independently, straight from the downloaded WHO
   2007 workbooks (same LMS formula, linear interpolation between months). That is a second implementation, not a second authority; it is labelled so.

  uv run --with anthro --with openpyxl scripts/who-growth/golden_cases.py --who DIR --write packages/db/tests/s68_who_growth_z_scores.sql
"""
from __future__ import annotations

import argparse
import math
import random
import re
from pathlib import Path

import anthro  # type: ignore
import openpyxl

DPM = 30.4375


def lms_z(y: float, l: float, m: float, s: float, sd23: bool) -> float:
    z = math.log(y / m) / s if abs(l) < 1e-10 else ((y / m) ** l - 1) / (l * s)
    if sd23 and abs(z) > 3:
        if z > 3:
            sd3, sd2 = m * (1 + l * s * 3) ** (1 / l), m * (1 + l * s * 2) ** (1 / l)
            return 3 + (y - sd3) / (sd3 - sd2)
        sd3, sd2 = m * (1 - l * s * 3) ** (1 / l), m * (1 - l * s * 2) ** (1 / l)
        return -3 + (y - sd3) / (sd2 - sd3)
    return z


def load07(d: Path, stem: str, sex: str) -> dict[int, tuple[float, float, float]]:
    ws = openpyxl.load_workbook(d / f"{stem}-{sex}.xlsx", read_only=True, data_only=True).active
    return {int(r[0]): (float(r[1]), float(r[2]), float(r[3])) for r in list(ws.iter_rows(values_only=True))[1:] if r[0] is not None}


def interp(tbl: dict[int, tuple[float, float, float]], months: float) -> tuple[float, float, float]:
    lo = math.floor(months)
    hi = math.ceil(months)
    if lo == hi:
        return tbl[lo]
    t = months - lo
    return tuple(a + (b - a) * t for a, b in zip(tbl[lo], tbl[hi]))  # type: ignore


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--who", required=True, type=Path)
    ap.add_argument("--write", required=True, type=Path)
    a = ap.parse_args()
    rnd = random.Random(68)
    rows: list[str] = []

    def n(x: float | None) -> str:
        return "null" if x is None else f"{x:.4f}"

    # ---- 0 to 5 years, anthro ----
    cases = []
    for sex in ("male", "female"):
        for age in [1, 5, 29, 61, 95, 150, 270, 365, 500, 640, 729, 731, 800, 1000, 1300, 1500, 1700, 1825]:
            cases.append((sex, age))
    for _ in range(14):
        cases.append((rnd.choice(("male", "female")), rnd.randint(2, 1820)))
    for sex, age in cases:
        # plausible child around the median with some spread, on the 0.1 grid for height
        sc = "M" if sex == "male" else "F"
        h0 = anthro.anthro._load_table("day_lhfa.json")[sc][age]["m"]
        w0 = anthro.anthro._load_table("day_wfa.json")[sc][age]["m"]
        height = round(h0 * rnd.uniform(0.95, 1.05), 1)
        weight = round(w0 * rnd.uniform(0.8, 1.25), 2)
        muac = round(rnd.uniform(120, 165), 0) if age >= 91 else None
        pos = "recumbent" if age <= 730 else "standing"
        r = anthro.compute({"sex": sex, "age_days": age, "weight_kg": weight, "height_cm": height, "muac_mm": muac, "measure": "L" if pos == "recumbent" else "H", "mode": "day"})
        zs = {k: r.get(k) for k in ("z_wfa", "z_lhfa", "z_bmi", "z_acfa", "z_wflh")}
        for k in ("z_lhfa", "z_acfa"):  # anthro applies the tail adjustment to these too, WHO does not: compare only where they agree
            if zs[k] is not None and abs(zs[k]) > 3:
                zs[k] = None
        if age == 730:
            continue
        rows.append(f"  ('{sex}', {age}, {weight}, {height}, {n(muac) if muac else 'null'}, '{pos}', {n(zs['z_wfa'])}, {n(zs['z_lhfa'])}, {n(zs['z_bmi'])}, {n(zs['z_acfa'])}, {n(zs['z_wflh'])}, 'anthro')")

    # wrong-position cases: standing under 2 years (add 0.7 cm), recumbent over 2 years (subtract 0.7 cm). anthro for height-for-age and BMI; for weight-for-height pass the corrected value.
    for sex, age, weight, height, pos in [("male", 400, 9.6, 74.2, "standing"), ("female", 600, 11.0, 82.0, "standing"), ("male", 900, 12.5, 88.5, "recumbent"), ("female", 1200, 14.1, 96.3, "recumbent")]:
        r = anthro.compute({"sex": sex, "age_days": age, "weight_kg": weight, "height_cm": height, "measure": "H" if pos == "standing" else "L", "mode": "day"})
        corrected = height + 0.7 if pos == "standing" else height - 0.7
        r2 = anthro.compute({"sex": sex, "age_days": age, "weight_kg": weight, "height_cm": round(corrected, 1), "measure": "L" if age <= 730 else "H", "mode": "day"})
        lh = r['z_lhfa'] if r['z_lhfa'] is not None and abs(r['z_lhfa']) <= 3 else None
        rows.append(f"  ('{sex}', {age}, {weight}, {height}, null, '{pos}', {n(r['z_wfa'])}, {n(lh)}, {n(r['z_bmi'])}, null, {n(r2['z_wflh'])}, 'anthro')")

    # ---- 5 to 19 years, independent from the WHO 2007 workbooks ----
    t = {(st, sx): load07(a.who, st, sx) for st in ("r_wfa", "r_hfa", "r_bmi") for sx in ("boys", "girls")}
    for sx, sex in (("boys", "male"), ("girls", "female")):
        for age in [1860, 2000, 2400, 2900, 3300, 3652, 4200, 5000, 6000, 6800]:
            months = age / DPM
            hz = interp(t[("r_hfa", sx)], months)
            height = round(hz[1] * rnd.uniform(0.96, 1.04), 1)
            bz = interp(t[("r_bmi", sx)], months)
            bmi_t = bz[1] * rnd.uniform(0.85, 1.25)
            weight = round(bmi_t * (height / 100) ** 2, 2)
            bmi = weight / (height / 100) ** 2
            wz = None
            if months <= 120:
                w = interp(t[("r_wfa", sx)], months)
                wz = lms_z(weight, *w, True)
            rows.append(f"  ('{sex}', {age}, {weight}, {height}, null, 'standing', {n(wz)}, {n(lms_z(height, *hz, False))}, {n(lms_z(bmi, *bz, True))}, null, null, 'who2007_files')")

    block = "-- golden-begin (generated by scripts/who-growth/golden_cases.py; do not edit)\n" + ",\n".join(rows) + "\n-- golden-end"
    p = a.write
    txt = p.read_text()
    new = re.sub(r"-- golden-begin.*?-- golden-end", lambda m: block, txt, flags=re.S)
    p.write_text(new)
    print(f"{len(rows)} golden cases written to {p}")


if __name__ == "__main__":
    main()
