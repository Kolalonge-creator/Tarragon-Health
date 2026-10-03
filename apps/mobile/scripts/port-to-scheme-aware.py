#!/usr/bin/env python3
"""
Mechanically make an old mobile screen scheme-aware (design Phase 2, see docs/design/DARK-MODE.md):
  - `@/ui/components`  -> `@/ui/legacy-kit` (same names and props, scheme-aware)
  - static `colors`/`inkAlpha` from `@/ui/theme` -> `useLegacyColors()` inside each function that uses them
It does NOT rewrite layout, logic or copy. Anything it cannot do safely (module-level uses of `colors`,
helpers that are not components) is left for `tsc` to flag so a human fixes it by hand.
Usage: port-to-scheme-aware.py src/screens/sections/some-screen.tsx [...]
"""
import re, sys

PAT = re.compile(r"^(export )?(?:async )?function ([A-Za-z0-9_]+)\(", re.M)

def port(path):
    s = open(path).read()
    s = s.replace('from "@/ui/components";', 'from "@/ui/legacy-kit";')
    m = re.search(r'import \{([^}]*)\} from "@/ui/theme";', s)
    if not m:
        print(f"{path}: no theme import, skipped"); return
    names = [n.strip() for n in m.group(1).split(",") if n.strip()]
    keep = [n for n in names if n not in ("colors", "inkAlpha")]
    repl = ('import { %s } from "@/ui/theme";\n' % ", ".join(keep)) if keep else ""
    repl += 'import { useLegacyColors } from "@/ui/design";'
    s = s.replace(m.group(0), repl, 1)
    s = re.sub(r"inkAlpha\(([0-9.]+)\)", lambda x: "colors.pressed" if float(x.group(1)) <= 0.08 else "colors.muted", s)
    out, last = "", 0
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
        body = s[k:end if end != -1 else len(s)]
        name = fm.group(2)
        # only components (capitalised) get the hook; lowercase helpers are left for tsc to flag
        if "colors." in body and name[0].isupper() and "useLegacyColors()" not in body[:300]:
            out += s[last:k + 1] + "\n  const colors = useLegacyColors();"
            last = k + 1
    out += s[last:]
    open(path, "w").write(out)
    print(f"{path}: ported")

for p in sys.argv[1:]:
    port(p)
