# syntax=docker/dockerfile:1.6
# ViewIO = MinIO (RELEASE.2025-04-22T22-12-26Z) + Console có viewer tài liệu & cây thư mục.
# Build 1 lần, không cần cài Node/Go trên máy: Docker làm hết (cần Internet khi build).

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
EXPOSE 9000 9001
ENTRYPOINT ["/usr/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
