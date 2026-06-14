# PostgreSQL (Host) Production Layer

This folder configures PostgreSQL on the VPS host (not in Docker).

## Files

- `scripts/install_postgres.sh` - installs latest stable PostgreSQL from PGDG repo
- `scripts/apply_config.sh` - appends hardened/tuned config and restarts Postgres
- `sql/bootstrap.sql` - creates app role/database and schema privileges
- `scripts/backup_db.sh` - compressed pg_dump backup with retention cleanup
- `scripts/restore_db.sh` - restore dump into target DB
- `scripts/install_backup_cron.sh` - installs nightly backup cron job
- `scripts/restore_drill.sh` - validates latest backup by restoring into drill DB

## Quick Start

1. Install PostgreSQL:
   - `sudo PG_MAJOR=16 bash prod/postgres/scripts/install_postgres.sh`
2. Apply config snippets:
   - `sudo PG_MAJOR=16 bash prod/postgres/scripts/apply_config.sh`
3. Bootstrap app DB/user:
   - `sudo -u postgres psql -f prod/postgres/sql/bootstrap.sql`
4. Update backend env:
   - `DB_HOST=host.docker.internal`
   - `DB_PORT=5432`
   - `DB_NAME=podcaster_portal`
   - `DB_USER=podcaster_app`
   - `DB_PASSWORD=<your-strong-password>`

## Backup Automation

Install nightly backup cron (default `30 2 * * *`):

- `sudo CRON_SCHEDULE='30 2 * * *' RUN_AS_USER=postgres bash prod/postgres/scripts/install_backup_cron.sh`

Run restore drill against latest dump:

- `sudo -u postgres bash prod/postgres/scripts/restore_drill.sh`

## Security Notes

- Postgres listens on localhost only (`127.0.0.1`).
- No public DB port exposure.
- Use SCRAM auth and strong credentials.
