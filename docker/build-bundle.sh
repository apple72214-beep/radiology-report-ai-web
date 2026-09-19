#!/bin/sh
# Packs the current release + docker edge config into rrai-edge-bundle.zip
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B="$(python3 -c "import json;print(json.load(open('$ROOT/web/release.json'))['build'])")"
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/web" "$STAGE/docker"
cd "$ROOT"
python3 - "$B" "$STAGE" <<'PY'
import json, sys, shutil, os
b, stage = sys.argv[1], sys.argv[2]
man = json.load(open("web/integrity.%s.json" % b))
files = [v["path"] for v in man["files"].values()]
files += ["start.html", "index.html", "sw.js", "manifest.webmanifest", "diag.html",
          "icons/icon-192.png", "icons/icon-512.png",
          "codecs/charlswasm.js", "codecs/charlswasm.wasm",
          "codecs/openjpegwasm.js", "codecs/openjpegwasm.wasm",
          "codecs/openjphjs.js", "codecs/openjphjs.wasm",
          "samples/brain_clean.dcm", "samples/brain_hemo.dcm"]
for f in files:
    src = os.path.join("web", f)
    if os.path.exists(src):
        dst = os.path.join(stage, "web", f)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
print("staged", len(files), "files for", b)
PY
cp docker/Dockerfile docker/nginx.conf docker/docker-compose.yml docker/README.md "$STAGE/docker/" 2>/dev/null || true
cd "$STAGE"
zip -qr "$ROOT/rrai-edge-bundle.zip" .
cd "$ROOT"
sha256sum rrai-edge-bundle.zip | tee rrai-edge-bundle.sha256
du -h rrai-edge-bundle.zip
