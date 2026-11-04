# Build
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /vault-configurator .

# Run: static binary only; mount the VAULT data folder at /data.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /vault-configurator /vault-configurator
VOLUME ["/data", "/cache"]
EXPOSE 8080
ENTRYPOINT ["/vault-configurator", "-data", "/data", "-cache", "/cache", "-addr", ":8080"]
