# Radiology report AI — edge bundle (v0.5.3)
# Static, low-resource: nginx:alpine (~40 MB), no backend, no database.
# Build from repo root:  docker build -f docker/Dockerfile -t rrai-web .
FROM nginx:alpine
COPY web/ /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/release.json || exit 1
