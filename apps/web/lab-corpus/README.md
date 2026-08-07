# Lab report corpus

Real Nigerian lab reports, and the values a human read off them, used to measure
whether the extraction engine actually works.

Everything else in `src/lib/lab-reports/` can be tested without a model: unit
conversion, alias resolution, quality control, reference ranges. None of that
answers the only question that matters — whether a vision model reads a creased
photograph of a Synlab FBC correctly. This corpus is how that gets answered, and
it is the difference between "we built an extraction engine" and "we know what
its error rate is."

## Do not commit real reports

`cases/` is gitignored. A real lab report carries the patient's name, often
their address, hospital number and date of birth. It is PHI. Keep cases on your
own machine, or de-identify them properly before sharing one with anyone.

The gitignore is deliberately allow-listed rather than blanket-ignored: adding a
case requires no git action at all, and there is no path where a report is
committed by accident.

## Adding a case

One folder per document, under `cases/`:

```
cases/
  synlab-fbc-01/
    document.jpg          the report — jpg, png, webp, pdf, or heic
    expected.json         what a human read off it
```

`expected.json`:

```json
{
  "lab": "Synlab Nigeria",
  "notes": "phone photo, creased along the middle, slight glare top-right",
  "reportDate": "2026-07-14",
  "analytes": [
    { "code": "haemoglobin", "value": 11.2 },
    { "code": "haematocrit", "value": 34 },
    { "code": "wbc", "value": 5.4, "printedValue": 5400, "printedUnit": "/uL" },
    { "code": "platelets", "value": 250 },
    { "code": "genotype", "valueText": "AS" },
    { "code": "malaria_parasite", "valueText": "negative" }
  ]
}
```

Rules for keying the truth:

- `value` is in the analyte's **canonical unit** (see `analyte-catalogue.ts`),
  because that is what gets stored and what a wrong number would corrupt. Where
  the page printed something else, record `printedValue`/`printedUnit` too —
  they are not scored, but they turn "this failed" into "the conversion failed"
  without re-opening the document.
- `valueText` for non-numeric results, using the codes the catalogue declares
  (`AA`/`AS`/`SS`, `positive`/`negative`, `negative`/`trace`/`1+`/`2+`/`3+`).
- **Key every analyte on the page that the catalogue supports**, including ones
  you expect the engine to miss. A missed reading only shows up in the score if
  the truth sheet knows it was there.
- Do not key analytes the catalogue does not support. They would score as
  missing forever and drown the signal.

## Running it

```
pnpm --filter @tarragon/web lab-corpus
pnpm --filter @tarragon/web lab-corpus -- --case synlab-fbc-01
```

Needs `ANTHROPIC_API_KEY`. One vision call per case, so it is a deliberate
command and not part of `pnpm test`.

## Reading the result

The report separates failures by whether they can hurt a patient, because they
are not equivalent:

- **wrong** — a real analyte read incorrectly, offered as filable.
- **spurious** — a value produced that is not on the page at all.

  These two are the harmful ones. They can reach a patient's permanent record.
  The run **exits non-zero if either is above zero**.

- **held back** — the engine read something and its own guards refused it
  (unknown unit, implausible value, unrecognised wording). This is the guards
  working. A case with many of these and no wrong ones is a good result.
- **missed** — not read at all. The clinician types it in, exactly as before
  this feature existed.

So `HARMFUL RATE` is the headline, not recall. Drive it to zero first, even at
the cost of missing more; then work on recall.

## What to collect

Aim for 20–50 documents spread across the layouts patients actually bring:

- the large chains — Synlab, Cerba Lancet, Afriglobal, Healthtracka
- a teaching hospital's own laboratory (dense multi-column tables, dot matrix)
- at least two small independent labs (photocopied forms, handwritten values)
- deliberately awful inputs: a creased phone photo, one at an angle, one with
  flash glare, one cropped so a column is cut off

The bad inputs matter more than the clean ones. A clean PDF from Synlab is the
easy case; the whole point of the engine is the photograph taken in a car park.

Every case added also grows `lab_report_templates` when run through the real
upload path, which is where the per-laboratory accuracy counters come from.
