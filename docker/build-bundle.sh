#!/bin/sh
# Builds an offline transfer bundle (zip) for air-gapped edge servers.
# Output: rrai-edge-bundle.zip — copy by USB to the hospital server.
set -e
cd "$(dirname "$0")/.."
rm -f rrai-edge-bundle.zip
zip -qr rrai-edge-bundle.zip web docker -x "web/blogger/*" "web/web-deploy.zip" "web/tests/*"
echo "rrai-edge-bundle.zip ready ($(du -h rrai-edge-bundle.zip | cut -f1))"
echo "Offline image transfer (on a machine WITH docker+internet):"
echo "  docker build -f docker/Dockerfile -t rrai-web ."
echo "  docker save rrai-web | gzip > rrai-web-image.tar.gz"
echo "On the edge server:  gunzip -c rrai-web-image.tar.gz | docker load"
echo "Then:  docker run -d --name rrai-web -p 8080:80 --restart unless-stopped rrai-web"
