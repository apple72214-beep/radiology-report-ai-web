#!/usr/bin/env python3
"""Build web/standalone.html — a single self-contained file that needs ZERO
network fetches after the page itself loads (proxy / SW / CORS proof)."""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = os.path.join(ROOT, "web")
build = json.load(open(os.path.join(W, "release.json")))["build"]
MARK = json.load(open(os.path.join(W, "release.json"))).get("mark", "ب2.71")

MODULES = [
    ("consult", f"consult.{build}.js"),
    ("decode", f"codecs/decode.{build}.js"),
    ("dicom", f"dicom.{build}.js"),
    ("triage", f"triage.{build}.js"),
    ("docx", f"docx.{build}.js"),
    ("measure", f"measure.{build}.js"),
    ("compare", f"compare.{build}.js"),
    ("report", f"report.{build}.js"),
    ("mpr", f"mpr.{build}.js"),
    ("app", f"app.{build}.js"),
]

def rd(p):
    return open(p, encoding="utf-8").read()

srcs = {}
for name, rel in MODULES:
    p = os.path.join(W, rel)
    if not os.path.exists(p):
        if name == "decode":  # regenerate from the pristine ancestor
            import shutil
            shutil.copy(os.path.join(W, "codecs", "decode.v77.js"), p)
        else:
            raise SystemExit("missing module: " + rel)
    srcs[name] = rd(p)
srcs["ui"] = rd(os.path.join(W, f"ui.{build}.html"))

payload = json.dumps({"build": build, "mark": MARK, "src": srcs}, ensure_ascii=False)
payload = payload.replace("</", "<\\/")  # never break out of the <script> element

HTML = """<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Radiology report AI — __MARK__ (ملف واحد)</title>
<style>
  body{margin:0;background:#0f172a;color:#e2e8f0;font-family:system-ui,"Segoe UI",Tahoma,sans-serif}
  #boot{padding:1.2rem;font-size:.95rem;line-height:1.9}
  #boot b{color:#38bdf8}
  .err{color:#fca5a5;direction:ltr;text-align:left;font-size:.8rem;white-space:pre-wrap;margin-top:1rem}
</style>
</head>
<body>
<div id="boot">جارٍ تشغيل <b>Radiology report AI — __MARK__</b> (نسخة ملف واحد، بلا أي اتصال خارجي)…</div>
<script type="application/json" id="rrai-src">__PAYLOAD__</script>
<script>
(async () => {
  const boot = document.getElementById("boot");
  const say = (t) => { if (boot) boot.textContent = t; };
  try {
    const P = JSON.parse(document.getElementById("rrai-src").textContent);
    const S = P.src;
    const TOPO = ["consult", "decode", "dicom", "triage", "docx", "measure", "compare", "report", "mpr", "app"];
    const urls = {};
    for (const n of TOPO) {
      let txt = S[n];
      for (const d of TOPO) {
        if (d === n || !urls[d]) continue;
        const rx = d === "decode"
          ? /(["'])\\.\\/codecs\\/decode\\.v\\d+\\.js\\1/g
          : new RegExp("([\\"'])\\\\.\\\\/" + d + "\\\\.v\\\\d+\\\\.js\\\\1", "g");
        txt = txt.replace(rx, '"' + urls[d] + '"');
      }
      const leftover = txt.match(/from\\s*["']\\.\\//) || txt.match(/import\\(\\s*["']\\.\\//);
      if (leftover) throw new Error("unresolved-relative:" + n);
      urls[n] = URL.createObjectURL(new Blob([txt], { type: "text/javascript" }));
    }
    document.body.innerHTML = S.ui;
    say("بدء التطبيق…");
    const mod = await import(urls.app);
    await mod.init();
    const sp = document.getElementById("splash");
    if (sp) sp.remove();
    /* offline + updates: register this build's worker, evict older ones, reload on update */
    try {
      if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
        const reg = await navigator.serviceWorker.register("./sw.__BUILD__.js?b=__BUILD__", { scope: "./", updateViaCache: "none" });
        try {
          const all = await navigator.serviceWorker.getRegistrations();
          for (const r of all) if (r !== reg) { r.unregister().catch(() => {}); }
        } catch (e) {}
        navigator.serviceWorker.addEventListener("message", (ev) => {
          if (ev.data !== "rrai-sw-updated") return;
          try {
            if (sessionStorage.getItem("rrai-sw-reload")) return;
            sessionStorage.setItem("rrai-sw-reload", "1");
            location.reload();
          } catch (e) {}
        });
      }
    } catch (e) {}
  } catch (e) {
    say("تعذّر التشغيل — " + (e && e.message ? e.message : e));
    const d = document.createElement("div");
    d.className = "err";
    d.textContent = String(e && e.stack ? e.stack : e);
    document.body.appendChild(d);
  }
})();
</script>
</body>
</html>
"""

out = HTML.replace("__PAYLOAD__", payload).replace("__MARK__", MARK).replace("__BUILD__", build)
dst = os.path.join(W, "standalone.html")
open(dst, "w", encoding="utf-8").write(out)
print("standalone.html ->", build, len(out), "bytes")
