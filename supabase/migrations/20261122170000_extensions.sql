-- Extensiones en el esquema `extensions` (convención de Supabase; evita la alerta
-- "extension in public" del Security Advisor).
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
