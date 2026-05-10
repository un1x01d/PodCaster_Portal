-- Migration: Add default_view_id to users table
-- Run this with: psql -U portal -d tforn_insights_db < add_default_view.sql
-- Or via docker: docker-compose exec -T db psql -U portal -d tforn_insights_db < add_default_view.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS default_view_id INTEGER REFERENCES views(id) ON DELETE SET NULL;
