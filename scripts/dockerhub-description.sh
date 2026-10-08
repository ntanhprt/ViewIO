#!/usr/bin/env bash
# Cập nhật mô tả (Overview) + mô tả ngắn của 2 repo Docker Hub từ docs/dockerhub-*.md
# Cần Personal Access Token có quyền "Read & Write" (Docker Hub > Account settings > Personal access tokens)
#   DOCKERHUB_USER=ntanhprt DOCKERHUB_TOKEN=dckr_pat_... ./scripts/dockerhub-description.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DOCKERHUB_USER:?đặt DOCKERHUB_USER}"
: "${DOCKERHUB_TOKEN:?đặt DOCKERHUB_TOKEN}"
export DOCKERHUB_USER DOCKERHUB_TOKEN

python3 - <<'PY'
import json, os, urllib.request

user = os.environ["DOCKERHUB_USER"]
login = json.dumps({"username": user, "password": os.environ["DOCKERHUB_TOKEN"]}).encode()
r = urllib.request.urlopen(
    urllib.request.Request("https://hub.docker.com/v2/users/login", data=login,
                           headers={"Content-Type": "application/json"}), timeout=30)
jwt = json.load(r)["token"]

repos = {
    "viewio": ("docs/dockerhub-viewio.md",
               "MinIO + web UI that previews PDF/Word/Excel/PowerPoint/Markdown/code, folder tree. Drop-in for minio/minio (AGPL)."),
    "viewio-converter": ("docs/dockerhub-converter.md",
               "Office to PDF converter (LibreOffice) used by ViewIO for PowerPoint/Word/Excel preview. Do not expose publicly."),
}
for repo, (path, short) in repos.items():
    body = json.dumps({"description": short[:100],
                       "full_description": open(path, encoding="utf-8").read()}).encode()
    req = urllib.request.Request(
        "https://hub.docker.com/v2/repositories/%s/%s/" % (user, repo), data=body, method="PATCH",
        headers={"Authorization": "Bearer " + jwt, "Content-Type": "application/json"})
    print(repo, "->", urllib.request.urlopen(req, timeout=30).status)
PY
