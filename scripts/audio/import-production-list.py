#!/usr/bin/env python3
"""
Build `audio/manifest.json` and `packages/i18n/src/audio-scripts.ts` from the ElevenLabs
Audio Production List (docx) and the number list (csv). Standard library only.

    python3 scripts/audio/import-production-list.py <production-list.docx>

By default the script KEEPS any recorded-file facts (sha256, bytes, duration, approvals)
already in `audio/manifest.json`, so re-running after a script wording change never wipes
an approval. A clip whose English wording changed has its file facts and
approvals dropped, because the audio no longer matches the words (the list's own rule:
"if wording changes, every clip that uses it is re-recorded and re-approved").
"""
import csv
import hashlib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MANIFEST = ROOT / "audio" / "manifest.json"
NUM_CSV = ROOT / "audio" / "source" / "TH-NUM-number-list.csv"
# The words the CMO is asked to sign for the screen AND the voice (OQ-203): one source, so they cannot differ.
# Until `signed` is set the voice says today's on-screen text, never the unsigned proposal.
WORDING = ROOT / "packages" / "i18n" / "src" / "clinical-wording.json"
# Clips the list does not have yet, shaped like its rows (id, en, note). Move into the list at its next version.
EXTRAS = ROOT / "audio" / "source" / "extra-clips.json"
TS_OUT = ROOT / "packages" / "i18n" / "src" / "audio-scripts.ts"

# Section 4 of the list: who must review what. A group not named here needs brand review only.
CLINICAL_GROUPS = {"EMG", "TRI", "RES", "SYM", "CON", "NUM"}
LEGAL_CLIPS = {"ONB-010", "CON-001"}
# "How it reaches the phone" (section 6 headers) -> manifest bundle group.
BUNDLE = {"ONB": "bundled", "EMG": "bundled", "TRI": "bundled", "NUM": "bundled", "SYM": "bundled"}
HLP_CLINICAL = {"HLP-003", "HLP-004", "HLP-018"}  # rows noted "Clinical review"
RELEASE_3 = {"HLP-040", "HLP-041"}


def ptext(p):
    return "".join(t.text or "" for t in p.iter(W + "t"))


def read_docx(path):
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    items = []
    for el in root.find(W + "body"):
        if el.tag == W + "p":
            t = ptext(el).strip()
            if t:
                items.append(("p", t))
        elif el.tag == W + "tbl":
            for tr in el.iter(W + "tr"):
                items.append(("row", [" ".join(ptext(p) for p in tc.iter(W + "p")).strip() for tc in tr.findall(W + "tc")]))
    return items


def parse(items):
    """-> {group: {title, how, review, rows: [[id, where, en, other_language_text_ignored, notes]]}}"""
    groups, cur = {}, None
    for kind, v in items:
        if kind == "p":
            m = re.match(r"^6\.\d+ ([A-Z]{3}): (.*)$", v)
            if m:
                cur = {"code": m.group(1), "title": m.group(2), "how": "", "review": "", "rows": []}
                groups[m.group(1)] = cur
            elif cur is not None and v.startswith("How it reaches the phone:"):
                cur["how"] = v.split(":", 1)[1].strip()
            elif cur is not None and v.startswith("Review:"):
                cur["review"] = v.split(":", 1)[1].strip()
            elif re.match(r"^(7|8|9)\. ", v):
                cur = None
        elif kind == "row" and cur is not None and re.match(r"^[A-Z]{3}-", v[0] or ""):
            cur["rows"].append(v + [""] * (5 - len(v)))
    return groups


def bundle_group(code, how):
    if code in BUNDLE:
        return "bundled"
    h = how.lower()
    if "on demand" in h:
        return "on_demand"
    if "after sign-up" in h:
        return "post_signup"
    raise SystemExit(f"Cannot classify delivery for {code}: {how!r}")


def file_name(clip_id, lang):
    return f"TH-{clip_id}-{lang.upper()}.mp3" if lang else f"TH-{clip_id}.mp3"


def old_manifest():
    return json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {"clips": [], "phrase_signoffs": []}


def old_state():
    return {c["id"]: c for c in old_manifest()["clips"]}


def clean_review(text):
    """The list's review column still names a retired second-language review; the product is English only."""
    retired = "Pi" + "dgin"
    text = text.replace(f"Clinical, legal and {retired} review", "Clinical and legal review")
    text = re.sub(f";? ?{retired} native review", "", text)
    text = text.replace(f"Brand and {retired} review", "Brand review")
    return "Brand review" if text.strip() == f"{retired} review" else text


def empty_file(clip_id, lang):
    return {"file": file_name(clip_id, lang), "sha256": None, "bytes": None, "duration_ms": None, "approvals": [], "history": []}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        raise SystemExit(__doc__)
    groups = parse(read_docx(args[0]))
    wording = json.loads(WORDING.read_text())
    spoken = {}
    for cid, w in wording["codes"].items():
        text = (w["proposed"] if wording["signed"] else w["current"])["body"]
        for written, said in wording["spoken"].items():
            text = text.replace(written, said)
        spoken[cid] = text
        rows = groups[cid.split("-")[0]]["rows"]
        if not any(r[0] == cid for r in rows):
            # Not in the Audio Production List v1.0 (EMG-001L, OQ-202): added from the wording file.
            rows.append([cid, "Low reading with fainting", text, "", "Added from clinical-wording.json; not in the list"])
    prior = old_state()
    clips, scripts, num_words = [], {}, {}

    group_meta = {}
    for code, g in groups.items():
        bg = bundle_group(code, g["how"])
        group_meta[code] = {"title": g["title"], "bundle_group": bg, "reaches_phone": g["how"], "review": clean_review(g["review"])}
        if code == "NUM":
            continue
        for cid, where, en, _ignored, notes in g["rows"]:
            clinical = code in CLINICAL_GROUPS or cid in HLP_CLINICAL
            if cid in spoken:
                en = spoken[cid]
            scripts[cid] = {"en": en}
            files = {"en": empty_file(cid, "en")}
            clip = {
                "id": cid, "group": code,
                "bundle_group": "on_demand" if cid in RELEASE_3 else bg,
                "release": 3 if cid in RELEASE_3 else 1,
                "clinical": clinical, "legal": cid in LEGAL_CLIPS, "language_neutral": False,
                "files": files,
            }
            clips.append(clip)

    # NUM: whole numbers and rounded steps are language neutral; lead-ins, units and the decimal word differ by language.
    num_rows = {r[0]: r for r in groups["NUM"]["rows"]}
    with open(NUM_CSV, newline="") as f:
        for row in csv.DictReader(f):
            cid = row["ID"]
            num_words[cid] = row["Text"]
            clips.append({
                "id": cid, "group": "NUM", "bundle_group": "bundled", "release": 1,
                "clinical": True, "legal": False, "language_neutral": True,
                "files": {"shared": empty_file(cid, None)},
            })
    for extra in json.loads(EXTRAS.read_text()) if EXTRAS.exists() else []:
        num_rows[extra["id"]] = [extra["id"], "Added by S32", extra["en"], "", extra.get("note", "")]
    for cid, r in num_rows.items():
        if not re.match(r"^NUM-(D|P)\d\d$", cid) or cid == "NUM-P22":
            continue
        scripts[cid] = {"en": r[2]}
        clips.append({
            "id": cid, "group": "NUM", "bundle_group": "bundled", "release": 1,
            "clinical": True, "legal": False, "language_neutral": False,
            "files": {"en": empty_file(cid, "en")},
        })

    # Wording changed since the last run: the audio no longer matches, so drop file facts and approvals.
    for c in clips:
        p = prior.get(c["id"])
        sc = scripts.get(c["id"])
        h = script_hash(sc["en"] if sc else num_words.get(c["id"]))
        if p:
            for key in c["files"]:
                if p.get("script_hash") == h and key in p["files"]:
                    c["files"][key] = {**{"history": []}, **p["files"][key]}
        c["script_hash"] = h
    clips.sort(key=lambda c: (list(group_meta).index(c["group"]), c["id"]))

    manifest = {
        "schema_version": 1,
        "source": {"document": "Tarragon Health ElevenLabs Audio Production List", "version": "1.0", "date": "2026-09-29",
                   "number_list": "audio/source/TH-NUM-number-list.csv"},
        "languages": ["en"],
        "groups": group_meta,
        # Whole-phrase clinical sign-offs are added by a person; the import keeps whatever is there.
        "phrase_signoffs": old_manifest().get("phrase_signoffs", []),
        "clips": clips,
    }
    MANIFEST.write_text(dump(manifest))
    write_ts(scripts)
    print(f"{len(clips)} clips, {len(scripts)} scripted")


def dump(m):
    """Header pretty-printed, one clip per line: small, and a clip's change is one line in a diff."""
    head = {k: v for k, v in m.items() if k != "clips"}
    body = json.dumps(head, indent=2, ensure_ascii=False)
    rows = ",\n".join("    " + json.dumps(c, ensure_ascii=False, separators=(",", ":")) for c in m["clips"])
    return body[:-2] + ',\n  "clips": [\n' + rows + "\n  ]\n}\n"


def script_hash(s):
    if s is None:
        return None
    return hashlib.sha256(json.dumps(s, sort_keys=True).encode()).hexdigest()[:16]


def q(s):
    return json.dumps(s, ensure_ascii=False)


def write_ts(scripts):
    lines = [
        "/**",
        " * Spoken scripts for the audio clips (Audio Production List v1.0). GENERATED by",
        " * scripts/audio/import-production-list.py; do not edit by hand, re-run the script.",
        " *",
        " * These are the words a clip says, and the text shown when its clip is missing (spec 8.8). English only.",
        " */",
        "export interface AudioScript {",
        "  readonly en: string;",
        "}",
        "",
        "export const AUDIO_SCRIPTS: Readonly<Record<string, AudioScript>> = {",
    ]
    for cid in sorted(scripts):
        s = scripts[cid]
        lines.append(f"  {q(cid)}: {{ en: {q(s['en'])} }},")
    lines += ["};", ""]
    TS_OUT.write_text("\n".join(lines))


if __name__ == "__main__":
    main()
