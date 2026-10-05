#!/usr/bin/env python3
"""
Mechanically make an old mobile screen scheme-aware (design Phase 2, see docs/design/DARK-MODE.md):
  - `@/ui/components`  -> `@/ui/legacy-kit` (same names and props, scheme-aware)
  - static `colors`/`inkAlpha` from `@/ui/theme` -> `useLegacyColors()` inside each component that uses them
  - a module-level `textInputStyle = {...} as const` -> `useTextInputStyle()` inside each component that uses it
  - `keyboardAppearance={scheme}` on every TextInput
It does NOT rewrite layout, logic or copy. Anything it cannot do safely (other module-level uses of
`colors`, helpers that are not components) is left for `tsc` to flag so a human fixes it by hand.
Usage: port-to-scheme-aware.py src/screens/sections/some-screen.tsx [...]
"""
import re, sys

PAT = re.compile(r"^(export )?(?:async )?function ([A-Za-z0-9_]+)\s*(?:<[^>(]*>)?\(", re.M)
TIS = re.compile(r"^(?:export )?const textInputStyle = \{.*?\} as const;\n\n?", re.M | re.S)

def components(s):
    """Yield (name, body_start_index_after_brace, body_text) for each top-level function."""
    for fm in PAT.finditer(s):
        start = fm.end() - 1; depth = 0; j = start
        while True:
            c = s[j]
            if c == "(": depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0: break
            j += 1
        k = s.index("{", j)
        end = s.find("\n}\n", k)
        yield fm.group(2), k, s[k:end if end != -1 else len(s)]

def port(path):
    s = open(path).read()
    s = s.replace('from "@/ui/components";', 'from "@/ui/legacy-kit";')
    m = re.search(r'import \{([^}]*)\} from "@/ui/theme";', s)
    if not m:
        print(f"{path}: no theme import, skipped"); return
    names = [n.strip() for n in m.group(1).split(",") if n.strip()]
    keep = [n for n in names if n not in ("colors", "inkAlpha")]
    uses_tis = bool(TIS.search(s))
    if uses_tis:
        s = TIS.sub("", s, count=1)
    body_without_import = s.replace(m.group(0), "")
    keep = [n for n in keep if re.search(r"\b%s\b" % n, body_without_import)]
    design = ["useLegacyColors"] + (["useTextInputStyle"] if uses_tis else []) + (["useTheme"] if "<TextInput" in s else [])
    repl = ('import { %s } from "@/ui/theme";\n' % ", ".join(keep)) if keep else ""
    repl += 'import { %s } from "@/ui/design";' % ", ".join(sorted(design))
    s = s.replace(m.group(0), repl, 1)
    s = re.sub(r"inkAlpha\(([0-9.]+)\)", lambda x: "colors.pressed" if float(x.group(1)) <= 0.08 else "colors.muted", s)
    s = re.sub(r"<TextInput\b(?![^>]*keyboardAppearance)", "<TextInput keyboardAppearance={scheme}", s)
    out, last = "", 0
    for name, k, body in components(s):
        if not name[0].isupper(): continue
        hooks = ""
        if "colors." in body and "useLegacyColors()" not in body[:400]: hooks += "\n  const colors = useLegacyColors();"
        if "textInputStyle" in body: hooks += "\n  const textInputStyle = useTextInputStyle();"
        if "keyboardAppearance={scheme}" in body: hooks += "\n  const { scheme } = useTheme();"
        if hooks:
            out += s[last:k + 1] + hooks
            last = k + 1
    out += s[last:]
    open(path, "w").write(out)
    print(f"{path}: ported")

for p in sys.argv[1:]:
    port(p)
