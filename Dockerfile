# syntax=docker/dockerfile:1.6
# ViewIO = MinIO (RELEASE.2025-04-22T22-12-26Z) + Console có viewer tài liệu & cây thư mục.
# Build 1 lần, không cần cài Node/Go trên máy: Docker làm hết (cần Internet khi build).

# Nguồn lấy lệnh `mc` (MinIO Client) để đưa vào image cuối, giữ tương thích với các script
# quen dùng `docker exec <container> mc ...` của image MinIO chính thức. Có thể đổi bằng
# --build-arg MC_IMAGE=... nếu image này không còn trên Docker Hub.
ARG MC_IMAGE=minio/minio:RELEASE.2025-04-22T22-12-26Z
FROM ${MC_IMAGE} AS mcsrc

# ---------- Giai đoạn 1: build giao diện Console (React) ----------
FROM node:22-bookworm AS ui
ENV CI=false \
    GENERATE_SOURCEMAP=false \
    TSC_COMPILE_ON_ERROR=true \
    DISABLE_ESLINT_PLUGIN=true \
    NODE_OPTIONS=--max-old-space-size=6144
RUN npm i -g pnpm@10 >/dev/null 2>&1
WORKDIR /app
COPY src/console/web-app/package.json src/console/web-app/pnpm-lock.yaml ./
# `canvas` (phụ thuộc tùy chọn của pdf.js) không build được trong container -> bỏ qua lỗi này là bình thường.
RUN pnpm install --frozen-lockfile --config.node-linker=hoisted --config.dangerously-allow-all-builds=true \
 || pnpm install --no-frozen-lockfile --config.node-linker=hoisted --config.dangerously-allow-all-builds=true \
 || true
COPY src/console/web-app/ ./
RUN pnpm exec react-scripts build

# ---------- Giai đoạn 2: build binary MinIO nhúng Console ----------
FROM golang:1.24 AS gobuild
ARG MINIO_VERSION=2025-04-22T22-12-26Z
ARG MINIO_COMMIT=0d7408fc9969
ENV CGO_ENABLED=0 GOFLAGS=-mod=mod
WORKDIR /src
COPY src/minio ./minio
COPY src/console ./console
COPY --from=ui /app/build ./console/web-app/build
WORKDIR /src/minio
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -tags kqueue -trimpath -o /out/minio -ldflags "-s -w \
      -X github.com/minio/minio/cmd.Version=${MINIO_VERSION} \
      -X github.com/minio/minio/cmd.CopyrightYear=2025 \
      -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.${MINIO_VERSION} \
      -X github.com/minio/minio/cmd.CommitID=${MINIO_COMMIT} \
      -X github.com/minio/minio/cmd.ShortCommitID=${MINIO_COMMIT}" .

# ---------- Giai đoạn 3: image chạy ----------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates curl tzdata
COPY --from=gobuild /out/minio /usr/bin/minio
COPY --from=mcsrc /usr/bin/mc /usr/bin/mc
LABEL org.opencontainers.image.title="ViewIO (MinIO + document viewer UI)" \
      org.opencontainers.image.description="MinIO RELEASE.2025-04-22T22-12-26Z with a Console that previews PDF/Word/Excel/PowerPoint/Markdown/code and a folder tree" \
      org.opencontainers.image.source="https://github.com/ntanhprt/ViewIO" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="1.0.0"
EXPOSE 9000 9001
ENTRYPOINT ["/usr/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
