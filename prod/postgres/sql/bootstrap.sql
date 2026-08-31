-- Run as postgres superuser
--   sudo -u postgres psql -f prod/postgres/sql/bootstrap.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tforn_insights') THEN
    CREATE ROLE tforn_insights LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'tforn_insights_db') THEN
    CREATE DATABASE tforn_insights_db OWNER tforn_insights;
  END IF;
END
$$;

\connect tforn_insights_db

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO tforn_insights;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tforn_insights;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO tforn_insights;
