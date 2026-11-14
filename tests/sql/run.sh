#!/usr/bin/env bash
# Levanta un PostgreSQL temporal, aplica el esquema y ejecuta las pruebas.
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=/usr/lib/postgresql/16/bin
DIR=$(mktemp -d); PORT=55432; AS=""
trap '$AS $BIN/pg_ctl -D "$DIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
AS=""; if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; AS="runuser -u postgres --"; fi
$AS $BIN/initdb -D "$DIR" -U postgres >/dev/null
$AS $BIN/pg_ctl -D "$DIR" -o "-p $PORT -k $DIR" -l "$DIR/log" -w start >/dev/null
P="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database t"
$P -d t -f tests/sql/stub_supabase.sql
$P -d t -f supabase/migrations/0001_init.sql
$P -d t -f tests/sql/test_rules.sql >/dev/null
