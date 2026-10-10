FROM --platform=$BUILDPLATFORM golang:1.26.9-alpine@sha256:cdfd4fe2da6b225d8b40c6b7a105736e548e83ff56d5d8f9394446eeb5eb84e0 AS builder

ARG VERSION=devel
ARG COMMIT=unknown
ARG TARGETOS
ARG TARGETARCH

WORKDIR /workspace

COPY . .

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
    -mod=vendor \
    -trimpath \
    -ldflags="-s -w -X github.com/mss-boot-io/mss-boot-admin/admin/pkg.Version=${VERSION} -X github.com/mss-boot-io/mss-boot-admin/admin/pkg.Commit=${COMMIT}" \
    -o /out/mss-boot-admin \
    ./admin

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

ARG VERSION=devel
ARG COMMIT=unknown

LABEL org.opencontainers.image.source="https://github.com/mss-boot-io/mss-boot-admin" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}"

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S admin \
    && adduser -S -G admin -h /app admin

WORKDIR /app

COPY --from=builder --chown=admin:admin /out/mss-boot-admin /app/mss-boot-admin
COPY --from=builder --chown=admin:admin /workspace/admin/config /app/config

USER admin

ENTRYPOINT ["/app/mss-boot-admin"]
CMD ["server"]
