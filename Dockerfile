# Build
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
# docker build --build-arg VERSION=v1.0.0 -t vault-configurator .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /vault-configurator .
# Volume mount points owned by the runtime user, so the cache and bins are writable.
RUN mkdir -p /mounts/cache /mounts/bins

# Run: static binary only; mount the VAULT data folder at /data.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /vault-configurator /vault-configurator
COPY --from=build --chown=65532:65532 /mounts/ /
VOLUME ["/data", "/cache", "/bins"]
EXPOSE 8080
ENTRYPOINT ["/vault-configurator", "-data", "/data", "-cache", "/cache", "-bins", "/bins", "-addr", ":8080"]
