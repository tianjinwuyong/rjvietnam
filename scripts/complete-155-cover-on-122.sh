#!/usr/bin/env bash
set -euo pipefail

backup_root="/home/wy/db-backups"
source_dump="$backup_root/smt_factory_from_155_20260903.dir"
log_file="$backup_root/155-cover-122.log"

exec >>"$log_file" 2>&1
echo "$(date -Is) waiting for the 155 full dump"

dump_exit="$(docker wait smt-pg-dump-from-155)"
if [[ "$dump_exit" != "0" ]]; then
  echo "$(date -Is) dump failed with exit code $dump_exit"
  exit 1
fi

docker run --rm -v "$backup_root:/backup" postgres:16 \
  pg_restore -l /backup/smt_factory_from_155_20260903.dir >/dev/null
echo "$(date -Is) dump validated"

docker stop smt-api >/dev/null 2>&1 || true
docker exec smt-postgres dropdb -U smt_factory --if-exists --force smt_factory
docker exec smt-postgres createdb -U smt_factory -O smt_factory -T template0 smt_factory
docker rm -f smt-pg-restore-from-155 >/dev/null 2>&1 || true
docker run --name smt-pg-restore-from-155 \
  --network container:smt-postgres \
  -v "$backup_root:/backup" \
  postgres:16 \
  pg_restore -h 127.0.0.1 -U smt_factory -d smt_factory \
  --no-owner --no-privileges --exit-on-error -j 4 \
  /backup/smt_factory_from_155_20260903.dir

docker start smt-api >/dev/null
echo "$(date -Is) 155 database restored to 122 and API started"
