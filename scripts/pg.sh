#!/usr/bin/env bash
# Native Postgres control for local development. Loopcraft does not use Docker: the sandbox
# is macOS Seatbelt and the database is a plain Postgres cluster under .pgdata/.
set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
PGDATA="${PGDATA:-$(cd "$(dirname "$0")/.." && pwd)/.pgdata}"
PGPORT="${PGPORT:-54329}"
PGUSER="${PGUSER:-loopcraft}"
PGDB="${PGDB:-loopcraft}"

export PATH="$PG_BIN:$PATH"

case "${1:-}" in
  init)
    rm -rf "$PGDATA"
    initdb -D "$PGDATA" -U "$PGUSER" --auth=trust --encoding=UTF8 >/dev/null
    echo "initialised $PGDATA"
    ;;
  start)
    if pg_isready -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
      echo "already running on $PGPORT"; exit 0
    fi
    pg_ctl -D "$PGDATA" -o "-p $PGPORT -k /tmp" -l "$PGDATA/server.log" start >/dev/null
    until pg_isready -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; do sleep 0.3; done
    psql -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" -d postgres -tc \
      "select 1 from pg_database where datname='$PGDB'" | grep -q 1 || \
      psql -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" -d postgres -c "create database $PGDB" >/dev/null
    echo "postgres up on $PGPORT, database $PGDB"
    ;;
  stop)
    pg_ctl -D "$PGDATA" stop >/dev/null 2>&1 || true
    echo "postgres stopped"
    ;;
  status)
    pg_isready -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER"
    ;;
  *)
    echo "usage: $0 {init|start|stop|status}" >&2; exit 1
    ;;
esac
