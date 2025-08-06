-- Initialize database with UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create database if not exists (this will be handled by docker-compose)
-- The database is already created by POSTGRES_DB environment variable