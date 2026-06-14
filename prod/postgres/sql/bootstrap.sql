-- Run as postgres superuser
--   sudo -u postgres psql -f prod/postgres/sql/bootstrap.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'podcaster_app') THEN
    CREATE ROLE podcaster_app LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'podcaster_portal') THEN
    CREATE DATABASE podcaster_portal OWNER podcaster_app;
  END IF;
END
$$;

\connect podcaster_portal

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO podcaster_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO podcaster_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO podcaster_app;
