# Production Docker (Apps Only, Source-Free Host)

This stack runs `frontend` and `backend` in Docker Compose using prebuilt registry images.
PostgreSQL remains on the VPS host.

## Files

- `docker-compose.prod.yml`
- `config/backend.env.example`
- `config/frontend.env.example`
- `config/release.env.example`

## Setup

1. Copy env templates:
   - `cp config/backend.env.example config/backend.env`
   - `cp config/frontend.env.example config/frontend.env`
   - `cp config/release.env.example config/release.env`
2. Fill real values in `config/*.env`.
3. Deploy by tag:
   - `bash ../ops/deploy.sh v1.2.3`

## Networking

- Frontend is bound to `127.0.0.1:5173`
- Backend is bound to `127.0.0.1:4000`
- Nginx on host terminates TLS and proxies to those localhost ports.

## Host PostgreSQL

- Set backend `POSTGRES_HOST` to `host.docker.internal`.
- Compose includes `extra_hosts: host.docker.internal:host-gateway` for Linux.
