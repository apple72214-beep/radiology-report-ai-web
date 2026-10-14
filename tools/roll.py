#!/usr/bin/env python3
"""Radiology report AI — release roll + drift checker.

The update path broke three times because the roll was done by hand:
  * sw.js kept an old BUILD label and a stale CRITICAL precache list,
  * CRITICAL accumulated ancient versions (string replace never rewrites the list),
  * web/codecs/decode.vNN.js kept vanishing from the worktree between steps.
This script is the single source of truth for a roll, and `--check` audits a
tree (or CI) for exactly that class of drift.

usage:
  python3 tools/roll.py --check [--fix]          # audit (and repair) the current build
  python3 tools/roll.py v100 --mark ب2.72 \\
      --ar "ملاحظات" --en "notes"                 # roll the current build -> v100
"""
import json, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = os.path.join(ROOT, "web")
REPO = "apple72214-beep/radiology-report-ai-web"

# name -> relative path, in dependency order (decode before its consumers)
MODULES = [
    ("consult", "consult.{b}.js"),
    ("decode", "codecs/decode.{b}.js"),
    ("dicom", "dicom.{b}.js"),
    ("triage", "triage.{b}.js"),
    ("docx", "docx.{b}.js"),
    ("measure", "measure.{b}.js"),
    ("compare", "compare.{b}.js"),
    ("report", "report.{b}.js"),
    ("mpr", "mpr.{b}.js"),
    ("app", "app.{b}.js"),
    ("ui", "ui.{b}.html"),
]
# exact CRITICAL precache layout of the service worker (current build only!)
CRITICAL = [
    "./", "./start.html", "./index.html", "./manifest.webmanifest",
    "./ui.{b}.html", "./app.{b}.js", "./dicom.{b}.js", "./report.{b}.js", "./sw.{b}.js",
    "./triage.{b}.js", "./consult.{b}.js", "./docx.{b}.js", "./measure.{b}.js",
    "./compare.{b}.js", "./mpr.{b}.js", "./codecs/decode.{b}.js", "./icons/logo.png",
]
DECODE_ANCESTOR = "codecs/decode.v77.js"


def rd(p):
    return open(p, "rb").read()


def wr(p, s):
    open(p, "w", encoding="utf-8").write(s)


def sha(b):
    import hashlib
    return hashlib.sha256(b).hexdigest()


def chars_u16(t):
    return sum(2 if ord(c) > 0xFFFF else 1 for c in t)


def paths(b):
    return [(n, p.format(b=b)) for n, p in MODULES]


def manifest(b, pinned=None):
    """Recompute the integrity manifest for build b (hashes are authoritative)."""
    old = os.path.join(W, "integrity.%s.json" % b)
    if pinned is None and os.path.exists(old):
        pinned = json.load(open(old)).get("pinned_commit", "")
    files = {}
    for name, rel in paths(b):
        raw = rd(os.path.join(W, rel))
        files[name] = {"path": rel, "chars": chars_u16(raw.decode("utf-8")),
                       "bytes": len(raw), "sha256": sha(raw)}
    return {"build": b, "pinned_commit": pinned or "",
            "pinned_origin": "https://cdn.jsdelivr.net/gh/%s@%s/" % (REPO, pinned or ""),
            "files": files}


def len_block(b):
    """Byte table the service worker trusts.

    The launcher pages belong here too: start.html carries the hashes the
    device verifies against, so a stale cached copy of it sends the device back
    to an old build — the update loop we shipped v110 to end.
    """
    items = [(rel, len(rd(os.path.join(W, rel)))) for _, rel in paths(b)]
    items += [(f, len(rd(os.path.join(W, f)))) for f in ("start.html", "index.html")]
    inner = ", ".join('"%s": %d' % (rel, n) for rel, n in items)
    return "const LEN = {%s};" % inner


def critical_block(b):
    q = [('"%s"' % c.format(b=b)) for c in CRITICAL]
    body = "\n  ".join([", ".join(q[0:4]) + ",", ", ".join(q[4:14]) + ",", ", ".join(q[14:])])
    return "const CRITICAL = [\n  %s\n];" % body


def ensure_decode(b):
    """decode.vNN.js keeps vanishing from the worktree — always regenerate it."""
    dst = os.path.join(W, "codecs/decode.%s.js" % b)
    if not os.path.exists(dst):
        shutil.copy(os.path.join(W, DECODE_ANCESTOR), dst)
        print("  restored codecs/decode.%s.js from the pristine ancestor" % b)
    return dst


def current_build():
    return json.load(open(os.path.join(W, "release.json")))["build"]


def pin_modules(t, b):
    """Point every module import inside app.<b>.js at build b.

    The pins drifted to v59 and stayed there for dozens of releases, so the app
    kept running a parser from another era (and imported a module that is no
    longer even shipped). A blanket replace of the old version token cannot fix
    that — the pin has to be rewritten from the module table.
    """
    for _n, rel in MODULES:
        pat = r'"\./' + re.escape(rel).replace(re.escape("{b}"), r"v\d+") + '"'
        t = re.sub(pat, '"./' + rel.format(b=b) + '"', t)
    return t


def module_pins(t):
    return re.findall(r'"\./(?:codecs/)?[a-z]+\.v(\d+)\.js"', t)


def integrity_builds():
    """Every build that still carries an integrity manifest, newest first."""
    out = []
    for f in os.listdir(W):
        m = re.match(r"^integrity\.(v\d+)\.json$", f)
        if m:
            out.append((int(m.group(1)[1:]), m.group(1)))
    return [b for _, b in sorted(out, reverse=True)]


def known_block(b):
    builds = integrity_builds()
    if b not in builds:
        builds.insert(0, b)
    return "const known = [%s];" % ", ".join('"%s"' % x for x in builds)


def expect_block(b, exp):
    """The launcher only ever needs one inline entry: the build it is shipping.

    Every other build is validated against integrity.<b>.json fetched from the
    same origin, so a table that is never carried forward can never go stale.
    """
    return "const EXPECT = {\"%s\": %s};" % (b, json.dumps(exp, ensure_ascii=False))


def _brace_span(src, open_idx):
    """Index just past the `}` matching the `{` at open_idx (string-aware)."""
    depth, i, q = 0, open_idx, None
    while i < len(src):
        c = src[i]
        if q:
            if c == "\\":
                i += 2
                continue
            if c == q:
                q = None
        elif c in "\"'":
            q = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


def fix_launcher(b, exp):
    """Rebuild the launcher's `known` list and `EXPECT` table from disk.

    The roll used to do a blanket `replace(old, new)` over start.html, which
    renamed every historical build key to the new one. In a JS object literal
    the LAST duplicate key wins, so the launcher validated the new build
    against the hashes of a build many releases back, every mirror "failed",
    and the page silently fell back to an old build — which then saw a newer
    release.json and force-reloaded, over and over.
    """
    p = os.path.join(W, "start.html")
    t = open(p, encoding="utf-8").read()
    if "const EXPECT" not in t:
        return
    t = re.sub(r"const known = \[.*?\]", lambda m: known_block(b), t, count=1, flags=re.S)
    m = re.search(r"const EXPECT = \{", t)
    if m:
        end = _brace_span(t, m.end() - 1)
        if end > 0 and t[end:end + 1] == ";":
            end += 1
        t = t[:m.start()] + expect_block(b, exp) + t[end:]
    wr(p, t)


# ---------------------------------------------------------------- check/fix --
def check(fix=False):
    """Audit the tree for the drift that broke the update path. Returns #problems."""
    b = current_build()
    bad = []
    ensure_decode(b)

    def want(cond, msg, repair=None):
        if not cond:
            bad.append(msg)
            if fix and repair:
                repair()
                print("  fixed: " + msg)
            else:
                print("  DRIFT: " + msg)

    def need(p):
        if not os.path.exists(os.path.join(W, p)):
            want(False, "missing file %s" % p,
                 lambda: shutil.copy(os.path.join(W, DECODE_ANCESTOR), os.path.join(W, p)))
            return False
        return True

    for _, rel in paths(b):
        need(rel)

    # 1. service worker identity + current-only precache + LEN
    swp = os.path.join(W, "sw.%s.js" % b)
    sw = open(swp, encoding="utf-8").read() if os.path.exists(swp) else ""
    want('const BUILD = "%s"' % b in sw, "sw.%s.js BUILD label" % b,
         lambda: wr(swp, re.sub(r'const BUILD = "v\d+"', 'const BUILD = "%s"' % b, sw)))
    want('const CACHE = "rrai-web-%s"' % b in sw, "sw.%s.js CACHE name" % b,
         lambda: wr(swp, re.sub(r'const CACHE = "rrai-web-v\d+"',
                                'const CACHE = "rrai-web-%s"' % b, open(swp, encoding="utf-8").read())))
    want(critical_block(b) in sw, "sw.%s.js CRITICAL is current-build-only" % b,
         lambda: wr(swp, re.sub(r"const CRITICAL = \[[^\]]*\];", critical_block(b),
                                open(swp, encoding="utf-8").read())))
    want(len_block(b) in sw, "sw.%s.js LEN matches on-disk bytes" % b,
         lambda: wr(swp, re.sub(r"const LEN = \{[^\}]*\};", lambda m: len_block(b),
                                open(swp, encoding="utf-8").read(), count=1)))
    m = re.search(r"const LEN = \{[^\}]*\};", sw)
    if m and m.group(0) != len_block(b):
        want(False, "sw.%s.js LEN stale (app/ui edited after last roll)" % b,
             lambda: wr(swp, re.sub(r"const LEN = \{[^\}]*\};", lambda mm: len_block(b),
                                    open(swp, encoding="utf-8").read(), count=1)))

    # 2. bootstrap service worker must be a pure relay (it used to go stale)
    boot = os.path.join(W, "sw.js")
    relay = '/* Radiology report AI — bootstrap service worker: always relays to the current build. */\nimportScripts("./sw.%s.js");\n' % b
    want(os.path.exists(boot) and open(boot, encoding="utf-8").read() == relay,
         "sw.js relays to sw.%s.js" % b, lambda: wr(boot, relay))

    # 3. retired service workers must stay pilled
    for f in sorted(os.listdir(W)):
        if re.match(r"^sw\.v\d+\.js$", f) and f != "sw.%s.js" % b:
            t = open(os.path.join(W, f), encoding="utf-8").read()
            want("self.registration.unregister()" in t and "caches.delete" in t,
                 "retired %s still serves traffic (not pilled)" % f,
                 lambda f=f: wr(os.path.join(W, f), PILL))

    # 4. launcher: markers, EXPECT entry, pinned fallback origin, integrity fetch
    man = manifest(b)
    exp = {n: [man["files"][n]["chars"], man["files"][n]["bytes"], man["files"][n]["sha256"]]
           for n, _ in paths(b)}
    pin = man.get("pinned_commit", "")
    for f in ("start.html", "index.html"):
        p = os.path.join(W, f)
        t = open(p, encoding="utf-8").read()
        if "const EXPECT" not in t:
            want("./standalone.html" in t, "%s hands over to the single-file edition" % f)
            continue  # hand-over page: no launcher invariants to check
        want('"%s": ' % b in t and '"%s": %s' % (b, json.dumps(exp, ensure_ascii=False)) in t,
             "%s EXPECT[%s] matches the files on disk" % (f, b),
             lambda p=p, t=t: wr(p, re.sub(r'"%s": \{.*?\}' % b,
                                           lambda m: '"%s": %s' % (b, json.dumps(exp, ensure_ascii=False)),
                                           open(p, encoding="utf-8").read(), count=1)))
        # PIN is a *fallback* origin frozen on an immutable commit; it is allowed to
        # trail the live pin by a deploy, but must never be empty/malformed/stale-by-era.
        pin_ok = bool(re.search(r'const PIN = "https://cdn\.jsdelivr\.net/gh/%s@[0-9a-f]{40}/"'
                                % re.escape(REPO), t))
        if pin_ok and pin and pin not in t:
            print("  note: %s PIN trails the live pin (%s) — refresh with --check --fix after deploy"
                  % (f, pin[:8]))
        want(pin_ok, "%s PIN fallback is a pinned, immutable jsDelivr origin" % f,
             lambda p=p: wr(p, re.sub(r'const PIN = "https://cdn\.jsdelivr\.net/gh/%s@[0-9a-f]{40}/"'
                                      % re.escape(REPO) if False else r'const PIN = "https://cdn\.jsdelivr\.net/gh/[^@]+@[0-9a-f]{40}/"',
                                      'const PIN = "https://cdn.jsdelivr.net/gh/%s@%s/"' % (REPO, pin),
                                      open(p, encoding="utf-8").read(), count=1)))
        want('fetch("./integrity." + b + ".json' in t,
             "%s can validate builds it does not know yet" % f)
        # A duplicated build key silently wins with the wrong hashes: the new
        # build fails on every mirror and the launcher falls back to an old one.
        keys = re.findall(r'"(v\d+)": \{', t)
        want(len(keys) == 1 and keys[0] == b,
             "%s EXPECT holds exactly one entry, freshly built for %s" % (f, b),
             lambda b=b, exp=exp: fix_launcher(b, exp))
        km = re.search(r"const known = \[(.*?)\]", t, re.S)
        ks = re.findall(r'"(v\d+)"', km.group(1)) if km else []
        want(bool(ks) and len(ks) == len(set(ks)) and ks[0] == b,
             "%s known list is a de-duplicated build list headed by %s" % (f, b),
             lambda b=b, exp=exp: fix_launcher(b, exp))

    # 4c. the app must import the modules this build ships
    ap = os.path.join(W, "app.%s.js" % b)
    at = open(ap, encoding="utf-8").read()
    pins = module_pins(at)
    want(bool(pins) and all(p == b[1:] for p in pins),
         "app.%s.js pins every module to this build" % b,
         lambda ap=ap: wr(ap, pin_modules(open(ap, encoding="utf-8").read(), b)))
    for _n, rel in MODULES:
        want(os.path.exists(os.path.join(W, rel.format(b=b))),
             "%s exists for the build the app imports" % rel.format(b=b))

    # 5. integrity manifest agrees with the files
    mp = os.path.join(W, "integrity.%s.json" % b)
    live = json.load(open(mp)) if os.path.exists(mp) else {}
    want(live.get("files") == man["files"], "integrity.%s.json matches on-disk files" % b,
         lambda: json.dump(man, open(mp, "w"), ensure_ascii=False, indent=2))

    # 6. single-file edition is in sync with the modules
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "make_standalone.py")],
                   check=True, stdout=subprocess.DEVNULL)
    st = open(os.path.join(W, "standalone.html"), encoding="utf-8").read()
    payload = json.loads(re.search(r'id="rrai-src">([\s\S]*?)</script>', st).group(1).replace("<\\/", "</"))
    want(payload["build"] == b, "standalone.html embeds build %s" % b)
    for n, rel in paths(b):
        want(payload["src"].get(n) == open(os.path.join(W, rel), encoding="utf-8").read(),
             "standalone.html embeds the current %s" % rel)

    print("CHECK %s: %d problem(s)%s" % (b, len(bad), " — repaired" if fix and bad else ""))
    return len(bad)


PILL = '''/* Radiology report AI — retired service worker (self-destruct pill). */
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch (x) {}
    let cls = [];
    try { cls = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); } catch (x) {}
    for (const c of cls) { try { c.postMessage("rrai-sw-updated"); } catch (x) {} }
    try { await self.registration.unregister(); } catch (x) {}
    for (const c of cls) { try { await c.navigate(c.url); } catch (x) {} }
  })());
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate" || (e.request.method || "GET") !== "GET") return;
  e.respondWith(fetch(e.request, { cache: "no-store" }).catch(async () => {
    try { const r = await caches.match(e.request); if (r) return r; } catch (x) {}
    return new Response("", { status: 504 });
  }));
});
'''


# -------------------------------------------------------------------- roll ---
def roll(new, mark, notes_ar, notes_en):
    old = current_build()
    print("roll %s -> %s (%s)" % (old, new, mark))
    for n, rel in paths(new):
        dst = os.path.join(W, rel)
        src = os.path.join(W, rel.replace(new, old))
        if not os.path.exists(src) and n == "decode":
            src = os.path.join(W, DECODE_ANCESTOR)
        shutil.copy(src, dst)
        s = open(dst, encoding="utf-8").read().replace(old, new)
        if n == "app":
            s = re.sub(r'const APP_BUILD = "v\d+"', 'const APP_BUILD = "%s"' % new, s)
        wr(dst, s)

    # service worker: new copy with current-only precache + fresh LEN
    swp, olds = os.path.join(W, "sw.%s.js" % new), os.path.join(W, "sw.%s.js" % old)
    shutil.copy(olds, swp)
    s = open(swp, encoding="utf-8").read().replace(old, new)
    s = re.sub(r"const CRITICAL = \[[^\]]*\];", critical_block(new), s)
    s = re.sub(r"const LEN = \{[^\}]*\};", lambda m: len_block(new), s, count=1)
    s = re.sub(r'const BUILD = "v\d+"', 'const BUILD = "%s"' % new, s)
    s = re.sub(r'const CACHE = "rrai-web-v\d+"', 'const CACHE = "rrai-web-%s"' % new, s)
    wr(swp, s)
    wr(os.path.join(W, "old" if False else "sw.js"), PILL if False else
       '/* Radiology report AI — bootstrap service worker: always relays to the current build. */\nimportScripts("./sw.%s.js");\n' % new)
    wr(olds, PILL)  # the previous build joins the graveyard

    # app: keep the dynamic module imports on the build we are shipping
    ap = os.path.join(W, "app.%s.js" % new)
    wr(ap, pin_modules(open(ap, encoding="utf-8").read(), new))

    # launcher: version tokens, mark, known list, EXPECT entry for the new build
    man = manifest(new, pinned=json.load(open(os.path.join(W, "integrity.%s.json" % old))).get("pinned_commit", ""))
    json.dump(man, open(os.path.join(W, "integrity.%s.json" % new), "w"), ensure_ascii=False, indent=2)
    exp = {n: [man["files"][n]["chars"], man["files"][n]["bytes"], man["files"][n]["sha256"]]
           for n, _ in paths(new)}
    old_mark = re.search(r"(ب\d+\.\d+)", open(os.path.join(W, "start.html"), encoding="utf-8").read())
    for f in ("start.html", "index.html"):
        p = os.path.join(W, f)
        t = open(p, encoding="utf-8").read()
        if old_mark:
            t = t.replace(old_mark.group(1), mark)
        # Version tokens only where they name a file or a cache — never a build
        # key inside the EXPECT table (that table is rebuilt from disk below).
        t = t.replace("sw.%s.js" % old, "sw.%s.js" % new)
        t = t.replace("?b=%s" % old, "?b=%s" % new)
        t = t.replace('integrity.%s.json' % old, 'integrity.%s.json' % new)
        t = t.replace('"%s"' % old, '"%s"' % new)
        wr(p, t)
    fix_launcher(new, exp)

    # the DICOM probe is a plain page: keep its parser import on the current build
    pp = os.path.join(W, "probe.html")
    if os.path.exists(pp):
        wr(pp, open(pp, encoding="utf-8").read().replace(old, new))

    wr(os.path.join(W, "release.json"), json.dumps({
        "build": new, "version": new, "mark": mark, "channel": "stable", "minVersion": new,
        "updatedAt": subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip(),
        "notes": {"ar": notes_ar + " — " + mark, "en": notes_en + " — " + mark}},
        ensure_ascii=False, indent=2))
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "make_standalone.py")], check=True)
    print("rolled. next: run tests, then deploy (private push -> public sync -> pin refresh).")
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--check" in a:
        n = check("--fix" in a)
        sys.exit(1 if (n and "--fix" not in a) else 0)
    if a and re.match(r"^v\d+$", a[0]):
        kw = {}
        for i, x in enumerate(a):
            if x == "--mark":
                kw["mark"] = a[i + 1]
            if x == "--ar":
                kw["notes_ar"] = a[i + 1]
            if x == "--en":
                kw["notes_en"] = a[i + 1]
        sys.exit(roll(a[0], kw.get("mark", "ب%s" % a[0][1:]),
                      kw.get("notes_ar", "تحديث"), kw.get("notes_en", "Update")))
    print(__doc__)
