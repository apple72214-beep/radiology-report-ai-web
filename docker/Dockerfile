# Radiology report AI — edge bundle (fully offline hospital server)
FROM nginx:alpine
COPY web/ /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK CMD wget -q -O /dev/null http://localhost/start.html || exit 1
