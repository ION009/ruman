FROM golang:1.25-alpine AS build

WORKDIR /src

COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal

RUN go build -trimpath -ldflags="-s -w" -o /bin/anlticsheat ./cmd/anlticsheat-api

FROM alpine:3.21

RUN adduser -D -H -u 10001 appuser

COPY --from=build /bin/anlticsheat /usr/local/bin/anlticsheat

USER appuser
EXPOSE 8080

ENTRYPOINT ["anlticsheat"]

