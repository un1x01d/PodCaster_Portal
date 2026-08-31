# Production Operations Scripts (Source-Optional Host)

## Scripts

- `preflight.sh` - validates local prerequisites before deploy
- `validate_envs.sh` - verifies required env files/keys and rejects placeholder secrets
- `deploy.sh <release-tag>` - deploys images by tag (pull by default), runs migrations and smoke tests
- `deploy_from_git.sh <repo-url> <release-tag>` - temporary clone, local build, deploy, then delete clone
- `release.sh <patch|minor|major>` - create a required, explicit SemVer release; optionally build/deploy app images
- `smoke_test.sh` - post-deploy functional reachability checks
- `healthcheck.sh` - checks app containers and host services
- `rollback.sh <previous-release-tag>` - redeploys a previous release tag
- `cleanup_images.sh` - prunes dangling images and keeps last N tags locally
- `diag.sh` - gathers quick diagnostics logs and service statuses

## Required config files

- `prod/docker/config/backend.env`
- `prod/docker/config/frontend.env`
- `prod/docker/config/release.env`

Create release config from template:

- `cp prod/docker/config/release.env.example prod/docker/config/release.env`

## Usage

From repo root:

- Validate envs:
  - `bash prod/ops/validate_envs.sh`
- Registry-based deploy:
  - `bash prod/ops/deploy.sh v1.2.3`
- Ephemeral source deploy (no source kept on host):
  - `bash prod/ops/deploy_from_git.sh https://github.com/<org>/<repo>.git v1.2.3`
- Rollback:
  - `bash prod/ops/rollback.sh v1.2.2`
- Release bump meanings:
  - `patch` - backward-compatible bug, security, documentation, or performance fix
  - `minor` - backward-compatible user-facing feature
  - `major` - breaking API, data, auth, or deployment change
- Create a release without deploying:
  - `bash prod/ops/release.sh patch --message "Fix password reset click handling"`
- Build and deploy the app images without rebuilding PostgreSQL:
  - `VITE_API_URL=https://app.example.com/api bash prod/ops/release.sh patch --message "Fix password reset click handling" --deploy`
- Cleanup old local images:
  - `KEEP_TAGS=5 bash prod/ops/cleanup_images.sh`
- Diagnostics:
  - `bash prod/ops/diag.sh`

## Deploy behavior

`deploy.sh` now includes:

1. Preflight checks
2. Image pull (unless `SKIP_PULL=true`)
3. Migration command in backend container (default: `node scripts/migrateTenantDatabases.js`)
4. `docker compose up -d`
5. Health checks
6. Smoke tests

Override defaults:

- `RUN_MIGRATIONS=false`
- `MIGRATION_COMMAND='node scripts/migrateTenantDatabases.js'`
- `RUN_SMOKE_TEST=false`

## Release metadata

Each successful deploy writes:

- `prod/releases/current_release.env`

Fields include deployed tag, image refs, digests, and deploy flags.
