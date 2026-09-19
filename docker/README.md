# Edge bundle — Radiology report AI offline server
For hospitals with unreliable or no internet: run the whole platform on a local server/container.
1. Unzip `rrai-edge-bundle.zip` (contains `web/` current release + `docker/` config).
2. `docker compose -f docker/docker-compose.yml up --build -d` (or build the Dockerfile directly).
3. Open http://<server-ip>:8080/ from any workstation browser on the LAN; add to home screen for PWA offline use.
All processing remains client-side; the container only serves static files — no data leaves the hospital.
Rebuild the bundle anytime with `docker/build-bundle.sh` (tracks web/release.json automatically).
