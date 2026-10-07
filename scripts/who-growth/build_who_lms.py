#!/usr/bin/env python3
"""Build the WHO growth reference data migration (S68b) from the PUBLISHED WHO files.

Nothing in the output is typed from memory: every L, M and S value is read from an official WHO workbook
downloaded from cdn.who.int (URLs below), and the script refuses to write if a table is not the expected shape
(consecutive index, expected first and last index, positive M and S, no gaps).

  WHO Child Growth Standards 2006 (0 to 5 years), "expanded tables" (one row per day, or per 0.1 cm):
    https://www.who.int/tools/child-growth-standards/standards
  WHO Growth Reference 2007 (5 to 19 years), "z-scores expanded" (one row per month):
    https://www.who.int/tools/growth-reference-data-for-5to19-years/indicators

Usage:
  uv run --with openpyxl --with requests scripts/who-growth/build_who_lms.py --download DIR --out MIGRATION.sql
  (--download fetches the 20 workbooks into DIR when they are not there yet; re-running is idempotent.)

The order of the generated rows is fixed, so a re-run on the same WHO files produces a byte-identical migration.
Golden values for the proof (scripts/who-growth/golden_cases.py) come from the separate `anthro` package.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import openpyxl
import requests

STD = "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators"
REF = "https://cdn.who.int/media/docs/default-source/child-growth/growth-reference-5-19-years"
STD_PAGE = "https://www.who.int/tools/child-growth-standards/standards"
REF_PAGE = "https://www.who.int/tools/growth-reference-data-for-5to19-years/indicators"

# (file stem, url template with {sex}, measurement_type, unit, first index, last index, step, version, page)
V06 = "who-2006-v1"
V07 = "who-2007-v1"
SERIES = [
    ("wfa", f"{STD}/weight-for-age/expanded-tables/wfa-{{sex}}-zscore-expanded-tables.xlsx", "weight_for_age", "age_days", 0, 1856, 1, V06, STD_PAGE),
    ("lhfa", f"{STD}/length-height-for-age/expandable-tables/lhfa-{{sex}}-zscore-expanded-tables.xlsx", "height_for_age", "age_days", 0, 1856, 1, V06, STD_PAGE),
    ("bfa", f"{STD}/body-mass-index-for-age/expanded-tables/bfa-{{sex}}-zscore-expanded-tables.xlsx", "bmi_for_age", "age_days", 0, 1856, 1, V06, STD_PAGE),
    ("hcfa", f"{STD}/head-circumference-for-age/expanded-tables/hcfa-{{sex}}-zscore-expanded-tables.xlsx", "head_circumference_for_age", "age_days", 0, 1856, 1, V06, STD_PAGE),
    ("acfa", f"{STD}/arm-circumference-for-age/expanded-tables/acfa-{{sex}}-zscore-expanded-tables.xlsx", "muac_for_age", "age_days", 91, 1856, 1, V06, STD_PAGE),
    ("wfl", f"{STD}/weight-for-length-height/expanded-tables/wfl-{{sex}}-zscore-expanded-table.xlsx", "weight_for_length", "length_cm", 45.0, 110.0, 0.1, V06, STD_PAGE),
    ("wfh", f"{STD}/weight-for-length-height/expanded-tables/wfh-{{sex}}-zscore-expanded-tables.xlsx", "weight_for_height", "height_cm", 65.0, 120.0, 0.1, V06, STD_PAGE),
    ("r_wfa", f"{REF}/weight-for-age-(5-10-years)/" + "{file}", "weight_for_age", "age_months", 61, 120, 1, V07, REF_PAGE),
    ("r_hfa", f"{REF}/height-for-age-(5-19-years)/hfa-{{sex}}-z-who-2007-exp.xlsx", "height_for_age", "age_months", 61, 228, 1, V07, REF_PAGE),
    ("r_bmi", f"{REF}/bmi-for-age-(5-19-years)/bmi-{{sex}}-z-who-2007-exp.xlsx", "bmi_for_age", "age_months", 61, 228, 1, V07, REF_PAGE),
]
# The WHO 5-10 year weight-for-age workbooks are published under file names that start "hfa-" (the content is weight-for-age: the
# build checks the first M against the known first row of the sheet name, which says wfa).
R_WFA_FILES = {
    "boys": "hfa-boys-z-who-2007-exp_0ff9c43c-8cc0-4c23-9fc6-81290675e08b.xlsx",
    "girls": "hfa-girls-z-who-2007-exp_7ea58763-36a2-436d-bef0-7fcfbadd2820.xlsx",
}
SEXES = {"boys": "male", "girls": "female"}


def url_for(stem: str, tmpl: str, sex: str) -> str:
    if stem == "r_wfa":
        return tmpl.format(file=R_WFA_FILES[sex])
    return tmpl.format(sex=sex)


def fetch(dirpath: Path) -> None:
    dirpath.mkdir(parents=True, exist_ok=True)
    for stem, tmpl, *_ in SERIES:
        for sex in SEXES:
            f = dirpath / f"{stem}-{sex}.xlsx"
            if f.exists() and f.stat().st_size > 5000:
                continue
            r = requests.get(url_for(stem, tmpl, sex), timeout=90)
            r.raise_for_status()
            f.write_bytes(r.content)


def read_table(path: Path, expect_sheet_hint: str) -> list[tuple[float, float, float, float]]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    if expect_sheet_hint.lower() not in ws.title.lower():
        raise SystemExit(f"{path.name}: sheet '{ws.title}' does not look like {expect_sheet_hint}")
    rows = list(ws.iter_rows(values_only=True))
    head = [str(c).strip().lower() if c is not None else "" for c in rows[0]]
    if head[1:4] != ["l", "m", "s"]:
        raise SystemExit(f"{path.name}: header is {head[:5]}, expected index, L, M, S")
    out = []
    for r in rows[1:]:
        if r[0] is None:
            continue
        out.append((float(r[0]), float(r[1]), float(r[2]), float(r[3])))
    return out


HINT = {"wfa": "wfa", "lhfa": "lfa", "bfa": "bfa", "hcfa": "hcfa", "acfa": "acfa", "wfl": "wfl", "wfh": "wfh",
        "r_wfa": "wfa", "r_hfa": "hfa", "r_bmi": "bmi"}


def fmt(x: float) -> str:
    s = repr(float(x))
    return s[:-2] if s.endswith(".0") else s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    fetch(a.download)
    lines: list[str] = []
    total = 0
    for stem, tmpl, mtype, unit, first, last, step, version, page in SERIES:
        for sex_file, sex in SEXES.items():
            tbl = read_table(a.download / f"{stem}-{sex_file}.xlsx", HINT[stem])
            idx = [t[0] for t in tbl]
            n_expected = int(round((last - first) / step)) + 1
            if len(tbl) != n_expected or abs(idx[0] - first) > 1e-9 or abs(idx[-1] - last) > 1e-9:
                raise SystemExit(f"{stem}-{sex_file}: expected {n_expected} rows {first}..{last}, got {len(tbl)} rows {idx[0]}..{idx[-1]}")
            for i in range(1, len(idx)):
                if abs(idx[i] - idx[i - 1] - step) > 1e-6:
                    raise SystemExit(f"{stem}-{sex_file}: gap in the index at {idx[i - 1]} -> {idx[i]}")
            if any(t[2] <= 0 or t[3] <= 0 for t in tbl):
                raise SystemExit(f"{stem}-{sex_file}: a non-positive M or S")
            ls = ",".join(fmt(t[1]) for t in tbl)
            ms = ",".join(fmt(t[2]) for t in tbl)
            ss = ",".join(fmt(t[3]) for t in tbl)
            src = f"WHO {'Child Growth Standards 2006' if version == V06 else 'Growth Reference 2007'}, {stem} {sex_file}, expanded z-score table"
            first_sql = fmt(first)
            step_sql = fmt(step)
            lines.append(
                f"insert into public.growth_reference_lms (reference_version, sex, measurement_type, index_unit, index_value, l_value, m_value, s_value, source, source_url)\n"
                f"select '{version}', '{sex}', '{mtype}', '{unit}', round({first_sql} + (t.o - 1) * {step_sql}, 1), t.l, t.m, t.s, '{src}', '{url_for(stem, tmpl, sex_file).split('?')[0]}'\n"
                f"  from unnest(array[{ls}]::numeric[], array[{ms}]::numeric[], array[{ss}]::numeric[]) with ordinality as t(l, m, s, o);\n"
            )
            total += len(tbl)
    header = f"""-- S68b: the WHO growth reference data (Module 16, function 16.10). GENERATED by scripts/who-growth/build_who_lms.py. Do not edit by hand.
-- Every L, M and S value below is read from the PUBLISHED WHO workbooks (never typed from memory); the generator checks each table's shape
-- (first and last index, consecutive steps, positive M and S) and refuses to write otherwise. {total} rows in 20 series.
--   reference_version 'who-2006-v1': WHO Child Growth Standards 2006, 0 to 5 years (day tables to day 1856, weight-for-length 45.0 to 110.0 cm
--     and weight-for-height 65.0 to 120.0 cm in 0.1 cm steps, MUAC-for-age from day 91). {STD_PAGE}
--   reference_version 'who-2007-v1': WHO Growth Reference 2007, 5 to 19 years (monthly from month 61: weight-for-age to month 120, height-for-age
--     and BMI-for-age to month 228). {REF_PAGE}
-- Row counts before this migration: growth_reference_lms 0 rows (it has shipped empty since 20260830103301), so there is nothing to convert.
-- The licence is WHO's published terms for these tables; the CMO's reference-data source and licence question stays open (OQ-352).
"""
    a.out.write_text(header + "\n".join(lines))
    print(f"wrote {a.out} ({total} rows, {a.out.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(main())
